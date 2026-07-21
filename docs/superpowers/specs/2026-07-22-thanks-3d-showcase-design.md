# Thank-you page — interactive 3D house showcase + share

**Date:** 2026-07-22
**Status:** approved, not yet built
**Surface:** `/q/roof/[token]/thanks` (roofing funnel only — it is the only funnel with a 3D model)

---

## Objective

Below the thank-you message and booking details, add a section that lets the
customer explore their own house in 3D — recolour the roof and walls live, flip
the roof material on the two AI studio renders, and share the result with
someone they love.

---

## Current state (verified 2026-07-22, 44-agent map)

**The model already exists and is good.** `lib/roofing/model3d.ts` runs:
5 Cesium orbit captures → Gemini nano-banana polish (neighbours removed) →
**two synthesised studio renders** (front + back, plain backdrop) → Tripo3D
multiview reconstruction → textured GLB (~10–20 MB) in the `roof-models`
bucket.

| Asset | Where it lives | Durable? |
|---|---|---|
| GLB | `roofing_measurements.model3d_glb_path` → `roof-models` | yes, per measurement |
| The two studio renders | `synth/v4/{address-key}/{front,back}` in `roof-models` | yes, per **address**, cross-tenant |
| Polished captures | `enhanced/v4/{address-key}/{view}` | yes |

Blockers and constraints the design must respect:

1. **The model is not reachable by a customer.** `/api/roofing/model3d/[token]`
   is keyed on `measure_token` — the *tradie* capability token
   (`model3d.ts:499-506`). Customers hold `public_token`. A customer-safe read
   route is required work.
2. ⚠ **That existing route has no auth at all, and its GET is not read-only** —
   it can drive paid Tripo calls and write `model3d_status`
   (`model3d.ts:766-794`). Pre-existing; noted, not fixed here beyond not
   making it worse.
3. **Roof type cannot be tinted.** The GLB is one fused mesh with baked
   photographic texture. The code's own note: *"true per-surface repaint would
   need Tripo's /models/texture re-texture task (paid, slow) or segmentation"*
   (`Roof3DModelSection.tsx:262-263`).
4. **The existing tint shader is reusable.** Uniforms `uRoofColor`, `uRoofMix`,
   `uWallColor`, `uWallMix`, injected per material via `onBeforeCompile`
   (`Roof3DModelSection.tsx:264-305`). Classification by world normal:
   `roofMask = step(0.35, up) * (1 - step(0.985, up))`,
   `wallMask = 1 - step(0.35, abs(up))`.
5. **No roof colour taxonomy exists.** Every re-roof render is hardcoded
   `"in a clean charcoal finish"` (`roof-after-prompt.ts:12-15`). Painting has
   14 real AU swatches in `lib/painting/colours.ts` — reuse those.
6. **Roof materials: 8 keys, 7 selectable** (`lib/roofing/types.ts:21-29`);
   `unknown` is never customer-selectable (`rate-card-overlay.ts:59-68`).
7. **`navigator.share` is used nowhere**, but `sms:` deep-links already are
   (`app/s/[shortCode]/route.ts:88-101`, `app/start/[tenantId]/page.tsx:38`).
8. **No `generateMetadata` anywhere**; `/q/*` inherits the root OG image and
   has **no `robots: noindex`** — a shared quote URL is indexable today.
9. `next/og` `ImageResponse` already works in `app/api/studio/render/route.ts`.

---

## Design

### R1 — Customer-safe model access

New `GET /api/q/roof/[token]/showcase`, keyed on
`roofing_measurements.public_token`. Read-only: it never calls Tripo and never
writes. Returns only what a customer may see:

```ts
{ ok: true,
  status: 'ready' | 'unavailable',
  modelUrl: string | null,      // signed GLB, 1h
  images: { front: string | null, back: string | null },  // signed synth, 1h
  material: RoofMaterial,       // the quoted material, for the default state
  address: string | null }
```

`status: 'unavailable'` whenever `model3d_status !== 'ready'` or the GLB path is
null — the section then does not render at all. No tradie fields
(`measure_token`, `model3d_task_id`, `model3d_error`, costs, measurements)
appear in the response.

Gated exactly like the rest of the funnel: paid **and** scheduled, matching
`thanksPageTarget`. An unpaid token gets 404, not a model.

### R2 — The 3D viewer, extracted and shared

Extract the view-only path of `Roof3DModelSection.tsx` into
`app/q/_chrome/HouseViewer.tsx` (client component): GLB load, orbit controls,
the tint shader, and the colour uniforms. Everything tradie-only — capture,
generate, upload, polling, anatomy overlays, Cesium — stays behind on `/m`.

`/m/[token]/Roof3DModelSection.tsx` then imports the same viewer, so there is
one implementation and the two surfaces cannot drift.

Two defects the map surfaced, fixed during extraction:

- **`vNormal` is not guaranteed.** `normal_pars_fragment` declares it under
  `#ifndef FLAT_SHADED`, and three defines `FLAT_SHADED` for flat-shaded
  materials — the tint would fail to compile on such a material. The extracted
  shader declares its own varying rather than assuming three's.
- **Up-axis is assumed, not established.** The app only translates the model,
  but Tripo's `orientation: 'default'` does not guarantee Y-up. Derive the up
  axis from the model's bounding box (a house is far wider than it is tall) and
  orient once on load, so the roof/wall masks are meaningful.

### R3 — The controls

Live on the 3D model, instant, free:

| Control | Uniform | Palette |
|---|---|---|
| **Roof colour** | `uRoofColor` / `uRoofMix` | curated AU swatches |
| **Wall colour** | `uWallColor` / `uWallMix` | curated AU swatches |

"House colour" and "ceiling colour" from the brief are the same surface — the
walls — so this is **one** wall control, not two.

New `lib/roofing/colours.ts` exports `ROOF_COLOUR_SWATCHES` — a curated subset
of real Colorbond names with hex values, modelled on
`lib/painting/colours.ts`: Monument, Woodland Grey, Basalt, Surfmist, Shale
Grey, Ironstone, Manor Red, Classic Cream. Named swatches, not a raw colour
picker: a customer choosing `#ff00ff` for their roof is not a useful outcome,
and named Colorbond colours are what the tradie will actually quote.

### R4 — Roof type on the two studio renders

The two `synth` renders are the reference images the model was built from, and
are shown side by side beneath the viewer. A material selector (the 7
selectable `RoofMaterial` keys) swaps which render is displayed.

Renders are **pre-generated and cached**, never generated on a customer's
click:

- Path: `showcase/v1/{address-key}/{material}-{view}` in `roof-models`,
  reusing the existing `capture-cache` address-key convention so the work is
  shared across tenants for the same property.
- Produced by extending `roof-after.ts`'s provider call to accept a source
  image + material (today it hardcodes the Google satellite as source and the
  material from the row). The synth render is a far better source than a
  top-down satellite for this purpose.
- Triggered by the tradie, not the customer: a "prepare showcase" step
  alongside the existing 3D generation. Until a material variant exists, the
  selector shows the quoted material only.

The customer never waits on an AI call, and no customer interaction can spend
money.

### R5 — Share

**Mechanism:** `navigator.share()` where available — the OS sheet already
contains SMS, iMessage, WhatsApp, Facebook and Instagram, so the page needs no
platform icons at all. Fallback chain: `sms:` deep-link (the pattern
`/s/[shortCode]` already uses) → copy-to-clipboard. No server-side send, no
Twilio cost, no unauthenticated endpoint accepting a phone number.

**Recipient dropdown** personalises the message text only:

| Choice | Message |
|---|---|
| Partner | "Have a look at what our roof's going to look like —" |
| Kids | "Check out what the house is going to look like!" |
| Mum & Dad | "Here's the roof we've gone with —" |
| A mate | "Reckon this'll look alright?" |
| Just copy the link | *(no prefix)* |

**Target:** a new `/share/[token]` page — **not** the thank-you page. It shows
the house render and the chosen colours and nothing else: no price, no address,
no tradie contact, no booking time. A forwarded link must not leak the
customer's quote.

Colour/material choices ride in the query string
(`?roof=monument&wall=surfmist&mat=colorbond_trimdek`), validated server-side
against the swatch and material lists, so the friend sees exactly the
combination that was shared.

**Preview image:** `opengraph-image` on `/share/[token]` via `next/og`, reusing
the working `app/api/studio/render` pattern.

**Indexing:** `robots: { index: false }` on `/share/*` **and** on `/q/*`.
Customer quote pages are indexable today; that is a pre-existing privacy leak
this change would otherwise widen.

### R6 — Layout

The section sits below `BookedSummary` and above the calendar/PDF actions,
inside the existing `QuoteSheet`, as a `SheetSection` with eyebrow
"Your house in 3D". Order: viewer (dominant), colour controls beneath it, then
the two studio renders side by side with the material selector, then the share
control.

Design system unchanged: warm charcoal, single yellow accent, Manrope +
JetBrains Mono, square corners, borders not shadows, dark-on-yellow only.

**Mobile:** the GLB is 10–20 MB. The viewer is lazy — it renders a poster
(the front studio render, already an image) with a "View in 3D" affordance, and
only fetches three.js and the GLB on tap. Nobody on mobile data downloads 20 MB
unasked.

---

## Non-goals

- No change to how the model is generated (`model3d.ts` pipeline untouched).
- No re-texturing of the GLB; no per-material GLB variants.
- The 3D model still never feeds measurements or pricing — it is presentation
  only, and changing colours or material here changes **no price**. The section
  says so.
- No 3D section on the quotes, painting or solar funnels — only roofing has a
  model.
- Not fixing the unauthenticated `/api/roofing/model3d/[token]` route (logged
  as debt).

---

## Definition of done

1. `npm test` passes, including new unit tests for the showcase payload
   resolver, the colour/material query validation, and the share-message
   builder.
2. `npm run typecheck` and `npm run lint` clean on all new files.
3. `npm run test:e2e -- --workers=1` passes, with new coverage:
   - the section is absent when no model is ready
   - an unpaid token cannot reach `/api/q/roof/[token]/showcase`
   - the two studio renders appear and the material selector switches them
   - `/share/[token]` renders the house and carries **no** price or address
   - `/share/*` and `/q/*` emit `noindex`
4. Browser-verified on a seeded property with a ready model.
5. No customer interaction triggers a paid AI call — verified by inspection of
   the showcase route.

---

## Risks accepted

The normal-based roof/wall split is a heuristic. A near-flat roof section reads
as wall and a steep wall reads as roof. It is a visual toy, labelled as such,
and the page states plainly that colours are indicative and change no price.
