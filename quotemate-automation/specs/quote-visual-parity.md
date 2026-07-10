# Quote visual parity: property imagery + calculations in every trade PDF, and an AI-annotated roof layout map

## Goal

Every roofing, solar, painting and commercial-painting quote PDF carries the same property
imagery (aerial / street view) and measurement calculations its customer page already shows —
and the roofing surfaces (customer page `/q/roof/[token]`, tradie measurements page `/m/[token]`,
roofing PDF) gain an AI-proposed, colour-coded roof layout map with a legend and deterministic
material quantities. Why: the downloaded PDF today (generic template) is a bare price table,
while the customer page shows satellite imagery and measurement evidence — the customer paying a
deposit off the PDF can't see what the money buys.

## Role

Principal engineer for this repo. Reason before acting; read files before describing them;
parallel independent calls, sequential dependent ones; never guess params. Act directly on
reversible edits; confirm before destructive actions.

## Context (all grounded in code read on 2026-07-10)

**The PDF pipeline** (`lib/quote/pdf.ts`):
- `ensureQuotePdf` renders quotes-table rows (electrical / plumbing / **promoted roofing** /
  **commercial_painting**) through the GENERIC template `buildQuoteReportHtml`
  (`lib/quote/report-html.ts`, `REPORT_TEMPLATE_VERSION = 2`). It embeds NO property imagery.
  Caching: `quotes.pdf_path` + `quotes.pdf_signature` (`lib/quote/pdf-signature.ts`) — the
  signature folds in `REPORT_TEMPLATE_VERSION`, so bumping the version invalidates every cached
  generic PDF exactly once.
- `renderQuoteReportHtml(quoteId)` (same file) renders the SAME document for the dashboard
  viewer's live preview via `/api/q/[token]/html` (`app/dashboard/quote/[token]/page.tsx:111`) —
  anything added to the shared builder appears in both the preview and the PDF, never drifts.
- `ensureRoofQuotePdf` (roofing_measurements path) ALREADY embeds the roof-outline SVG
  (`roofOutlineImageSrc`) + per-structure aerials via
  `prepareImage(`${APP_URL}${structureStaticMapPath(publicToken, n)}`)` (pdf.ts:439-477) —
  this is the established server-side image-embedding pattern (`lib/pdf/image.ts` `prepareImage`
  fetches and inlines as data URI).
- `ensureSolarQuotePdf` already embeds `staticMapUrl` + `fluxImageUrl` (gated on the cached
  asset existing, pdf.ts:547-552) — but NOT the panels-after visual the customer page shows.
- `ensurePaintingPdf` embeds NO imagery and passes `quoteViewUrl: null` with a stale comment
  ("No /q/paint/[token] customer page exists yet") — `app/q/paint/[token]/page.tsx` EXISTS.
- `renderQuotePdfCapped` enforces the 5 MB MMS cap by stripping `<img>` on overflow — keep
  images ≤ 640 px wide.

**Customer pages / parity gaps:**
- `/q/[token]` (generic) renders `RoofHeroStrip` for roofing-trade quotes
  (`app/q/[token]/page.tsx:953-962`): satellite snapshot via the share-token-gated proxy
  `/api/q/[token]/static-map?address=…&zoom=20&w=640&h=420` + a stat grid from
  `roofScopeStats(intake.scope)` (`lib/quote/trade-scope.ts`) — sloped area, material, form,
  pitch, hips·valleys, ridge lm, storeys, footprint — plus the "AI estimate from aerial imagery"
  disclaimer. It renders `CommercialPaintDetails` for commercial-painting quotes. NONE of this
  reaches the generic PDF. **This is the exact gap in the user's screenshot** (a promoted
  roofing quote rendered by the generic template).
- `/q/roof/[token]` (roofing_measurements): satellite + measured outlines + per-structure
  metrics + AI after-image — already rich; PDF already has outline + aerials.
- `/q/solar/[token]`: static map (:388), panels-after AI image (:441), flux heatmap (:615) —
  PDF lacks ONLY the panels-after figure. Cached on `solar_estimates.panels_image_path` +
  `panels_image_status` (`lib/solar/panels-after.ts:66-71`); served by
  `/api/solar/q/[token]/panels-after`.
- `/q/paint/[token]` (painting_measurements, keyed by `public_token`): NO imagery at all.
  Token proxies ALREADY exist keyed by the same `public_token`:
  `/api/painting/q/[token]/street-view` and `/api/painting/q/[token]/after-image` (cached via
  `painting_measurements.preview_image_path`/`preview_status`, migration 169 — built by the
  in-flight `specs/painting-measure-parity.md` work in the working tree; build ON it, don't redo
  it). The tradie `/p/[token]` page shows the two-up Street View + AI repaint figures — mirror
  that section.
- `/q/commercial-paint/[token]` (paint_runs by `public_token`, `site_address` column): measured
  takeoff table only, no property visual.

**Roof layout map building blocks (requirement 2):**
- Doctrine (repo-wide): vision only CLASSIFIES; ALL arithmetic (quantities, prices) is
  deterministic in code. So the layout map is: LLM returns zones-as-JSON → deterministic SVG
  compositing. NOT image-to-image generation of a labelled picture.
- Gemini adapter: `lib/ig-engine/providers/gemini.ts` — `geminiProvider.generateText({prompt,
  images, responseSchema, temperature: 0})` returns structured JSON (pattern:
  `MATERIAL_DETECTION_SCHEMA` + `parseMaterialDetection` in `lib/painting/material.ts:108,137`;
  `SOLAR_DETECTION_SCHEMA` in `lib/roofing/solar.ts:155`). Vision model env
  `GEMINI_VISION_MODEL` (roofing default `gemini-2.5-flash`).
- Cache/CAS pattern: `lib/roofing/roof-after.ts` — CAS-claim a status column
  (`.or('preview_status.is.null,…')` → 'generating'), persist result, 'failed' on error, never
  throw. DI-testable variant: `lib/painting/paint-after.ts` (`PaintAfterDeps`).
- Colour-coded overlay drawing: `lib/roofing/roof-outline-svg.ts` (`EDGE_COLORS`,
  lng/lat→pixel projection, coloured polygon/edge SVG). Overlay-on-static-map projection:
  `app/q/solar/[token]/BuildingPicker.tsx` + `lib/solar/static-map-center.ts` (SVG positioned
  over the static-map `<img>` with Web-Mercator maths).
- Geometry available per structure (`lib/roofing/types.ts`): `polygon_geojson` (EPSG:4326),
  `ridge_lm`, `hips`/`valleys` (+ derived `hips_lm`/`valleys_lm`), `sloped_area_m2`,
  `footprint_m2`, `storeys`. Job type enum includes `full_reroof`, `patch_repair`,
  `flashing_repair` (types.ts:50-55) — the layout mode derives from the stored job type.
- Tradie measurements page: `/m/[token]` shows ONE satellite `<img>` via
  `/api/roofing/q/${public_token}/static-map` (`app/m/[token]/page.tsx:212-222`);
  `MeasurementReview.tsx` renders the review body. NOTE: both files carry uncommitted in-flight
  changes — read the CURRENT tree before editing and do not revert them.
- Migrations: latest is 169; **this work's migration is 170**. Convention:
  `sql/migrations/170_*.sql` + `scripts/run-migration-170.mjs` (copy 169's runner), MUST end
  with `notify pgrst, 'reload schema';`, apply with
  `node --env-file=.env.local scripts/run-migration-170.mjs`, keep `sql/init.sql`
  representative.

**Gates (confirmed from package.json via specs/painting-measure-parity.md):** `npm test` =
`vitest run --testTimeout=20000` (node env, colocated `lib/**/*.test.ts`, DI/fake-object style —
NO `vi.mock`); `npm run typecheck` = `tsc --noEmit` (there is NO `npm run check`);
`npm run test:e2e` = Playwright (`tests/e2e/`, public pages only, port 3100, seeded-row pattern
with service-role insert + `test.skip(!seedable, …)`). Authed dashboard surfaces are verified
with the `verify` skill, not e2e. Next.js 16: read `node_modules/next/dist/docs/` before writing
route/page code; `params` is a Promise.

## Task

1. **R1 — Property-visuals section in the generic quotes-row report** (covers the screenshot).
   a. `lib/quote/report-html.ts`: add an optional `propertyVisuals` field to `QuoteReportInput`:
      `{ imageSrc: string | null; caption: string; stats: Array<{ label: string; value: string }>;
      disclaimer: string | null } | null`. Render it as a section between the scope-of-works and
      the tier sections: the image (max-width 100%, ≤640px source) + a compact stat grid +
      the disclaimer line. `null` → byte-identical body to today. Bump
      `REPORT_TEMPLATE_VERSION` to 3 (this is the cache invalidation — do NOT touch
      `pdf-signature.ts`).
   b. `lib/quote/pdf.ts`: extend `IntakePdfRow`/the intake select with `address, suburb, scope`;
      in `buildQuoteReportInput` (shared by PDF + live HTML preview) build `propertyVisuals`:
      - roofing trade: stats from `roofScopeStats(intake.scope)` (same labels/format as
        `RoofHeroStrip`), disclaimer = the RoofHeroStrip "AI estimate from aerial imagery…" copy.
      - commercial_painting trade: stats from the same intake-scope takeoff summary the
        `/q/[token]` page derives (reuse its existing helper in `lib/quote/trade-scope.ts` or the
        page's derivation — read the page first), no disclaimer.
      - other trades (electrical/plumbing/…): `null`.
      The IMAGE is resolved by the caller because it's I/O: in `ensureQuotePdf` fetch it
      server-side with `prepareImage(`${APP_URL}/api/q/${share_token}/static-map?address=…&zoom=20&w=640&h=420`)`
      when the intake has an address (mirror ensureRoofQuotePdf's pattern, null-safe on failure);
      in `renderQuoteReportHtml` pass the RELATIVE proxy URL (`/api/q/${token}/static-map?…`) so
      the dashboard preview loads it like the customer page does. No address → `imageSrc: null`
      (section renders stats-only); no stats AND no image → `propertyVisuals: null`.
2. **R2 — Painting PDF imagery + live link** (`lib/painting/report-html.ts` +
   `ensurePaintingPdf` in `lib/quote/pdf.ts`).
   a. Add optional `streetViewSrc?: string | null` and `afterImageSrc?: string | null` to
      `PaintingReportInput`; render them as a two-up figure block (captions "Front of the
      property · Google Street View" / "Fresh repaint · AI preview") between the intro and the
      options grid; omit cleanly when null. (The surface takeoff table + area/confidence meta
      already render — do not duplicate them.)
   b. In `ensurePaintingPdf`: select `preview_status, preview_image_path` too;
      `streetViewSrc = await prepareImage(`${APP_URL}/api/painting/q/${publicToken}/street-view`)`;
      `afterImageSrc` ONLY when `preview_status === 'ready'` (never trigger a billable Gemini
      render from PDF generation) via the after-image proxy. Set
      `quoteViewUrl: `${APP_URL}/q/paint/${publicToken}`` and delete the stale comment.
3. **R3 — `/q/paint/[token]` customer page imagery + measurement summary.** In
   `app/q/paint/[token]/page.tsx`, add the two-up Street View + AI repaint figure section
   (mirror the `/p/[token]` image section markup and its server-side FREE Street View metadata
   pre-check — `buildStreetViewMetadataUrl`/`parseStreetViewMetadata` from
   `lib/painting/streetview.ts`; no pano → render nothing). Image srcs are the existing
   public_token proxies. Keep every existing block on the page.
4. **R4 — Commercial-paint tender page aerial.** New token-gated proxy
   `app/api/commercial-paint/q/[token]/static-map/route.ts` (GET) mirroring
   `app/api/roofing/q/[token]/static-map/route.ts`: resolve `paint_runs.site_address` by
   `public_token` (400 short token / 404 no row or no address / 503 no `GOOGLE_MAPS_API_KEY`),
   proxy Google Maps Static satellite, stream with `Cache-Control: public, max-age=86400,
   immutable`. In `app/q/commercial-paint/[token]/page.tsx`, when `site_address` is present
   render the aerial figure (captioned "Site aerial · Google Maps") above the takeoff section.
5. **R5 — Solar PDF panels-after figure.** In `ensureSolarQuotePdf` select
   `panels_image_status, panels_image_path`; pass a new optional `panelsAfterUrl` into
   `buildSolarQuoteReportHtml` ONLY when `panels_image_status === 'ready'`
   (`${APP_URL}/api/solar/q/${publicToken}/panels-after`, same gating style as `fluxImageUrl`);
   render it in `lib/solar/report-html.ts` as a captioned figure near the static map. Never
   trigger generation from the PDF path.
6. **R6 — AI roof layout map** (requirement 2 of the raw request).
   a. Migration 170: `alter table public.roofing_measurements add column if not exists
      layout_plan jsonb, add column if not exists layout_status text;` + runner script + apply +
      init.sql. (`layout_status`: null|'generating'|'ready'|'failed'.)
   b. New PURE module `lib/roofing/layout-plan.ts`:
      - `LayoutZone = { color: 'teal'|'purple'|'black'|'red'|'yellow'|'orange'|'green';
        label: string; placement: 'perimeter'|'ridge'|'structure'; structureIndex: number }`,
        `LayoutPlan = { header: string; mode: 'patch_repair'|'reroof'|'upgrade';
        zones: LayoutZone[] }`.
      - `layoutModeForJob(jobType)` maps the stored roofing job type (types.ts:50-55) →
        `patch_repair` for patch/flashing repairs, `upgrade` when the quote's Best tier
        upgrades material, else `reroof`.
      - `MODE_PALETTES`: distinct colour subsets per mode (repair-mode zones lean
        yellow/orange/red; reroof teal/orange/red/black/green; upgrade adds purple) — assert
        distinctness in tests.
      - `buildLayoutPlanPrompt({ address, mode, structures, scopeSummary })` — pure prompt:
        "act as an experienced Australian roofing tradie; propose the work strategy for this
        <mode> job as zones over the aerial; labels describe WORK ONLY — no prices, no
        quantities"; `LAYOUT_PLAN_SCHEMA` (Gemini responseSchema, pattern material.ts:108);
        `parseLayoutPlan` fence-tolerant parser that also DROPS any zone whose label contains a
        `$` amount or whose structureIndex is out of range (hard money-path guard).
      - `layoutMaterials(metrics, mode)` — DETERMINISTIC quantities from stored geometry only
        (named constants, no LLM input): sheets ≈ sloped_area_m2 / 0.762m cover width / 5.5m
        avg length × 1.1 waste (round up), screws ≈ sloped_area_m2 × 9/m², battens lm ≈
        sloped_area_m2 × 1.1, ridge capping lm = ridge_lm, edge protection lm ≈ footprint
        perimeter from `polygon_geojson` (fallback 4×√footprint_m2). Returns
        `Array<{ item: string; qty: number; unit: string }>`; patch_repair mode scales areas by
        the repaired fraction if known, else annotates "subject to on-site measure".
   c. Orchestrator `generateRoofLayoutPlan(publicToken, deps?)` in the same module (DI pattern
      of `lib/painting/paint-after.ts`): read row → CAS-claim `layout_status='generating'`
      (`.or('layout_status.is.null,layout_status.eq.failed')`) → fetch the satellite aerial
      server-side (existing static-map URL builder) → `geminiProvider.generateText` with the
      schema + aerial image, temperature 0 → parse → persist `layout_plan` + `'ready'`;
      any failure → `'failed'`, never throws.
   d. New PURE `lib/roofing/layout-overlay-svg.ts`: `buildLayoutOverlaySvg({ zones, structures,
      center, zoom, width, height })` → SVG string drawing each zone deterministically from
      stored geometry (placement 'structure' → the structure's polygon outline in the zone
      colour; 'perimeter' → the polygon dilated outward a few px; 'ridge' → the polygon's
      longest internal axis as a line) using the Web-Mercator lng/lat→pixel projection from
      `lib/solar/static-map-center.ts` / the roof-outline-svg maths. Empty zones → null.
   e. Surfaces (legend = colour swatch + label list, header line above the figure — the
      user's example: "Please see the roof layout map below to provide clarity on your quote!"):
      - `/m/[token]` (`app/m/[token]/page.tsx` + `MeasurementReview.tsx`): when
        `layout_status === 'ready'`, render the overlay figure (satellite `<img>` + absolutely
        positioned SVG), legend, AND the `layoutMaterials` quantities table (tradie-only). Add a
        "Generate layout map" action that POSTs a new token-gated route
        `app/api/roofing/q/[token]/layout-plan/route.ts` (POST = generate via
        `generateRoofLayoutPlan`, GET = return the stored plan; generation is tradie-initiated
        from /m only).
      - `/q/roof/[token]`: for CONFIRMED rows with `layout_status === 'ready'`, render header +
        overlay figure + legend (NO material quantities, NO prices). Never triggers generation.
      - Roofing PDF (`lib/roofing/report-html.ts` + `ensureRoofQuotePdf`): optional
        `layoutOverlay: { imageSrc: string; legend: Array<{color,label}>; header: string } |
        null` — composited server-side (aerial via prepareImage + the SVG as an overlaid data
        URI inside a positioned figure). Only when ready; null renders today's PDF unchanged.
7. **Tests — write FIRST (Red) per acceptance criteria below**, then implement (Green), then
   `/verify` with `/playwright-cli` on the changed public pages, then `/review` + `/code-review`.

## Constraints

- NEVER trigger a billable Gemini render from PDF generation or a customer page load: AI images
  (after-image, panels-after, layout plan) embed/display ONLY when their status column is
  `'ready'`. Generation is tradie-initiated (or already-cached) exclusively.
- Money-path doctrine: the LLM layout plan carries labels/strategy ONLY — `parseLayoutPlan`
  strips `$` amounts; all quantities come from `layoutMaterials` (deterministic). No LLM output
  ever renders as a price or quantity.
- Electrical/plumbing reports must be unchanged except the REPORT_TEMPLATE_VERSION bump
  (`propertyVisuals` is null for them). Do not touch the tier/pricing markup.
- Keep PDFs under the 5 MB cap: source images ≤ 640 px wide; `renderQuotePdfCapped` stays the
  backstop.
- `GOOGLE_MAPS_API_KEY` / `GEMINI_API_KEY` stay server-side; pages and PDFs only ever reference
  `/api/**` token-gated proxies or data URIs prepared server-side.
- The working tree has uncommitted in-flight painting-parity work (`app/m/[token]/*`,
  `app/dashboard/painting/page.tsx`, `app/p/[token]/page.tsx`, `lib/painting/paint-after.ts`,
  `lib/painting/progress.ts`, new tests). Build on it; do NOT revert or duplicate it. Do not
  commit the stray junk files at repo root (`'`, `126)`, `table`, etc.) — leave them alone.
- One migration only (170), following the repo convention incl. `notify pgrst, 'reload schema'`.
- House test style: node-env vitest, DI/fake objects (no `vi.mock`), colocated `*.test.ts`;
  e2e only on public token pages with the seeded-row skip pattern; assert on markup/attributes,
  never on upstream Google/Gemini bytes; e2e must never trigger an AI render (seed
  `layout_status`/`preview_status` explicitly).
- Read `node_modules/next/dist/docs/` before writing the new route handlers (Next 16 promise
  params etc.). Delete any scratch files created along the way.

## Acceptance criteria & gates

1. `npm test` passes, including NEW tests:
   - `lib/quote/report-html.test.ts` (extend): `propertyVisuals` section renders image + stats +
     disclaimer when provided; body is unchanged when `null`; `REPORT_TEMPLATE_VERSION === 3`.
   - `lib/painting/report-html.test.ts` (extend): two-up figures render when srcs provided,
     omitted when null; closing line carries the live `/q/paint/` link when passed.
   - `lib/solar/report-html.test.ts` (extend): panels-after figure renders only when URL passed.
   - `lib/roofing/layout-plan.test.ts` (new): `layoutModeForJob` mapping incl. patch/flashing →
     patch_repair; `MODE_PALETTES` pairwise-distinct; `buildLayoutPlanPrompt` pure + contains
     the no-prices instruction; `parseLayoutPlan` tolerates fences, drops `$`-labelled and
     out-of-range zones; `layoutMaterials` exact quantities from a fixture metrics object;
     `generateRoofLayoutPlan` with fake deps: ready short-circuit, CAS busy path, failure →
     `'failed'`.
   - `lib/roofing/layout-overlay-svg.test.ts` (new): zones → SVG containing the zone colours and
     one element per zone; empty → null.
   - `lib/roofing/report-html.test.ts` (extend): layout section + legend render when
     `layoutOverlay` passed; absent when null.
2. `npm run typecheck` passes.
3. `npm run test:e2e` passes, including (seeded-row pattern, skip-without-env):
   - `tests/e2e/paint-customer-page.spec.ts` (new): seeded `painting_measurements` row
     (`preview_status:'failed'` so no render) → `/q/paint/<public_token>` shows the street-view
     figure markup per the metadata-check semantics and all pre-existing blocks.
   - `tests/e2e/roofing-quote-workflow.spec.ts` (extend or sibling): seeded CONFIRMED roofing
     row with a fixture `layout_plan` + `layout_status:'ready'` → `/q/roof/<token>` renders the
     layout header, figure and legend; a row with `layout_status` null renders no layout section.
   - `tests/e2e/commercial-paint-page.spec.ts` (new): seeded `paint_runs` row with
     `site_address` → aerial figure present; without → absent.
4. `/verify` (with `/playwright-cli`) evidence on the running dev server: (i) a roofing
   quotes-row report at `/dashboard/quote/[token]` and its downloaded PDF both show the
   satellite + stat grid; (ii) `/q/paint/<token>` shows the imagery; (iii) `/m/<token>`
   generates and shows the layout map + quantities; (iv) `/q/roof/<token>` shows the layout map
   for the same row; (v) the roofing PDF re-downloaded after generation contains the layout
   figure. Screenshots as proof; throwaway scripts deleted.
5. `/review` confirms every R1–R6 item; `/code-review` reports no blocker/major findings
   (surface all findings with confidence + severity; fix blockers/majors; log minors).

## Examples

<example>
Server-side image embedding + gating to imitate: lib/quote/pdf.ts ensureRoofQuotePdf
(prepareImage over `${APP_URL}/api/...` proxies, pdf.ts:439-477) and ensureSolarQuotePdf's
fluxImageUrl "only when the cached asset exists" gate (pdf.ts:547-552). R1/R2/R5 follow these
exactly.
</example>

<example>
Customer-page visual + stats block to mirror in the generic PDF: app/q/[token]/RoofHeroStrip.tsx
(stat labels/format + disclaimer copy) fed by roofScopeStats(intake.scope) at
app/q/[token]/page.tsx:219-223 and :953-962.
</example>

<example>
Structured-vision JSON + tolerant parsing to imitate for the layout plan:
lib/painting/material.ts (buildMaterialDetectPrompt, MATERIAL_DETECTION_SCHEMA,
parseMaterialDetection) called via geminiProvider.generateText — plus the CAS/cache orchestration
of lib/painting/paint-after.ts (DI deps for unit tests) and lib/roofing/roof-after.ts.
</example>

<example>
Deterministic coloured overlay geometry to extend: lib/roofing/roof-outline-svg.ts (EDGE_COLORS,
polygon→pixel projection, data-URI export) and the SVG-over-static-map projection in
app/q/solar/[token]/BuildingPicker.tsx with lib/solar/static-map-center.ts.
</example>
