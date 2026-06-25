# Roof PDF outline tracing — Spec

## Objective
On the QuoteMate roofing **customer-quote PDF**, the roof figure is currently a raw Google
satellite/aerial photo of the property and its surroundings, while the figcaption claims it is
an outline. Replace that hero figure with a clean **coloured roof outline tracing on a plain
white background**, drawn from the polygon geometry we already persist — reproducing the look of
the live dashboard map (`RoofMap.tsx`: filled footprint + outline + classified coloured edges)
minus the aerial photo. The original satellite crop is retained as a small secondary thumbnail
for provenance. This is for the customer reading the quote PDF; the requirement comes from Jon
("just the drawing around the edge, not all the stuff around it") and was confirmed by Jeph
("coloured tracing on a plain image").

## Context / background
- App lives in `quotemate-automation/` (Next.js 16 App Router). The customer quote PDF is built
  as HTML and rendered to PDF by **Gotenberg** (headless Chromium), gated by `GOTENBERG_URL` /
  `gotenbergConfigured()`. There is no react-pdf/puppeteer.
- **Root cause of the bug:** the coloured tracing only exists in the browser
  (`app/dashboard/roofing/_components/RoofMap.tsx`, MapLibre GL vector layers composited over
  satellite tiles) and is never exported to an image. The PDF sources a *separate* image from
  `app/api/roofing/q/[token]/static-map/route.ts`, which proxies the Google Maps Static API
  (`maptype=satellite`, zoom 20, 640×480, optional single orange pin) and passes **no polygon
  paths** — so the PDF shows a bare satellite crop, and the caption "outlined from aerial imagery"
  describes an outline that isn't there.
- **The geometry needed is already stored and already in scope at PDF-generation time** (no DB
  change required):
  - `roofing_measurements.quote.structures[].metrics.polygon_geojson` =
    GeoJSON `Polygon` `{ type:'Polygon', coordinates:[[[lng,lat], …]] }`, EPSG:4326, outer ring,
    full vertex list (`lib/roofing/types.ts`).
  - `ensureRoofQuotePdf` (`lib/quote/pdf.ts:270`) already holds the full `quote` (`structures[]`)
    and `displayRows`, and builds `mapImageSrc` at ~lines 290–304 via
    `prepareImage(\`${APP_URL}/api/roofing/q/${publicToken}/static-map\`)`.
  - Pure, unit-tested helpers in `lib/roofing/map-utils.ts`: `polygonBBox`, `polygonCentroid`,
    `paddedBBox`, `edgeLengthM` (equirectangular), and
    `classifyEdges(polygon, form) -> ClassifiedEdge[]` with `kind: 'eave'|'hip'|'valley'|'ridge'|'unknown'`.
  - The figure is injected by `lib/roofing/report-html.ts` (~lines 199–202) via
    `renderFigure(mapImageSrc, caption)`; `renderFigure(null, …)` already no-ops. `renderFigure`
    and the figure CSS live in `lib/pdf/report-chrome.ts` (~lines 135–142 and ~259–262).
- **Fidelity caveat:** only the outer-ring footprint polygon is stored. The per-edge colours are a
  `classifyEdges` **heuristic** recomputed from polygon + roof form — there are no persisted
  interior ridge/hip/valley split points. The tracing must match what the dashboard already shows;
  it must **not** invent interior geometry.
- `included_indices int[]` (migration 140) / `displayRows` mark which structures the tradie kept.
  Excluded structures and inspection-required structures already appear (de-emphasised) in the
  existing PDF table.
- **Palette to match** (`RoofMap.tsx`): footprint fill `#FFC400` @ ~18% opacity; outer outline
  `#FFC400` ~2–3px; classified edges ~4px — `eave #FFFFFF`, `ridge #FFD23D`, `hip #FFC400`,
  `valley #14B8A6`, `unknown #7A8699`.

## Requirements
1. Add a new **pure** module `lib/roofing/roof-outline-svg.ts` exporting a function (suggested
   signature `buildRoofOutlineSvg(structures, opts: { width: number; height: number }): string | null`)
   that returns a self-contained inline `<svg>` string (or a `data:image/svg+xml;base64,…` URI)
   of the coloured roof outline, or `null` when no usable geometry exists. It must reuse the
   `lib/roofing/map-utils.ts` helpers and must not re-implement projection or edge classification.
2. The tracing is rendered on a **solid white background**, `viewBox` ≈ `1000×750`, sized to fit
   the existing figure CSS (`max-height: 420px`, `object-fit: contain`).
3. Projection is **equirectangular, north-up, aspect-ratio-preserving**, computed from lng/lat:
   `x = (lng − lng0) · 111320 · cos(lat0)` and `y = −(lat − lat0) · 110574` (negate `y` so north
   renders up), then fit to the canvas with ~8–10% padding (mirror `paddedBBox`). All drawn
   structures share **one combined bounding box / coordinate frame** so relative position and
   scale between buildings are correct.
4. Edge colouring **matches the dashboard** via `classifyEdges`: footprint fill `#FFC400` @ ~18%,
   outer outline `#FFC400` ~2–3px, and per-edge ~4px strokes coloured `eave #FFFFFF`,
   `ridge #FFD23D`, `hip #FFC400`, `valley #14B8A6`, `unknown #7A8699`.
5. **Draw all structures**, not only the priced ones: structures that are included/priced
   (`displayRows` / `included_indices`) render solid; **excluded** structures render **faint and
   dashed** (de-emphasised, like the dashboard) within the same shared frame.
6. The **satellite crop is retained as a small secondary thumbnail**, not the hero. The outline
   tracing is the primary/hero figure; the existing Google Static API image (built via the
   unchanged `static-map` route) appears as a smaller reference image beside or below the tracing.
7. Wire the tracing into `ensureRoofQuotePdf` (`lib/quote/pdf.ts`): build the outline-SVG source
   from the quote's structures (respecting `opts.displayRows` for the included/excluded split) and
   pass it to the report builder as the hero image, while still passing the satellite
   `mapImageSrc` for the thumbnail. The SVG is self-contained, so it does **not** go through
   `prepareImage()`; pass it as a `data:image/svg+xml;base64,…` URI (the report renders it via an
   `<img src>`).
8. Update `lib/roofing/report-html.ts` / `lib/pdf/report-chrome.ts` to render a **two-image
   figure**: hero outline tracing + small satellite thumbnail, with thumbnail CSS added. Update the
   figcaption so it no longer claims the aerial photo is the outline (e.g. hero caption "Roof
   outline traced from your measured roof areas"; thumbnail labelled as the aerial reference).
9. Add a unit test for `buildRoofOutlineSvg` in the style of `lib/roofing/map-utils.ts` /
   `lib/roofing/google-maps.test.ts`.

## Non-goals
- No database migration; no new persisted geometry (no interior ridge/hip/valley split points).
- No new environment variable and no new external API call. (The satellite thumbnail keeps using
  the existing `static-map` route/Google key already in place.)
- No headless-browser screenshot of the live MapLibre map.
- **Do not change the behaviour of `app/api/roofing/q/[token]/static-map/route.ts`** — it still
  backs the web `/q/roof/[token]` hero and now also feeds the PDF thumbnail. (It is *used*, just
  not modified.)
- No change to pricing, routing, the web quote page, or the solar/paint PDFs.
- Do not "fix" the stale `CLAUDE.md` "PDF: None" line as part of this work.
- Inspection-routed roofs already produce no priced quote PDF — do not change that guard.

## Constraints
- Stack: TypeScript, Next.js 16 App Router, Gotenberg HTML→PDF. **Read `quotemate-automation/AGENTS.md`
  and the relevant `node_modules/next/dist/docs/` guide before editing any route/Next code** — this
  Next has breaking changes vs. common priors.
- `ensureRoofQuotePdf` is wrapped to be **non-fatal** (returns `null` / logs on failure, never
  throws). All new code on this path must preserve that contract.
- Reuse `lib/roofing/map-utils.ts`; do not duplicate its projection/classification math.
- GeoJSON coordinate order is `[lng, lat]`. The polygon's closing vertex repeats the first
  (existing helpers already account for this).
- The generated PDF is hard-capped (~5 MB, MMS limit) with a re-render-without-image fallback; the
  inline SVG must stay small (it is vector text, so this is comfortably satisfied).

## Edge cases to handle
- Structure with a malformed or `< 4`-vertex polygon → skip that structure; still draw the others.
- No structure has usable polygon geometry → `buildRoofOutlineSvg` returns `null`; the hero figure
  is omitted (and the figure block degrades to thumbnail-only or nothing, never an error).
- Satellite thumbnail fetch fails / returns no image → omit the thumbnail; the outline tracing still
  renders as the figure (the two images are independent).
- Multi-building job with included + excluded structures → included drawn solid, excluded drawn
  faint/dashed, all in one shared coordinate frame at correct relative scale.
- Single-structure job → the lone footprint fills the padded canvas without distortion (aspect
  preserved).
- Inspection-routed roof (no committable price) → no priced PDF is generated (unchanged guard); no
  tracing work runs.
- Degenerate geometry (all vertices collinear / zero-area bbox) → skip rather than divide-by-zero in
  the fit-to-canvas scaling.
- Gotenberg not configured (dev) → `ensureRoofQuotePdf` returns `null` as today; no regression.

## Definition of done
- [ ] A generated roofing-quote PDF shows a coloured roof **outline tracing on solid white** as the
      hero roof figure — no aerial photo as the hero, no surrounding map context in the tracing.
- [ ] The tracing visually corresponds to the building footprint(s) and uses the `RoofMap.tsx`
      palette (multi-colour classified edges + `#FFC400` fill/outline).
- [ ] Multi-building jobs render **all** structures in one shared frame: included/priced solid,
      excluded faint/dashed.
- [ ] The original satellite image still appears on the PDF as a **small secondary thumbnail**, not
      the hero.
- [ ] The figcaption no longer claims the aerial photo is the outline; hero and thumbnail are
      captioned/labelled correctly.
- [ ] Missing/malformed geometry degrades gracefully per the edge cases above, and
      `ensureRoofQuotePdf` never throws.
- [ ] No DB migration, no new env var, and no new external API call were added.
- [ ] `app/api/roofing/q/[token]/static-map/route.ts` is unchanged in behaviour.
- [ ] A unit test for `buildRoofOutlineSvg` passes (known polygon → expected path commands +
      per-`kind` colours; aspect preserved; multi-polygon shared frame; `null` on empty/malformed
      input).
- [ ] Manually verified via `GET /api/q/roof/[token]/pdf` for one single-structure and one
      multi-structure token (force a rebuild by passing `regenerate` or clearing `pdf_path`, since
      the PDF is cached at `roofs/{publicToken}.pdf` in the `quote-pdfs` bucket).

## Open questions
- Thumbnail placement and exact size (beside vs. below the hero; target px/width) is left to the
  implementer to fit the existing report layout cleanly — confirm against a rendered PDF.
- Whether excluded structures should carry a tiny inline label in the tracing (e.g. "not included")
  or rely on the existing table for that distinction — default to no label unless it reads
  ambiguously in a rendered multi-structure PDF.

## Addendum — consolidation + deferred follow-ups (2026-06-25)

This file is now the **single source of truth** for Jon's "clean roof tracing"
request. A duplicate spec (`specs/roofing-pdf-roof-tracing.md`, produced from a
separate product interview) was folded into this section and deleted. The PDF
tracing specified above is **built and green** — the roofing unit suite,
including `lib/roofing/roof-outline-svg.test.ts`, passes (498 roofing tests).

Deferred follow-ups captured from that interview — **NOT yet built**, held
because the customer web quote page `app/q/roof/[token]/page.tsx` (the image
region) is under active development by the `roofing-pdf-multi-structure-images`
work; implementing now would collide and risk the green state:

1. **Web-hero parity** — replace the Google satellite panel on
   `app/q/roof/[token]/page.tsx` with the same outline tracing
   (`roofOutlineImageSrc`), so the customer web quote matches the PDF. Needs a
   dark-theme / transparent-background variant of `buildRoofOutlineSvg` to sit
   on the Maintain navy card (it currently renders on solid white). Sequence
   AFTER the multi-structure web image work settles.
2. **Per-structure m² labels** — draw `<label> — <sloped m²>` at each included
   structure's centroid in the tracing (extends `buildRoofOutlineSvg`). This
   spec's open question defaulted to "no label"; the interview asked for labels
   — revisit alongside (1).
