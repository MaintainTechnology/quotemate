# Solar OpenSolar Tab — design spec

**Date:** 2026-06-12
**Status:** REMOVED 2026-06-13 — the OpenSolar tab (sub-tab UI, `/q/opensolar/*` pages, tenant/customer routes, import/proposal libs) was implemented 2026-06-13 and deleted the same day by owner decision; the instant-estimate OpenSolar enrichment (hardware catalogue cards, pricing-scheme cross-check, confirm-time lead push — `lib/opensolar/client.ts` + `lib/solar/opensolar-supplement.ts` + `lib/solar/opensolar-leadpush.ts`) remains. Recoverable from commit `57fddc0`. Full OpenSolar developer-docs review (all 52 API pages) folded in 2026-06-12: document generation, system-image endpoint, usage push, workflow/stage sync, component activations, private files + CER file tags, machine-user auth, throttle limits.
**Sibling specs:** `2026-06-12-solar-premium-quote-design.md` (Google-path premium quote, `SOLAR_PREMIUM_QUOTE`) and `2026-06-12-solar-pylon-tab-design.md` (Pylon design-import path, `PYLON_PROPOSALS_ENABLED`). This spec adds a **third** quoting path beside them. None of the three paths touches the others.

---

## 1. Goal

Add an **OpenSolar tab** to the Solar Estimate area: a third quoting path powered by the **OpenSolar API** (`api.opensolar.com`) **combined with the Google Maps APIs** QuoteMate already uses (geocoding, address validation, Static Maps basemap). The customer-facing output (`/q/opensolar/[token]` page + Gotenberg PDF) reproduces the Pylon reference proposal **section-for-section** (sample: `app.getpylon.com/proposals/vZUS2zqYuM`, "13.2kW Solar system", Solar Safari Pty Ltd) — the same 12-section anatomy already shipped on the Pylon tab — then layers on the QuoteMate features neither hosted proposal has: the confirm human-in-loop gate, Stripe deposit checkout, customer SMS/MMS delivery, PDF parity, and the dashboard pipeline.

### Why a separate tab (and how it differs from the Pylon tab)

The decisive architectural facts from the 2026-06-12 OpenSolar API review:

1. **Projects CAN be created via the OpenSolar API** (`POST /api/orgs/:org_id/projects/`) — unlike Pylon, where designs/proposals are read-only. The OpenSolar tab is therefore a **two-way flow**: QuoteMate can *push* a lead (address + customer + usage) into OpenSolar to start a project, and *pull* the finished design back. Design authoring itself still happens in OpenSolar studio (or their SDK); the API does not auto-generate panel layouts.
2. **The full design is machine-readable JSON**, not just snapshot URLs. With the **Raw Data API Access** plan, `projects/:id` exposes a `design` field (gzip + base64 JSON) containing module groups (azimuth, slope, layout), MPPT/string config, components with quantities, full pricing/line items/adders/incentives (incl. STC quantity + zone), bills current/proposed, and output (annual/monthly/**hourly**). This means QuoteMate can render the panel layout and the strings diagram **deterministically over a Google Static Maps basemap** — engineering-grade SVG from real geometry, not a cached screenshot. This is strictly richer than the Pylon tab (which can only embed Pylon's pre-rendered snapshot/SLD).
3. **Proposal data endpoint** `GET /api/user_logins/` (Raw Data plan only) returns everything OpenSolar's own proposal shows: itemised pricing, panel placement/orientation, monthly + hourly production, payback/NPV/IRR/ROI/LCOE, before/after bills, tariff data, component specs, `system_image_urls` (satellite-with-panels renders), and a `share_link_qrcode`. Anything it exposes is used verbatim; anything missing is computed by QuoteMate's existing pure modules — labelled "modelled by QuoteMate".
4. **OpenSolar generates engineering documents on demand** (`POST /api/orgs/:org_id/projects/:project_id/generate_document/{type}/`): proposal PDF, **shade report**, **energy yield report**, **PV site plan**, system image, system-performance image, owner's manual, bill-calculations report, global BOM, financials report, and an 8760-hour performance CSV. These become cached, token-gated **quote appendices** (customer) and **install-pack documents** (tradie) that neither the Google path nor the Pylon tab can produce.
5. **The customer's real usage can be pushed in** (`PATCH project` with `usage: { usage_data_source, values }` — supports `bill_quarterly`, `kwh_monthly`, etc.), so QuoteMate's optional quarterly-bill field personalises the OpenSolar design's before/after bills at the source instead of post-hoc modelling.
6. **Pipeline round-trip:** project workflow stage is writable (`workflow.active_stage_id`, milestones Presale → Lock Pricing → Sold → Installed) and the events system records customer engagement ("Customer Viewed Online Proposal" = 2, "Accepted" = 3, "Made a Payment" = 4). QuoteMate confirm/deposit can advance the tradie's OpenSolar pipeline automatically.
7. **Plan gating (effective 2026-03-17):** *API Access* (core; System Details works but excludes `custom_data`; Projects omit the `design` field) vs *Raw Data API Access* (full design + `user_logins` proposal data). **Phase 0 must verify which plan the pilot org has** and the exact field names in the live payloads; the architecture degrades gracefully to API-Access-only mode (see §4.8).
8. **Auth is a bearer token from a login flow, not a static key.** Tokens are obtained via email/password (`POST` login) or `GET /api/fetch_token/`; OpenSolar recommends a dedicated **machine user** for integrations. The client must handle token acquisition/refresh server-side; credentials live only in env.
9. **Webhooks exist** (`/api/orgs/:org_id/webhooks/`) with project/contact/event/quote payloads — auto-refresh and "customer viewed proposal" notifications are possible but deferred to keep v1 poll/manual like the Pylon tab.
10. **Rate limits are real** (documented per-endpoint throttles; system image and document generation are heavy). All OpenSolar calls go through the client's single retry/backoff path; generated assets are cached aggressively (once per design change).

### Reference proposal anatomy (identical to the Pylon tab — the target to mimic exactly)

Cover → Proposed panel layout (aerial + panel rectangles + trust badges) → Panel strings & component markings → System details (daily-production-per-month chart, component cards) → Utility costs (before solar / with solar) → Included services & warranty → 20-year financial summary (NPV, discounted payback, total ROI, IRR) → Financial analysis (annual bill over time, monthly bill comparison) → Environmental analysis → Quote table + payment → Assumed values (DC array power, tilt, azimuth) → Assumptions & disclaimer → T&Cs → Warranty + manufacturers tables → System summary.

## 2. Current state (audited 2026-06-12)

- No OpenSolar code exists anywhere in the repo. Fresh integration.
- `SolarTab` (`app/dashboard/_components/SolarTab.tsx`) already has the internal sub-tab header + `?tab=solar&sub=…` deep-link mechanism (built for the Pylon tab; `PylonPanel` in `PylonTab.tsx`). This spec adds a third sub-tab.
- The Pylon tab shipped the reusable patterns this tab copies: separate proposal table + import flow + asset caching to `intake-photos` + token-gated asset routes + confirm gate + Gotenberg PDF + SMS/MMS on confirm (`lib/pylon/*`, `app/api/tenant/pylon/*`, `/q/pylon/[token]`, migration 108).
- Google path modules to reuse verbatim: `lib/solar/charts.ts`, `financial-summary.ts`, `utility-costs.ts` (modelled fallbacks), `compliance-copy.ts`, `static-map-center.ts` + Mercator projection helpers from `layout-overlay.ts`/`string-overlay.ts` (the premium-quote SVG builders), STC deterministic math + cross-check pattern.
- Latest migration: 109 (pylon_settings). This spec's migration is **110** (drafted as 109; renumbered after a same-day collision).

## 3. OpenSolar endpoint → feature map (full docs reviewed 2026-06-12, all 52 API pages)

Base `https://api.opensolar.com/api/`, Bearer token (machine-user login → token; see §4.7), org-scoped. All calls server-side only. Documented per-endpoint throttle limits apply — heavy endpoints (system image, document generation, `user_logins`) are cached once per design change.

### Adopted — customer-facing (the quote itself)

| Endpoint | Feature it powers in the OpenSolar tab |
| --- | --- |
| `GET /api/orgs/:org_id/projects/?fieldset=list` | Project picker — the tab lists the org's OpenSolar projects (address, stage, system count, updated-at) to import. |
| `GET /api/orgs/:org_id/projects/:id/` | Project facts (address, lat/lon, contacts, usage, tariff guess, workflow stage) + on Raw Data plan the compressed `design` field → decompress (gzip+base64 → JSON) → module groups geometry, MPPT/strings, pricing, incentives, bills, hourly/monthly output. |
| `GET /api/orgs/:org_id/systems/?fieldset=list&project=:id` | System cards + system picker: `kw_stc`, `module_quantity`, `output_annual_kwh`, `consumption_offset_percentage`, `price_including_tax`/`price_excluding_tax`, `co2_tons_lifetime`, component lists. |
| `GET /api/orgs/:org_id/projects/:project_id/systems/details/` | Hardware (modules/inverters/batteries/others with manufacturer + code + qty), adders, incentives (STC line), `module_groups[]` (module_quantity, azimuth, slope, layout) — available on **both** plans (minus `custom_data`). |
| `GET /api/orgs/:org_id/projects/:project_id/systems/:uuid/image/?width&height` | **Authoritative layout render** — generated by OpenSolar from the live design, re-generates after design changes (follow redirects). Cached at import as the "Proposed panel layout" image; the deterministic SVG overlay is layered on top / used as fallback. |
| `GET /api/user_logins/?project_ids=:id` (proposal data; Raw Data plan) | The whole proposal payload: `systems[].data` (pricing, line_items, payment_options, bills, `output.monthly`, `output.hourly` 8760), `shadingByPanelGroup`, financial metrics (`systemPaybackYear`, `systemNetPresentValue`, `systemIrr`, `systemReturnOnInvestment`, LCOE), `system_image_urls`, panel placement/orientation tables, `tax_name` (GST), org branding (`logo_public_url`, `color_highlight`), proposal message/testimonials, `calculation_error_messages` (surfaced as import warnings). |
| `POST …/generate_document/{type}/` — `shade_report`, `energy_yield_report`, `pv_site_plan` | **Quote appendices (customer):** generated at import with `action=save`, cached to storage, served token-gated, linked from the quote page + merged into/linked beside the Gotenberg PDF. The shade report grounds the shading claims; the yield report grounds production; the site plan is the engineering artefact. |

### Adopted — tradie-facing (dashboard / pipeline / install)

| Endpoint | Feature |
| --- | --- |
| `POST /api/orgs/:org_id/projects/` + `POST /api/orgs/:org_id/contacts/` | **Lead push (the two-way feature Pylon can't do):** create an OpenSolar project + contact from a QuoteMate solar intake/estimate, so the tradie opens studio with the site and customer pre-loaded. |
| `PATCH /api/orgs/:org_id/projects/:id/` with `usage: { usage_data_source, values }` | **Usage push:** QuoteMate's optional quarterly-bill field (and any captured kWh data) is written into the project (`bill_quarterly`, `kwh_annual`, …) so OpenSolar's own bills/offset/financials are computed from the customer's real consumption — personalisation at the source, not post-hoc. |
| `PATCH /api/orgs/:org_id/projects/:id/` with `workflow.active_stage_id` | **Pipeline sync:** on QuoteMate confirm → advance toward *Sold*; on deposit paid → mark sold (exact stage ids read from `GET /workflows/`). Allowlist-gated like lead push. |
| `POST …/generate_document/{type}/` — `global_bom`, `owners_manual`, `financials_report`, `system_performance_8760` (CSV) | **Install pack:** BOM for ordering, owner's manual for handover, financials/8760 CSV for the tradie's records — generated on demand from the dashboard card, stored as private files in OpenSolar and mirrored to QuoteMate storage. |
| `GET /api/orgs/:org_id/private_files/?project=…` + file tags | Project documents on the dashboard card — incl. AU CER retailer-compliance tagged docs (CER-RET-014/015/016), mounting-plane photos, horizon shading data, interval data. Read-only list + download in v1. |
| `GET /api/orgs/:org_id/component_{module,inverter,battery,other}_activations/` | Org hardware catalogue — enriches component cards (datasheet/spec fields) beyond the per-design quantities in systems/details. |
| `GET /api/orgs/:org_id/payment_options/` | Names/terms of the org's payment options, so the quote's payment section can label the design's chosen option (cash/finance) accurately. |
| `GET /api/orgs/:org_id/workflows/` + `GET /roles/` | Stage-id lookup for pipeline sync; assigned-installer/salesperson display on the dashboard card. |

### Deferred (recorded, not in v1)

| Capability | Why deferred |
| --- | --- |
| Webhooks (project/contact/event/quote payloads) | v1 is poll/manual re-import like the Pylon tab; the event webhook ("Customer Viewed/Accepted Online Proposal", payments) is the natural v2 for engagement notifications. |
| Events read/write (event types 0–139: proposal viewed/accepted, payments, calls, SMS, stage changes) | QuoteMate already has its own funnel events; mirroring SMS/payment events into OpenSolar is v2 polish. |
| `generate_document/proposal` (OpenSolar's own proposal PDF) | QuoteMate renders its own branded quote (Maintain design system, confirm gate, Stripe). OpenSolar's PDF would bypass gating/branding — kept as a tradie-facing reference download only if requested later. |
| Pricing schemes / costing CRUD | Tradie configures pricing in OpenSolar; QuoteMate only reads results. |
| Teams / connected orgs / sharing, seller-program endpoints, Docusign/finance events | Multi-org and finance flows out of pilot scope. |
| SDK (embedded AI design studio) | Separate product decision; the API tab ships first. |

**Phase 0 of the build prompt must verify** against the live org: (a) plan level (API Access vs Raw Data), (b) machine-user token acquisition + lifetime/refresh behaviour, (c) the decompressed `design` schema for an AU project (exact module-group geometry coordinates, MPPT/string fields, STC incentive shape), (d) whether `user_logins` is reachable and its per-system `data` keys, (e) the system-image endpoint redirect behaviour + private-file side effect, (f) which `generate_document` types the org's plan/templates actually support (AU orgs may lack e.g. `structural_report_mcs`), (g) workflow stage ids. The degradation matrix (§4.8) covers every "not available" answer.

## 4. Design

### 4.1 Data model — migration 110 (`sql/migrations/110_opensolar_proposals.sql` + `scripts/run-migration-110.mjs`)

New table `opensolar_proposals` (mirror of `pylon_proposals`, separate lifecycle):

- `id uuid pk`, `tenant_id uuid → tenants`, `token text unique`, `opensolar_project_id text`, `opensolar_system_uuid text` (the chosen system when a project has several), `design jsonb` (decompressed design + system details + proposal-data slice — everything needed to render without re-calling OpenSolar), `assets jsonb` (storage paths for cached system image, overlay SVGs, and generated documents: shade report / energy yield report / PV site plan / BOM / owner's manual), `status text` (`imported` → `awaiting_confirmation` → `confirmed` → `paid`), `flags jsonb` (e.g. `stc_mismatch_opensolar`, `pricing_mismatch_opensolar`, `design_decode_failed`, `calc_errors_opensolar` from `calculation_error_messages`), `confirmed_at timestamptz`, `pdf_path text`, `stripe_checkout_session_id/url`, `customer jsonb`, `pushed_from_estimate_id uuid null → solar_estimates` (set when the project originated as a QuoteMate lead push), `created_at/updated_at`.
- RLS enabled (service-role bypass, migration 040 posture); `init.sql` updated.

**Asset caching at import time:** the system-image endpoint render, the customer-facing generated documents (`shade_report`, `energy_yield_report`, `pv_site_plan`) and any `system_image_urls` are downloaded and re-uploaded to `intake-photos` under `opensolar/{proposal_id}/…`, served only through token-gated routes (pattern: Pylon tab). Deterministic overlay SVGs are generated at import (from `module_groups` + Google Static Maps basemap) and cached alongside. Tradie-facing documents (BOM, owner's manual, financials, 8760 CSV) are generated lazily on first dashboard request, then cached. Per-asset soft-fail: a missing asset omits its section/button, never blocks import. Re-import refreshes all cached assets (the design changed).

### 4.2 OpenSolar client (`lib/opensolar/client.ts`)

Same contract as `lib/pylon/client.ts` (server-only, result objects, never throws, 5 s timeout; list/project/proposal fetches 15 s; document generation 30 s):

- **Auth:** `getOpenSolarToken()` — machine-user bearer token via the documented login/`fetch_token` flow, cached in-memory with expiry-aware refresh (single-flight). Credentials from env only.
- `listOpenSolarProjects(opts)` → paginated project list, mapped to slim rows.
- `fetchOpenSolarProject(id, opts)` → full project; `decompressOpenSolarDesign(design)` is a separate **pure** function (base64 → gunzip → JSON, size-capped ≤ 20 MB, tolerant of absent field on API-Access plan).
- `fetchOpenSolarSystemDetails(projectId, opts)` → systems/details payload.
- `fetchOpenSolarProposalData(projectId, opts)` → `user_logins` payload (returns `{ ok: false, reason: 'plan' }` cleanly on 402/403 so the plan gate is data, not an exception).
- `fetchOpenSolarSystemImage(projectId, systemUuid, { width, height }, opts)` → follows redirects until image bytes; size-capped.
- `generateOpenSolarDocument(projectId, type, params, opts)` → `generate_document/{type}/` with `action=save`, polls/fetches the resulting private file; whitelisted types only (`shade_report`, `energy_yield_report`, `pv_site_plan`, `global_bom`, `owners_manual`, `financials_report`, `system_performance_8760`).
- `createOpenSolarProject(input, opts)` + `createOpenSolarContact(input, opts)` → lead push (address, lat/lon from our geocode, contact).
- `updateOpenSolarProjectUsage(projectId, usage, opts)` → `PATCH` with `{ usage: { usage_data_source, values } }` (e.g. `bill_quarterly`).
- `updateOpenSolarProjectStage(projectId, stageId, opts)` → `PATCH` `workflow.active_stage_id` (pipeline sync).
- `listOpenSolarPrivateFiles(projectId, opts)` / `downloadOpenSolarAsset(url, opts)` → authenticated binary fetch, size-capped.
- All functions share one throttle-aware wrapper (respect documented limits; 429 → single backoff retry, then clean failure).

Env: `OPENSOLAR_ENABLED`, `OPENSOLAR_ORG_ID`, machine-user credentials (`OPENSOLAR_API_TOKEN` if a long-lived token is provisioned, else `OPENSOLAR_USERNAME`/`OPENSOLAR_PASSWORD` — Phase 0 decides which per the org's setup), `OPENSOLAR_PROPOSALS_ENABLED` (feature gate, default **off**), `OPENSOLAR_LEAD_PUSH_TENANTS` (allowlist, mirrors Pylon; also gates usage push + stage sync). **Never hardcode credentials; any credential shared in chat must be rotated.**

### 4.3 API routes (Bearer tenant auth, same shape as `/api/tenant/pylon/*`)

- `GET /api/tenant/opensolar/designs` — project list proxy (credentials never reach the browser).
- `POST /api/tenant/opensolar/import` — body `{ project_id, system_uuid? }`: fetch project + system details (+ proposal data when plan allows) → decompress design → fetch system image + generate customer documents (shade/yield/site-plan, soft-fail) → generate + cache overlay SVGs → run validations (§4.5) → insert `opensolar_proposals` row (`awaiting_confirmation`, flags if any) → return view model. Heavy asset work runs in `after()` where the response doesn't need it.
- `POST /api/tenant/opensolar/push` — lead push: create an OpenSolar contact + project from a solar intake/estimate, **including the customer's usage** (`bill_quarterly` from the optional bill field) when captured; stores `pushed_from_estimate_id` for round-trip linking; gated by `OPENSOLAR_LEAD_PUSH_TENANTS`.
- `POST /api/tenant/opensolar/document/[token]` — body `{ type }` (whitelisted tradie types: BOM, owner's manual, financials, 8760 CSV): lazy generate-and-cache, returns the storage link (dashboard "Install pack" buttons).
- `GET /api/tenant/opensolar` — list imported proposals (dashboard cards).
- `POST /api/opensolar/confirm/[token]` — confirm gate: clean proposals only; sets `confirmed_at`, creates the Stripe deposit Checkout session from the design's deposit/payment option, regenerates the PDF, sends customer SMS (+ best-effort MMS), and (allowlist-gated, best-effort in `after()`) advances the OpenSolar project workflow stage. Deposit-paid webhook handling likewise advances toward *Sold*. Mirrors `/api/pylon/confirm/[token]`.
- `POST /api/tenant/opensolar/reimport/[token]` — re-pull from OpenSolar (fix loop for flagged proposals: tradie edits in OpenSolar studio, re-imports, flags re-evaluate).
- `GET /api/opensolar/q/[token]/asset/[kind]` — token-gated cached assets (system image, layout SVG, strings SVG).
- `GET /api/q/opensolar/[token]/pdf` — Gotenberg PDF.

### 4.4 Customer quote — `/q/opensolar/[token]` page + PDF (same 12-section order, mirroring the Pylon sample exactly)

1. **Cover / hero** — cached system-image-endpoint render (the authoritative designed layout, regenerated by OpenSolar per design change) or, when absent, Google Static Maps satellite + deterministic layout overlay; tenant branding, system headline (kW STC, panel count), trust badges (CEC accreditation, licence footer — existing compliance components).
2. **Proposed panel layout** — the cached system-image render full-width, plus the **deterministic SVG**: panel rectangles from the decompressed design's module-group geometry (azimuth/slope/layout/quantity) projected over the Google Static Maps basemap (reusing the premium-quote Mercator/`layout-overlay.ts` machinery), colour-keyed per module group. Caption: "Designed in OpenSolar studio by {tenant}" + imagery date. Either image alone carries the section when the other is unavailable.
3. **Panel strings & component markings** — strings diagram generated from the design's MPPT/string config (real stringing when `auto_string`/MPPT data is present in the design JSON; else the indicative chunking algorithm from `string-overlay.ts`, captioned "Indicative — final stringing confirmed by your installer at site"). Inverter/meter markers as on the premium quote.
4. **System details** — component cards from systems/details (module/inverter/battery: manufacturer, code, qty), enriched with spec/datasheet fields from the org's component activations; daily-production-per-month chart from the design's **real** `output.monthly`, shading context from `shadingByPanelGroup` (the 8760 hourly series is captured for a future hour-by-hour view); only when output data is absent do we fall back to `lib/solar/charts.ts` modelled curve, labelled "modelled".
5. **Utility costs — before / with solar** — the design's `bills` current/proposed verbatim when exposed (computed from the customer's **real pushed usage** when the bill field was captured); else `utility-costs.ts` fed by annual output + optional customer bill, labelled accordingly.
6. **Included services & warranty** — adders/line items flagged as services + static tenant copy.
7. **20-year financial summary** — NPV / discounted payback / total ROI / IRR stat cards from the proposal-data financial metrics when exposed (Raw Data plan); else `lib/solar/financial-summary.ts` on price + yield, config-versioned, labelled "modelled".
8. **Financial analysis** — annual-bill-over-time + monthly-bill-comparison charts (same sourcing rule; monthly uses real `output_monthly` × tariff when available).
9. **Environmental analysis** — `co2_tons_lifetime` from the system payload verbatim; annual CO₂e + equivalents from yield × the config's cited carbon factor.
10. **Quote table + payment** — the design's line items/adders/incentives verbatim: descriptions, quantities, unit prices, GST treatment, **STC incentive line**, total (ex/inc GST per `tax_name`), deposit; the selected payment option labelled with its real name/terms from `payment_options`; Stripe deposit CTA (post-confirm only).
11. **Assumed values** — DC kW (`kw_stc`), panel count, per-group tilt/azimuth, consumption-offset %, "STC count verified ✓/✗", config version.
12. **Assumptions & disclaimers → T&Cs → Warranty + manufacturers tables → System summary** — extended `compliance-copy.ts`; AU framing (CEC, STC, "indicative" wherever QuoteMate modelled a number).
13. **Engineering appendices** (post-confirm, when cached) — download links to the OpenSolar-generated **shade report**, **energy yield report** and **PV site plan**, served token-gated from QuoteMate storage; the PDF lists them as companion documents. These are OpenSolar engineering outputs and are labelled as such.

**Gating identical to the Pylon/solar pages:** dollar-figure sections (5, 7, 8, 10) render only after `confirmed_at`; geometry/production/environment sections may render pre-confirm. `lib/opensolar/proposal-html.ts` mirrors the page for the PDF in the same order.

### 4.5 Money-path integrity

Every price is the tradie's own number from their OpenSolar design — imported verbatim, displayed verbatim; no LLM touches the money path. Guardrails on top (same pattern as the Pylon tab):

- **STC validation:** recompute the STC quantity deterministically (existing QuoteMate STC math; the Pylon `stc_amount` cross-checker may double as a second opinion when `PYLON_ENABLED`) for the design's kW/postcode/year vs. the design's STC incentive line; `|Δ| > 1` certificate ⇒ flag `stc_mismatch_opensolar`, blocking confirm until re-import resolves it.
- **Totals re-add:** server recomputes Σ(line items + adders − incentives) vs. `price_including_tax`; divergence ⇒ flag `pricing_mismatch_opensolar`.
- **Geometry sanity:** Σ `module_groups[].module_quantity` must equal `total_module_quantity`; mismatch renders the cached image instead of the SVG overlay (never a wrong drawing).

Gemini is **not used** on this tab — the layout is real design geometry. (If a photorealistic hero is ever added, it inherits the "illustrative" labelling rule; out of scope.)

### 4.6 Dashboard UX — third sub-tab inside `SolarTab`

The existing sub-tab header gains **OpenSolar** beside Instant estimate and Pylon:

- (a) connection state (credentials + org id present? `OPENSOLAR_PROPOSALS_ENABLED`? plan level detected? clear empty-states when off);
- (b) "Import from OpenSolar" — project list with search + Import button (system picker when a project has multiple systems);
- (c) "Push to OpenSolar" action on eligible solar estimates (lead push incl. captured usage), shown when the allowlist enables it;
- (d) imported-proposal cards: status badge (same `STATUS_META` vocabulary), kW, total, customer/address, View → `/q/opensolar/[token]`, link to the OpenSolar project, workflow-stage chip, **Confirm & release** for clean proposals, **Re-import** for flagged ones with the flag reason spelled out;
- (e) **Install pack** on the card: lazy-generated BOM / owner's manual / financials / 8760 CSV download buttons, plus the project's tagged private files (CER compliance docs, mounting-plane photos) listed read-only.

Deep-link `?tab=solar&sub=opensolar` via the existing mechanism.

### 4.7 Flags & config

- `OPENSOLAR_PROPOSALS_ENABLED` (default **off**) gates the sub-tab, all `/api/tenant/opensolar/*` routes and `/q/opensolar/*`. Independent from `SOLAR_PREMIUM_QUOTE` and `PYLON_PROPOSALS_ENABLED`.
- `OPENSOLAR_ENABLED` + `OPENSOLAR_ORG_ID` + machine-user credentials (§4.2) for client-level enablement; `OPENSOLAR_LEAD_PUSH_TENANTS` allowlist gates lead push, usage push and stage sync.
- Single platform org/machine-user for the pilot; per-tenant OpenSolar orgs revisit before multi-tenant GA (recorded in §6).

### 4.8 Error handling & degradation matrix

| Condition | Behaviour |
| --- | --- |
| `OPENSOLAR_PROPOSALS_ENABLED` off / credentials or org id missing | Sub-tab renders a setup notice; routes 404; other paths untouched |
| Token acquisition fails (bad machine-user credentials, expired session) | Connection state shows the auth error; single refresh retry then clean failure; nothing persisted |
| Org on **API Access** plan (no `design` field, no `user_logins`) | Import still works from systems/details: hardware cards, module-group tilt/azimuth, adders/incentives, kW, annual output, price. Layout uses the system-image endpoint render; strings section uses indicative algorithm; financial metrics + bills are QuoteMate-modelled and labelled. Dashboard card notes "limited plan" |
| OpenSolar API down during browse/import/push | Retryable error; nothing persisted |
| 429 throttled | One backoff retry inside the client; then clean failure (import retryable; lazy documents show "try again") |
| `design` decompression fails / malformed | Falls back to API-Access behaviour for that import; flag `design_decode_failed` on the card (informational, non-blocking) |
| `calculation_error_messages` present in proposal data | Import succeeds with flag `calc_errors_opensolar` shown on the card; affected modelled sections fall back to QuoteMate modules |
| System-image endpoint or `system_image_urls` fetch fails | Deterministic SVG overlay carries the layout section; if both absent the section is omitted |
| `generate_document` type unsupported / fails (e.g. template missing) | That appendix/install-pack item is omitted; everything else unaffected |
| Google Static Maps unavailable | Cached system image carries the layout; else section omitted (quote still renders) |
| Proposal data (`user_logins`) 402/403 | Plan-gated path, not an error: modelled financials, labelled |
| Usage push / stage sync fails | Best-effort: logged, never blocks confirm or deposit |
| STC / totals / geometry mismatch | Proposal flagged; confirm blocked (geometry: SVG suppressed only); re-import is the fix loop |
| Stripe/Gotenberg/SMS unavailable | Identical degradation to the solar/Pylon paths |
| Project deleted in OpenSolar after import | Cached snapshot/design/documents stay renderable; re-import surfaces the error |

### 4.9 Testing

- Unit (vitest, colocated): client functions (mocked fetch, token refresh single-flight, timeout, size cap, redirect-following for system image, 429 backoff, plan-gated 402/403 handling, document-type whitelist); `decompressOpenSolarDesign` (pure — golden fixture of a gzip+base64 AU design, malformed input, oversize); import mapper (project + systems/details + proposal-data → `opensolar_proposals.design` + view model, incl. `calculation_error_messages` → flag); usage-payload builder (quarterly bill → `bill_quarterly` values); STC/totals/geometry validation flags; module-group → SVG layout projection (fixture geometry → expected rectangles); strings builder (real MPPT config path + indicative fallback path); line-item/adder/incentive table builder (GST, STC line, AU currency); section gating pre/post-confirm (incl. appendices post-confirm only); `proposal-html.ts` snapshot tests; sub-tab + plan gating logic.
- Existing suites stay green — especially the Pylon tab suites, solar page/report suites, and `stc-crosscheck` (untouched paths must prove it).
- E2E smoke: import-from-fixture → dashboard card (install-pack buttons) → confirm → `/q/opensolar/[token]` renders all sections incl. appendices → PDF route 200; **API-Access-plan fixture** (no design/no proposal data) renders the reduced page; lead-push fixture round-trips `pushed_from_estimate_id` and writes usage.

## 5. Build order (each phase shippable behind `OPENSOLAR_PROPOSALS_ENABLED`)

0. **Phase 0 — verify, then stop for approval:** authenticate with the live org (machine-user token flow); record plan level; capture sanitised fixtures of project list, project detail (with/without `design`), decompressed design JSON, systems/details, `user_logins` (if reachable), the system-image endpoint, one `generate_document` run per adopted type, and workflow stage ids; confirm the §3 field map against reality; output the corrected endpoint→feature table + any spec amendments.
1. **Foundation** — migration 110, `lib/opensolar/client.ts` (auth + throttle wrapper + `decompress`), import route + asset caching (system image, customer documents) + overlay generation, view models.
2. **Dashboard** — third sub-tab, project picker + system picker, proposal cards + install-pack buttons + private-files list, confirm/re-import wiring, lead-push (+ usage push) action.
3. **Customer output** — `/q/opensolar/[token]` sections 1–13 with gating, `proposal-html.ts` + PDF route, SMS/MMS on confirm.
4. **Guardrails & polish** — STC/totals/geometry validation, `calc_errors` surfacing, workflow stage sync on confirm/deposit, plan-level degradation passes, deep-link, E2E smoke.

## 6. Out of scope (recorded for the next iteration)

Webhook-driven auto-refresh + customer-engagement notifications ("Customer Viewed/Accepted Online Proposal" event webhook — natural v2; poll/manual v1), mirroring QuoteMate SMS/payment events into OpenSolar's events log, OpenSolar's own `generate_document/proposal` PDF as a customer artefact (bypasses gating/branding; tradie-reference only if ever requested), OpenSolar SDK embedding (AI-powered in-app design studio), Docusign/e-signature/customer-acceptance sync, finance-application flows (Brighte etc.), pricing-scheme/costing CRUD, teams/connected-orgs/sharing + seller-program endpoints, hourly-output (8760) shading visualisation on the customer page (data captured, view deferred), per-tenant OpenSolar orgs/machine-users (single platform org for the pilot), two-way sync of QuoteMate edits back into OpenSolar designs, embedding OpenSolar's hosted proposal in an iframe (rejected — breaks branding, gating and the deposit flow).
