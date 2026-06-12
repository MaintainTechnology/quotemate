# Solar Felt Tab — design spec

**Date:** 2026-06-13
**Status:** IMPLEMENTED 2026-06-13 — all phases (0–4) shipped behind `FELT_TAB_ENABLED` (default off; `true` in dev `.env.local`). Phase 0 verified live against the real Felt workspace (7/7: map create satellite/view_only, two-step presigned GeoJSON upload, processing poll, FSL numeric style, **tokenless view_only embed**, GeoTIFF raster via import_url, delete). Migration 111 applied to Supabase. Full vitest suite green (3,146 tests) + production `next build` clean. Implementation notes: provisioning lives in `lib/solar/felt-provision.ts` (re-downloads the raster bytes itself rather than hooking `sun-assets.ts` — the dataLayers URLs are re-fetched fresh, so no shared state); the AI brief is `lib/solar/ai-brief.ts` with the numeric-token grounding gate; `deriveFeltStatus` counts still-processing layers as `partial` (lazy-repairable), not `failed`.
**Sibling specs:** `2026-06-12-solar-premium-quote-design.md` (Google-path premium quote, shipped behind `SOLAR_PREMIUM_QUOTE`). The Pylon and OpenSolar tab specs (2026-06-12) were both REMOVED 2026-06-13 by owner decision — this spec deliberately repeats their winning patterns (sub-tab UX, separate env gate, asset caching, confirm gate parity) and avoids what got them cut (a second money path; design-import friction). **The Felt tab keeps the instant address-first flow and the existing money path untouched.**

---

## 1. Goal

Add a **Felt tab** to the Solar Estimate area: a third quoting path with the **same customer journey as the instant estimate** — customer opens the share link, enters their address, the engine drafts the estimate — but the deliverable is upgraded from static imagery to an **interactive Felt map experience**, plus AI-written roof intelligence:

- **Interactive satellite map** of the customer's roof (Felt map, satellite basemap, centred on the geocode).
- **Panel layout layer** — every proposed panel as a real geo-rectangle, colour-ramped by its yearly DC output.
- **Sun / solar-exposure heat map** — the Google Solar `annualFlux` GeoTIFF uploaded to Felt as a raster layer with a continuous kWh/m²/yr colour ramp + legend.
- **Roof relief (hillshade)** — the `dsm` GeoTIFF styled as a hillshade layer (shading/terrain context).
- **Roof plane markers** — pitch, azimuth, area and sun-score per plane, colour-coded (`excellent`/`good`/`moderate`/`limited` from `lib/solar/sun-score.ts` — built, currently unused in any UI).
- **Layer toggles + legend** — Felt's native legend lets the customer flip between Panels / Sun exposure / Elevation.
- **AI roof intelligence brief** — an Anthropic-generated narrative (grounded, schema-validated — see §4.6) explaining the layout choice, best plane, and seasonal sun behaviour.
- **AI "panels installed" concept image** — the existing Gemini `panels-after` feature, reused as-is.
- **Same quote chrome as the instant path:** tier pricing, STC rebate, confirm-and-release human-in-loop gate, Stripe deposit checkout, customer SMS, and the Gotenberg **PDF quote** (with map snapshot + flux heatmap baked in, since an iframe can't print).

### The decisive architectural fact

**Felt is a GIS visualization platform, not a solar calculator.** It computes no irradiance, no sizing, no pricing. Every number on this path comes from the **existing deterministic engine** (`runSolarEstimate` in `lib/solar/intake.ts`: Google Solar `buildingInsights` → sizing → STC → pricing → economics). Felt's job is the *map deliverable*; the LLMs' job is *narrative and imagery*; **neither touches the money path** (repo grounding rule). Concretely:

- The Felt path produces ordinary `solar_estimates` rows through the ordinary engine. Felt provisioning is a **post-persist enrichment step** that can fail without affecting the estimate (same posture as `sun-assets.ts`).
- Anthropic writes prose only, from a frozen facts payload, schema-validated, numbers cross-checked against the input (§4.6). Gemini generates labelled-illustrative imagery only.

### Why this is more than "Google Solar API with extra steps"

The instant path renders static PNGs (Google Static Map + our server-rendered flux PNG). The Felt path turns the same source data into a **live, explorable map**: pan/zoom on real satellite imagery, per-panel popups with yearly kWh, a real raster heat map with a legend (not a pre-rendered overlay), hillshade relief, plane-by-plane sun scores, and a shareable map URL the tradie can also open in Felt's own editor to annotate (add notes/markers for site visits) — annotations made there appear in the embedded map automatically.

## 2. Current state (audited 2026-06-13)

- **Engine:** `runSolarEstimate` (`lib/solar/intake.ts`) — geocode → coverage → roof (`SolarRoofFacts`) → sizing → pricing → economics; persisted whole into `solar_estimates.estimate` jsonb. Manual fallback path produces the same shape with empty `planes`/`panels` and null sun fields.
- **Roof geometry available per estimate:** `estimate.roof.panels[]` (centre lat/lng, orientation, `segment_index`, `yearly_energy_dc_kwh`), `panel_size_m` (h/w metres), `planes[]` (pitch/azimuth/area/orientation/sunshine quantiles), `max_sunshine_hours_per_year`. `polygon_geojson` is **always null** today.
- **Raster pipeline already exists:** `fetchSolarDataLayersWithUrls` (`lib/solar/data-layers.ts`) returns the signed, short-lived GeoTIFF URLs **in-memory**; `applySolarSunAssets` (`lib/solar/sun-assets.ts`) downloads + decodes annual flux / monthly flux / DSM / RGB (`lib/solar/geotiff.ts`, ≤ size-capped), renders a flux heatmap PNG (`flux-render.ts`) into the `intake-photos` bucket, served by `/api/solar/q/[token]/flux-heatmap`. **The raw GeoTIFF bytes are in memory at exactly one moment — inside `applySolarSunAssets` — and are then discarded.** The Felt upload must hook that moment.
- **PDF:** Gotenberg via `ensureSolarQuotePdf` (`lib/quote/pdf.ts`) rendering `lib/solar/report-html.ts`.
- **Dashboard:** `SolarTab` (`app/dashboard/_components/SolarTab.tsx`) is a single view (share link, Pylon hardware card, estimate cards with confirm/re-draft). No sub-tabs. The inline tab-strip pattern to copy lives in `app/dashboard/painting/page.tsx` (`TabButton`).
- **Customer entry:** `/solar/[tenantSlug]` → `SolarAddressForm` → `POST /api/solar/[tenantSlug]/estimate`.
- **Customer quote:** `/q/solar/[token]` server component; confirm gate (`confirmed_at`) hides dollar figures pre-release; Stripe deposit + SMS on confirm.
- **Latest migration: 110.** This spec's migration is **111**.
- **Env:** `FELT_API_KEY` already present in `.env.local`. `GEMINI_API_KEY` + `ANTHROPIC_API_KEY` wired (Vercel AI SDK v6, direct Anthropic).

### Felt platform facts (from developers.felt.com, verified 2026-06-13)

- **REST API v2** `https://felt.com/api/v2`, `Authorization: Bearer felt_pat_…` (workspace-scoped personal access token = our `FELT_API_KEY`).
- **Create map** `POST /api/v2/maps` — `title`, `lat`/`lon`/`zoom`, `basemap` (`"satellite"` | `"default"` | `"light"` | `"dark"` | custom `{x}/{y}/{z}` tile URL | hex), `public_access` (`private`|`view_only`|`view_and_comment`|`view_comment_and_edit`), optional `layer_urls`. Response includes `id`, `url`, `thumbnail_url` (static preview image — used on dashboard cards and as PDF fallback).
- **Upload layers** `POST /api/v2/maps/{map_id}/upload` — either `{import_url}` or two-step S3 presigned file upload (≤ 5 GB; GeoJSON, **GeoTIFF**, CSV, KML, Shapefile…). Processing is **async**: poll `GET /maps/{id}/layers/{layer_id}` for `status` (`uploading`/`processing`/`failed`/`completed`) + `progress`.
- **Style layers** `POST /maps/{id}/layers/{layer_id}/update_style` with **Felt Style Language (FSL)** JSON:
  - `type: "numeric"` — stepped/continuous colour ramps; **works on raster bands** (`config: {band: 1, steps: [min,max]}` + colour array) → this is the flux heat map.
  - `type: "hillshade"` — elevation rasters (`color`, light-angle `source`, `intensity`) → the DSM layer.
  - `type: "categorical"` — colour by attribute → plane sun-score labels, panel orientation.
  - `type: "heatmap"` — point-density (colour/size/intensity) → optional stylized energy-density view.
  - Plus `label`, `legend` (custom display names), `popup`, `attributes`, `filters`, zoom-based styling blocks.
- **Elements (annotations) API** — programmatic markers/notes/polygons (property pin, "best plane" note).
- **Embed:** public/unlisted maps embed as `https://felt.com/embed/map/{map_id}` with **no token**. Private maps need `POST /maps/{id}/embed_token?user_email=…` (15-min TTL) **and the email must belong to a Felt workspace member** — unusable for anonymous customers. → v1 uses **unlisted `view_only` maps** (same risk class as our token-gated `/q/solar/[token]` URLs).
- **JS SDK** (`@feltmaps/js-sdk`, `Felt.embed(...)`: viewport control, layer show/hide, click→feature events, raster value under cursor, custom in-map panels) is an **Enterprise-plan feature**. v1 must not depend on it — plain iframe embed + REST styling only. SDK interactivity is the recorded v2 upgrade (§6).
- **Phase 0 must verify with the real key:** workspace plan, that `view_only` maps embed tokenless, GeoTIFF upload limits, and effective rate limits.

## 3. Felt feature → section map

| Felt capability | What it powers on the Felt tab |
| --- | --- |
| `POST /maps` (satellite basemap, lat/lon/zoom 20) | The per-estimate interactive map, centred on `estimate.context.location` |
| Upload: panel-rectangles **GeoJSON** | "Proposed panel layout" layer — rectangles computed from `panels[].center` + `panel_size_m`, rotated to the plane azimuth |
| FSL `numeric` (continuous) on panel attribute `yearly_kwh` | Panels colour-ramped by output; popup block shows per-panel kWh |
| Upload: `annualFlux` **GeoTIFF** + FSL `numeric` raster ramp | **Sun / solar-exposure heat map** with legend ("Low sun → High sun", kWh/m²/yr) |
| Upload: `dsm` GeoTIFF + FSL `hillshade` | Roof/terrain relief layer |
| Upload: plane-centroid GeoJSON + FSL `categorical` | Roof plane markers coloured by sun-score label, labelled with pitch/azimuth/area |
| Elements API (marker) | Property pin with the formatted address |
| Map `thumbnail_url` | Dashboard card preview + **PDF map snapshot** |
| `https://felt.com/embed/map/{id}` iframe | The map section on `/q/solar/[token]` (Felt variant) and the dashboard detail view |
| Layer status polling (`status`/`progress`) | Provisioning state machine (§4.5) |
| Map `url` | Tradie-facing "Open in Felt" link (annotate/markup in Felt's editor; edits show up in the embed) |
| `DELETE /maps/{id}` | Cleanup when an estimate is re-drafted (fresh map per draft) or deleted |
| Monthly flux GeoTIFF (12-band) | **Deferred to v2** — month slider needs SDK or layer-group gymnastics |

## 4. Design

### 4.1 Data model — migration 111 (`sql/migrations/111_solar_felt_maps.sql` + `scripts/run-migration-111.mjs`)

The Felt path produces **ordinary `solar_estimates` rows** (same engine, same lifecycle, same confirm gate) — so no new proposal table. Migration 111 adds to `solar_estimates`:

- `quote_variant text not null default 'instant'` — `'instant' | 'felt'`. Drives which customer-page layout renders and which dashboard sub-tab lists the row.
- `felt jsonb` — the provisioning record: `{ map_id, map_url, embed_url, thumbnail_url, status: 'pending'|'provisioning'|'ready'|'partial'|'failed', layers: { panels: {id, status}, flux: {id, status}, dsm: {id, status}, planes: {id, status} }, error, provisioned_at }`.
- `ai_brief jsonb` — the Anthropic roof-intelligence output + model/version + validation hash (§4.6).

`init.sql` updated to stay representative. RLS posture unchanged (service-role writes, migration 040 pattern).

### 4.2 Felt client — `lib/felt/client.ts` (new)

Same house contract as `lib/pylon/client.ts`: server-only, `FELT_API_KEY` Bearer, result objects (never throws), 15 s timeout for uploads / 5 s for control calls, size caps. Functions:

- `createFeltMap({title, lat, lon, zoom, basemap, publicAccess})` → `{ok, map: {id, url, thumbnail_url}}`
- `uploadFeltGeoJson(mapId, name, featureCollection)` — two-step presigned upload of an in-memory GeoJSON buffer → `{ok, layerId}`
- `uploadFeltGeoTiff(mapId, name, bytes)` — same, for raster buffers (≤ 30 MB cap)
- `updateFeltLayerStyle(mapId, layerId, fsl)`
- `getFeltLayer(mapId, layerId)` → status/progress (provisioning poll)
- `createFeltElement(mapId, geojsonFeature)` — property pin
- `deleteFeltMap(mapId)`
- `feltTabEnabled(env)` — pure gate: `FELT_TAB_ENABLED === 'true' | '1'` **and** key present

### 4.3 Pure builders — `lib/solar/felt-map.ts` (new)

All pure, colocated-tested, no I/O:

- `buildPanelLayoutGeoJson(roof)` — panel rectangles from `panels[].center`, `panel_size_m`, plane azimuth (`planes[segment_index].azimuth_degrees`), orientation swap for LANDSCAPE/PORTRAIT; properties: `panel_index`, `segment_index`, `orientation`, `yearly_kwh`. Metre→degree offsets via the standard small-area equirectangular approximation (fine at roof scale).
- `buildPlaneMarkersGeoJson(roof, sunScores)` — centroid of each plane's panels; properties: `pitch`, `azimuth`, `area_m2`, `orientation`, `sun_score_label`, `median_sunshine_hrs`, `relative_pct`.
- FSL builders: `panelFsl()` (numeric continuous on `yearly_kwh`, popup with kWh, legend), `fluxFsl(minFlux, maxFlux)` (raster numeric ramp, band 1, legend "Low sun → High sun"), `dsmFsl()` (hillshade), `planeFsl()` (categorical on `sun_score_label` with the four-colour scale).
- `feltMapTitle(estimate)` — `"Solar — {suburb} {postcode} — {kW} kW"`. **No customer name in the title** (unlisted-URL privacy).

### 4.4 Customer entry — same form, variant-aware

- Share link gains a variant: `/solar/[tenantSlug]?path=felt`. `SolarAddressForm` forwards `path` to the estimate POST. **Zero divergence in the form UX** — that is the point ("same process as the instant estimate").
- `POST /api/solar/[tenantSlug]/estimate` accepts `path: 'felt'`, runs the **identical** engine, stamps `quote_variant='felt'`, and registers the Felt provisioning step in the same `after()` block that runs `applySolarSunAssets` today.

### 4.5 Provisioning pipeline — hook the raster moment

Inside `after()`, in/alongside `applySolarSunAssets` (which already holds the decoded annual-flux + DSM rasters **and** the raw bytes before decode):

1. `createFeltMap` (satellite basemap, `view_only` unlisted, zoom 20 at the geocode) → persist `felt.map_id`, `status:'provisioning'`.
2. Upload in parallel: panels GeoJSON, plane markers GeoJSON, annual-flux GeoTIFF (raw bytes — capture them in `sun-assets` before decode), DSM GeoTIFF. Property-pin element.
3. Apply FSL per layer once its processing completes (poll `getFeltLayer`, ≤ 10 polls × 5 s budget inside the same `after()`; layers still processing → leave `layers.{x}.status='processing'`).
4. Persist final `felt` jsonb: `ready` (all styled), `partial` (map + some layers), or `failed` (map create failed). **Any failure is absorbed — the estimate itself is already persisted and valid.**
5. **Re-draft** (`/api/solar/redraft/[token]`): delete the old Felt map, provision a fresh one (panel layout/sizing may have changed).
6. A lazy repair pass on tab/page open: if `felt.status='partial'` and unstyled layers have completed processing since, apply their FSL then (server-side, in the page's data fetch — cheap status poll, not a re-upload).

**Manual-fallback estimates** (no planes/panels/rasters): map is created with just the property pin + satellite view; sections degrade per §4.9.

### 4.6 AI enhancements — grounded, never money-touching

**Anthropic — "Roof intelligence brief"** (`lib/solar/ai-brief.ts`, new):

- Input: a frozen facts JSON — `planes[]` (pitch/azimuth/area/orientation/sunshine quantiles), sun scores (`deriveSolarSunScores`), `panels` count + config kW, `max_sunshine_hours_per_year`, imagery date/quality, state/postcode. **No prices, no tariffs, no rebate figures in the prompt.**
- Output: Zod-validated structured object — `{headline, layout_rationale, best_plane_note, seasonal_note, caveats[]}` (each a bounded-length string) via the Vercel AI SDK structured-output path (Sonnet-class model; this is prose, not estimation).
- **Grounding validator (hard gate, same philosophy as `lib/estimate/validate.ts`):** every numeric token in the output must literally appear in the input facts (after unit normalisation), else the brief is discarded and the section falls back to the deterministic sun-score copy. The brief is stored in `ai_brief` jsonb with the model id + input hash; regenerated on re-draft.
- Rendered on the customer page and PDF under an explicit "AI-generated summary — figures from your roof analysis" label.

**Gemini** — the existing `panels-after` concept image (`/api/solar/q/[token]/panels-after`) is reused verbatim on the Felt variant, with its existing "illustrative" labelling. No new Gemini surface in v1.

### 4.7 Customer quote — `/q/solar/[token]`, Felt variant

`quote_variant==='felt'` renders the Felt layout (instant layout untouched, byte-identical for existing rows):

1. **Hero** — address, headline kW/panels, tenant branding (existing components).
2. **Interactive roof map** — `<iframe src={felt.embed_url}>` (lazy-loaded client component, fixed-height, with a static `thumbnail_url` placeholder until load). Felt's native legend provides the Panels / Sun exposure / Elevation toggles. Fallbacks per §4.9.
3. **Sun exposure** — sun-score cards per plane (`sun-score.ts`, finally surfaced) + `max_sunshine_hours_per_year` + imagery date; flux PNG (`/flux-heatmap`) shown when the Felt flux layer is unavailable.
4. **AI roof intelligence brief** — §4.6, labelled.
5. **System details + production** — existing premium-quote sections (charts from `lib/solar/charts.ts`).
6. **AI "panels installed" image** — existing Gemini section (post-confirm, unchanged).
7. **Pricing tiers + STC + deposit CTA** — *identical components and gating as the instant path*. Dollar sections render only after `confirmed_at`. No Felt/AI element sits in this block.
8. **PDF** — `report-html.ts` gains a Felt-variant branch: map `thumbnail_url` snapshot + cached flux PNG + the AI brief text replace the iframe (Gotenberg can't print an embed). Same `ensureSolarQuotePdf` plumbing.

### 4.8 Dashboard UX — sub-tabs inside `SolarTab`

`SolarTab` gains the two-tab header (Maintain design system, `TabButton` pattern from `app/dashboard/painting/page.tsx`):

- **Instant estimate** — existing content, byte-identical.
- **Felt** — (a) setup state when `FELT_TAB_ENABLED` off or key missing; (b) the share link with `?path=felt` + copy button; (c) estimate cards filtered to `quote_variant='felt'`, reusing `STATUS_META`, confirm/re-draft wiring, **plus** a map status chip (`Map ready` / `Map building…` / `Map unavailable`), the `thumbnail_url` preview, and an "Open in Felt" link (the tradie-facing editor URL — annotate there, the embed updates).

Deep-link `?tab=solar&sub=felt` via the existing `DEEP_LINK_TABS` mechanism extended with a `sub` param. `GET /api/tenant/solar` grows a `variant` filter + the `felt` status fields on the view model (`lib/solar/dashboard-view.ts`).

### 4.9 Error handling & degradation matrix

| Condition | Behaviour |
| --- | --- |
| `FELT_TAB_ENABLED` off / key missing | Sub-tab shows setup notice; `?path=felt` falls back to the instant variant; instant path untouched |
| Felt map create fails | Estimate still valid; `felt.status='failed'`; customer page renders the **instant** layout sections (static map + flux PNG); dashboard chip "Map unavailable" |
| GeoTIFF upload/processing fails (vector layers ok) | `partial`; map shows satellite + panels; sun-exposure section uses the cached flux PNG |
| Layers still processing at first page view | Iframe shows the map as-is; lazy repair pass styles late layers (§4.5.6) |
| Manual-fallback estimate (no roof geometry) | Map = satellite + pin only; panel/flux/plane sections replaced by the manual-path copy; AI brief skipped (no facts to ground) |
| Anthropic brief fails validation / API error | Section falls back to deterministic sun-score copy; never blocks |
| Gemini image unavailable | Identical degradation to instant path |
| Felt API down at re-draft | Old map deleted best-effort; provisioning marked `failed`; re-draft itself unaffected |
| Stripe/Gotenberg/SMS unavailable | Identical degradation to the instant path |

### 4.10 Security & privacy

- `FELT_API_KEY` is server-only — never `NEXT_PUBLIC_`, never sent to the browser; all Felt calls go through `lib/felt/client.ts`.
- Maps are **unlisted `view_only`** — anyone with the URL can view, same exposure class as `/q/solar/[token]`. Mitigations: no customer name in map title (§4.3), address only as the pin label, maps deleted on estimate deletion/re-draft, optional `FELT_PROJECT_ID` to corral them in one Felt project.
- Embed iframe gets `sandbox`/`referrerpolicy` hardening and `loading="lazy"`.

### 4.11 Testing

- Unit (vitest, colocated): geometry builders (rectangle rotation vs fixture azimuths, equirectangular offsets), FSL builders (snapshot), client functions (mocked fetch: presigned two-step, timeout, size cap, never-throws), provisioning state machine (each failure → correct `felt.status`), AI-brief grounding validator (injected fabricated number → discard), variant routing (`?path=felt` → `quote_variant`), dashboard view-model mapping.
- Existing suites stay green — `sun-assets`, `data-layers`, `sun-score`, solar page/report suites prove the instant path is untouched.
- E2E smoke: estimate via `?path=felt` with fixture rasters → row has `felt.map_id` → `/q/solar/[token]` renders iframe section → PDF route 200 with thumbnail; degraded run (Felt client stubbed to fail) renders the instant-layout fallback.

## 5. Build order (each phase shippable behind `FELT_TAB_ENABLED`)

0. **Phase 0 — verify with the real key (cheap, do first):** workspace plan (SDK availability noted for v2), `view_only` embed works tokenless in an iframe, GeoTIFF upload + raster FSL styling round-trip on a throwaway map, rate limits. Findings folded back into this spec (pattern: the Pylon spec's Phase-0 note).
1. **Foundation** — migration 111, `lib/felt/client.ts`, `lib/solar/felt-map.ts` builders + tests.
2. **Pipeline** — variant-aware entry/estimate route, provisioning step hooked into `after()`/`sun-assets`, re-draft map refresh, lazy repair pass.
3. **Surfaces** — dashboard sub-tabs + cards, `/q/solar/[token]` Felt variant sections, PDF branch.
4. **AI + polish** — Anthropic brief + grounding validator, sun-score cards, degraded-mode passes, E2E smoke.

## 6. Out of scope (recorded for the next iteration)

JS SDK interactivity (click-a-panel popovers driven by our UI, raster value under cursor, custom in-map panels, viewport choreography — Enterprise plan; v2 once the plan is confirmed), monthly-flux month slider (12-band raster + layer-group `slider` interaction), hourly-shade animation, private maps + embed tokens for the tradie dashboard, Felt Comments/webhooks, per-tenant Felt workspaces (single platform workspace for the pilot), building-footprint polygon layer (blocked on `polygon_geojson` being null — revisit with the mask raster or Geoscape), pushing QuoteMate edits back into Felt beyond provisioning.
