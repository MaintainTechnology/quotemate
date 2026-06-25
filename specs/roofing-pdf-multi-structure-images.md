# Roofing multi-structure quote images — Spec

## Objective
A roofing quote can cover more than one structure (e.g. house + shed), but the
generated artifacts only ever show **one** aerial image — always the first
detected structure. On the customer-facing quote page the same single image is
hard-centred on structure #1 too. Customers and tradies therefore never see the
second structure they were quoted for (the bug Jon raised: he included a second
roof structure, but the PDF still printed only the first roof image).

This change makes **every structure shown in a roofing quote view render its own
labelled aerial image** — on both the customer **PDF** and the customer **web
quote page** — so the imagery matches the structures actually included in the
quote.

## Context / background
- App lives in `quotemate-automation/` (Next.js 16 App Router). Before writing
  any Next.js code, read `quotemate-automation/AGENTS.md` and the relevant guide
  under `node_modules/next/dist/docs/` — this Next version has breaking changes
  vs. training-data knowledge.
- **Single source of truth for "which structures":** the tradie's persisted
  selection `roofing_measurements.included_indices` (1-based) →
  `resolveEffectiveIndices()` → `partitionRoofQuote()` in
  `lib/roofing/selection.ts`. This already flows correctly into pricing, the
  structures table, and the per-structure cards. **Only the image rendering
  ignores it.** Do not change selection or pricing logic.
- **Current figure model (after the `roof-pdf-outline-tracing` feature landed).**
  The PDF figure is now a **pair** (`renderFigurePair`): a **hero outline tracing**
  (`outlineImageSrc`, a self-contained SVG data URI built by `roofOutlineImageSrc`
  that already draws **every** structure — included solid, excluded faint) plus a
  **single aerial thumbnail** (`mapImageSrc`). The hero outline is therefore
  already multi-structure and correct; **the bug now lives only in the aerial
  photo**, which is still fetched from `…/static-map` with **no `?b=`** and so only
  ever shows structure #1.
- **Root cause (verified by code read):**
  - PDF: `ensureRoofQuotePdf()` builds a single `mapImageSrc` from
    `/api/roofing/q/<token>/static-map` with **no `?b=` building param**
    (`lib/quote/pdf.ts`), passed as the lone aerial thumb of the figure pair in
    `lib/roofing/report-html.ts`.
  - Customer page: the Google-satellite `<img>` at
    `app/q/roof/[token]/page.tsx` also calls `…/static-map` with **no `?b=`**.
  - The static-map route already supports `?b=N` to centre on the Nth (1-based)
    structure and only defaults to `firstVertexOf(quote)` when `b` is absent
    (`app/api/roofing/q/[token]/static-map/route.ts`). The fix is to pass `?b=`
    and render one **aerial** image per structure — **no change to the static-map
    route is required.**
  - The customer page's `RoofMap` outline component already receives **all**
    buildings (`buildings={mapBuildings}`) and is correct; only the satellite
    `<img>` beside it is single-structure.
- **Why the fix lives inside `ensureRoofQuotePdf` (not the callers).** The
  customer-download route caches `pdf_path`; the SMS send flow
  (`app/api/sms/inbound/route.ts`) generates and caches the PDF first, passing a
  **narrowed** `quote` and **no** `displayRows`. So per-structure images must be
  derived **inside** `ensureRoofQuotePdf` from the rendered quote's own
  structures, mapped back to their index in the full stored `row.quote` by the
  stable `buildingId`, so every entry point (route, SMS, file-store) produces the
  same multi-structure PDF regardless of whether it passes `displayRows`.
- The PDF must stay under the 5 MB MMS hard cap; the existing
  `renderQuotePdfCapped()` strips `<img>` tags on overflow
  (`lib/quote/pdf.ts:168-180`). `prepareImage()` (`lib/pdf/image.ts`) already
  downscales/compresses to a compact JPEG data URI and never throws (returns
  `null` on any failure).

## Requirements
1. **Unifying rule:** render *one captioned aerial image per structure shown in
   that view*, each centred via the existing
   `/api/roofing/q/<token>/static-map?b=<index1Based>` endpoint. The caption is
   the structure's `label` (e.g. "House", "Shed").
2. **PDF — `lib/quote/pdf.ts` (`ensureRoofQuotePdf`):** build an **ordered list of
   one prepared aerial image per included structure**. Derive the included set
   from the **rendered quote's own structures** (`(opts.quote ?? row.quote).structures`)
   — these are exactly the narrowed/included structures (excluded ones are already
   absent; inspection-but-included ones are present). Map each back to its 1-based
   index in the **full** stored `row.quote` via the pure helper (by `buildingId`).
   Fetch each image via
   `${APP_URL}/api/roofing/q/${publicToken}/static-map?b=${index1Based}` through
   `prepareImage()`, in **parallel** (`Promise.all`) to stay within the route's
   60s `maxDuration`. Keep computing the existing combined `outlineImageSrc` (hero)
   and the single `mapImageSrc` (used only for the single-structure fallback).
3. **PDF — `lib/roofing/report-html.ts` (`RoofReportInput` + `buildRoofQuoteReportHtml`):**
   accept the ordered aerial list
   `structureImages?: { label: string; src: string | null }[]` and render:
   - **2+ aerials** → the combined **outline hero** (`renderFigure(outlineImageSrc, …)`)
     followed by **one captioned `renderFigure(...)` per non-null aerial**, in
     order, captioned with the structure label.
   - **0–1 aerials** → the **existing** `renderFigurePair({ heroSrc: outlineImageSrc,
     thumbSrc: mapImageSrc, … })`, unchanged — so single-structure quotes render
     **byte-identically** to today.
   Skip `null` aerial entries with no broken markup.
4. **Customer page — `app/q/roof/[token]/page.tsx`:** replace the single
   Google-satellite `<img>` (line ~209) with **one `<img>` per structure shown in
   the current view**, each pointing at `…/static-map?b=<index1Based>` and
   captioned with the structure label:
   - **Pre-confirmation (picker) view** — one image per **measured building**
     (all `structureCards`).
   - **Confirmed (priced) view** — one image per **included** structure;
     **excluded** structures get no satellite image (consistent with their
     dimmed "Not included" card).
   Keep the `RoofMap` outline component unchanged (it already renders all
   buildings).
5. **Inspection-routed but included** structures **do** get an image (the
   structure is part of the job, pending an on-site look).
6. **Ordering:** images follow structure detection order — the same order as the
   structures table (PDF) and the per-structure cards (page).
7. **Indices are 1-based** end to end (matching `included_indices`,
   `resolveEffectiveIndices`, and the `?b=` param). Do not introduce 0-based
   indexing.
8. Factor the rendered→full index mapping and the `?b=` path into a small **pure
   helper** (`lib/roofing/structure-images.ts`) so it can be unit-tested without
   network/Gotenberg. Match rendered structures to the full quote by the stable
   `buildingId` (fall back to `label`); drop unmatched rather than guess.

## Non-goals
- The AI **"after-image"** preview on the customer page
  (`app/q/roof/[token]/page.tsx:274`, `/api/roofing/q/<token>/after-image`) — a
  separate single AI render, not the measured roof image. Out of scope; note for
  a possible follow-up.
- Any change to **pricing, routing, or the selection logic**
  (`lib/roofing/selection.ts`) — the included set is already correct.
- Any change to the **static-map route** itself — `?b=N` already works.
- The **dashboard** measure-results view (`/dashboard/roofing/measure`,
  `/m/[token]`) — only the customer PDF and customer quote page are in scope.
- New endpoints, new storage columns, or schema/migrations — none are needed.

## Constraints
- Next.js 16 App Router; read `AGENTS.md` + `node_modules/next/dist/docs/` before
  writing Next code.
- Reuse existing building blocks only: `static-map?b=N`, `prepareImage()`,
  `renderFigure()` / `renderFigurePair()`, `roofOutlineImageSrc()`,
  `renderQuotePdfCapped()`. Do not invent endpoints. One **new pure helper**
  (rendered→full index mapping) is permitted (see R8).
- Single-structure quotes must be **behaviourally unchanged** on both surfaces:
  the PDF keeps the existing outline-hero + aerial-thumb pair; the page keeps its
  single satellite card with the "Google satellite view" caption.
- The PDF must remain under the 5 MB MMS cap; rely on the existing strip-on-
  overflow guard and the compact-JPEG default in `prepareImage()`.
- Keep changes scoped to: `lib/quote/pdf.ts`, `lib/roofing/report-html.ts`,
  `app/q/roof/[token]/page.tsx` (+ a small pure helper and its test).

## Edge cases to handle
- **Two structures, both included → both surfaces** show two captioned images, in
  structure order.
- **Single-structure quote** → output identical to today (PDF: outline-hero +
  aerial-thumb pair; page: one satellite card).
- **Second structure excluded** (`included_indices` omits it) → its image is
  absent on both surfaces (PDF and confirmed page view).
- **Included structure routed to inspection** → image still shown, captioned with
  its label.
- **Missing/failed imagery for a structure** (`prepareImage()` returns `null`, or
  the static-map endpoint 404s) → that figure is omitted with no broken `<img>`
  and no embedded 404; other structures still render.
- **Three (or more) included structures on the PDF** → all render, and the PDF
  stays under 5 MB (strip-on-overflow fallback still applies if exceeded).
- **Pre-confirmation picker view with multiple buildings** → one image per
  measured building so the customer can tell the buildings apart when picking.
- **No `included_indices` set (null/empty)** → treated as "all structures"
  (existing `resolveEffectiveIndices` behaviour); every structure gets an image.

## Definition of done
- [ ] A 2-structure quote with both included renders the combined **outline hero
      plus 2 captioned aerial images, in order**, on the customer **PDF**.
- [ ] The same quote renders **2 captioned satellite images** on the customer
      **quote page** (confirmed/priced view), alongside the unchanged RoofMap.
- [ ] A single-structure quote renders the **existing outline-hero + aerial-thumb
      pair** on the PDF and a **single** satellite card on the page — identical to
      before the change.
- [ ] When the second structure is **excluded**, its aerial image does **not**
      appear on either surface; the priced total and structures list are unchanged.
      (It still appears, faint, in the combined outline hero — that is correct.)
- [ ] An **included** inspection-routed structure still shows its aerial image.
- [ ] A structure with **missing imagery** is skipped cleanly — no broken image,
      no 404 in the PDF, other structures unaffected.
- [ ] A **3-structure** PDF generates successfully and is **under 5 MB**.
- [ ] The rendered→full index mapping is a **pure helper** with unit tests covering:
      2 included → 2 entries in order; 1 structure → 1 entry mapped to its true
      index; excluded structure → omitted; inspection-but-included → included;
      cross-instance objects resolved by `buildingId`.
- [ ] `lib/roofing/report-html.test.ts` is extended to assert that each included
      structure's label appears as an aerial figcaption for a 2-structure input,
      that a single-structure input renders the unchanged pair, and that an
      excluded structure's label is **not** rendered as an aerial figcaption.
- [ ] This change introduces **no new type errors**: `lib/roofing/structure-images.ts`,
      `lib/roofing/report-html.ts`, `lib/quote/pdf.ts`, and the lines added to
      `app/q/roof/[token]/page.tsx` all type-check clean. (The working tree
      carries pre-existing, unrelated uncommitted drift — e.g. `lib/roofing/pricing.test.ts`,
      `lib/agents/client.test.ts`, env-var tests, and the `fullQuote.solar`
      access on the roofing page — whose type errors are **out of scope** for
      this spec and must not be "fixed" here.)
- [ ] All existing **roofing** vitest suites still pass (`lib/roofing/**` +
      `lib/filestore/source-doc.test.ts`).
- [ ] No changes to `lib/roofing/selection.ts`, the static-map route, pricing, or
      DB schema.

## Open questions
- None blocking. Follow-up to consider separately: should the AI "after-image"
  preview also be generated per-structure? (Out of scope here.)
