# Solar Pylon Tab — design spec

**Date:** 2026-06-12
**Status:** Implemented 2026-06-12 (all 4 phases; behind `PYLON_PROPOSALS_ENABLED`, default off). Phase-0 findings folded in: `fields[solar_designs]` is mandatory on list+show; customer/site data lives on `solar_projects`; the design payload exposes NO production/financial data ("only basic information") so all charts are QuoteMate-modelled from `summary.dc_output_kw`; component endpoints expose identity + datasheet URL only; amounts are integer cents, line items ex-tax. Migration 108 applied to prod + dev Supabase.
**Sibling spec:** `2026-06-12-solar-premium-quote-design.md` (the Google-path premium quote, shipped behind `SOLAR_PREMIUM_QUOTE`). This spec adds a second, fully-Pylon path beside it. Neither path touches the other.

---

## 1. Goal

Add a **Pylon tab** to the Solar Estimate area: a second quoting path that uses **zero Google Solar/Maps API calls** — every roof image, panel layout, string diagram, component, line item and price comes from the **Pylon API** reading a design the tradie made in Pylon studio. The customer-facing output (`/q/pylon/[token]` page + Gotenberg PDF) reproduces the Pylon web proposal **section-for-section** (reference sample: `app.getpylon.com/proposals/vZUS2zqYuM`, "13.2kW Solar system", Solar Safari Pty Ltd), then layers on the QuoteMate features Pylon's own proposal lacks: the confirm human-in-loop gate, Stripe deposit checkout, customer SMS/MMS delivery, PDF parity, and the dashboard pipeline.

### The decisive architectural fact (from the 2026-06-12 Pylon API audit)

**Solar designs and proposals cannot be created via the Pylon API.** Designs are authored by a human in Pylon's studio; the API only reads them back. Therefore:

- The Pylon tab is a **design-import** flow, not an instant address-only estimator. The Google-path tab keeps the instant-estimate use case; the Pylon tab serves "I designed this job properly in Pylon — now deliver it through QuoteMate".
- "Exactly the same as the Pylon proposal" is achieved by **rendering the same sections from the same design data**, in QuoteMate's own page/PDF (Maintain design system), not by iframing Pylon's hosted proposal. The hosted `web_proposal_url`/`pdf_proposal_url` are kept as tradie-facing reference links.

### Reference proposal anatomy (extracted from the live Pylon sample, reused verbatim from the sibling spec)

Cover → Proposed panel layout (aerial + panel rectangles + trust badges) → Panel strings & component markings → System details (daily-production-per-month chart, component cards) → Utility costs (before solar / with solar) → Included services & warranty → 20-year financial summary (NPV, discounted payback, total ROI, IRR) → Financial analysis (annual bill over time, monthly bill comparison) → Environmental analysis → Quote table + payment → Assumed values (DC array power, tilt, azimuth) → Assumptions & disclaimer → T&Cs → Warranty + manufacturers tables → System summary.

## 2. Current state (audited 2026-06-12)

- `lib/pylon/client.ts` exists (server-only, `PYLON_API_KEY` Bearer, 5 s timeout, never-throws result objects) with two endpoints wired: `GET /v1/au/stc_amount` (STC cross-check guardrail, `lib/solar/stc-crosscheck.ts` + `pylon-aftercheck.ts`) and `POST /v1/opportunities_form` (lead push). Gates: `PYLON_ENABLED` env + `PYLON_LEAD_PUSH_TENANTS` allowlist.
- The dashboard `SolarTab` (`app/dashboard/_components/SolarTab.tsx`) is a single view: share link + estimate cards + confirm/re-draft. No sub-tabs yet.
- Customer pages: `/q/solar/[token]` (Google path) with `report-html.ts` PDF. Confirm gate (`confirmed_at`) hides all dollar figures pre-release; flagged estimates can't confirm.
- Storage: solar imagery cached in the `intake-photos` bucket, served through token-gated API routes (pattern: `panels-after.ts`).
- Latest migration: 107. This spec's migration is **108**.

## 3. Pylon endpoint → feature map (full-Pylon edition)

| Endpoint | Feature it powers in the Pylon tab |
| --- | --- |
| `GET /v1/solar_designs` | Design picker — the tab lists the tenant's Pylon designs (name, address, kW, updated-at) to import. |
| `GET /v1/solar_designs/{id}` | The whole proposal. `summary.latest_snapshot_url` → aerial-with-panels hero + "Proposed panel layout" section. `summary.single_line_diagram_pdf_url` → "Panel strings & component markings" section (rendered as embedded image/page). `summary.pv_site_information_url` → AS/NZS 5033 site-information link in the compliance section. `line_items[]` (AU GST/STC tax semantics) → quote table, STC deduction lines, deposit math. `pricing` → totals. System summary fields → System Details + Assumed Values. `web_proposal_url` / `pdf_proposal_url` → tradie-facing reference links on the dashboard card. |
| `GET /v1/solar_modules/{sku}` · `/v1/solar_inverters/{sku}` · `/v1/solar_batteries/{sku}` | Component datasheet cards (brand, model, datasheet specs, warranty years) in the System Details and Warranty/Manufacturers sections — keyed by the SKUs present in the design's line items/components. |
| `GET /v1/au/stc_amount` | Validation guardrail: recompute the STC quantity for the design's kW/postcode/year and compare against the design's STC line item. Mismatch ⇒ review flag (existing pattern), never a silent price change. |
| `POST /v1/opportunities_form` | Already wired — unchanged (lead push on confirm, tenant-flagged). |
| Files / events / pipelines | **Deferred.** Not needed for the proposal render. |

**Phase 0 of the build prompt must re-verify** the exact field names and the production/consumption/financial fields the design payload actually exposes (e.g. annual yield, consumption profile, tariff assumptions). Anything Pylon exposes is used verbatim; anything it does not expose is computed by QuoteMate's existing pure modules (see §4.4) from the design's facts — and labelled as QuoteMate-modelled.

## 4. Design

### 4.1 Data model — migration 108 (`sql/migrations/108_pylon_proposals.sql` + `scripts/run-migration-108.mjs`)

New table `pylon_proposals` (deliberately separate from `solar_estimates` — different lifecycle, no engine run):

- `id uuid pk`, `tenant_id uuid → tenants` (app-layer scoped like everything else), `token text unique` (customer URL), `pylon_design_id text`, `design jsonb` (the full imported design snapshot — line items, pricing, summary, component SKUs, datasheet payloads), `assets jsonb` (storage paths for cached snapshot image / SLD PDF / site-info PDF), `status text` (`imported` → `awaiting_confirmation` → `confirmed` → `paid`), `flags jsonb` (e.g. `stc_mismatch_pylon`), `confirmed_at timestamptz`, `pdf_path text`, `stripe_checkout_session_id/url`, `customer` jsonb (name/phone/email captured at import or pushed later), `created_at/updated_at`.
- RLS enabled (service-role bypass, consistent with migration 040 posture); `init.sql` updated to stay representative.

**Asset caching at import time:** Pylon's `*_url` fields are treated as signed/expiring. On import, the server downloads the snapshot image, single-line-diagram PDF and PV-site-information PDF and re-uploads them to the `intake-photos` bucket under `pylon/{proposal_id}/…`; the customer page/PDF only ever serves the cached copies through token-gated routes (pattern: `panels-after.ts`). Import fails soft per-asset: a missing asset omits its section, never blocks the import.

### 4.2 Pylon client extension (`lib/pylon/client.ts`)

Same contract as the existing functions (server-only, result objects, never throws, 5 s timeout — list/design fetches may use 15 s):

- `listPylonSolarDesigns(opts)` → `GET /v1/solar_designs` (paginated; map to a slim list row).
- `fetchPylonSolarDesign(id, opts)` → `GET /v1/solar_designs/{id}` (full payload, tolerant JSON:API unwrapping like `fetchPylonStcAmount`).
- `fetchPylonComponent(kind, sku, opts)` → the three component-datasheet endpoints behind one function.
- `downloadPylonAsset(url, opts)` → authenticated binary fetch for snapshot/SLD/site-info, size-capped (≤ 20 MB).

### 4.3 API routes (Bearer tenant auth, same shape as `/api/tenant/solar`)

- `GET /api/tenant/pylon/designs` — proxy of the design list (never exposes the key to the browser).
- `POST /api/tenant/pylon/import` — body `{ design_id }`: fetch design → fetch component datasheets for its SKUs → cache assets to storage → run the STC validation (§4.5) → insert `pylon_proposals` row (`awaiting_confirmation`, flags if any) → return the view model.
- `GET /api/tenant/pylon` — list the tenant's imported proposals (dashboard cards).
- `POST /api/pylon/confirm/[token]` — the confirm gate: only clean (unflagged) proposals confirm; sets `confirmed_at`, creates the Stripe deposit Checkout session from the design's deposit amount, regenerates the PDF, sends the customer SMS (+ best-effort MMS), fires the lead push when enabled. Mirrors `/api/solar/confirm/[token]` mechanics, including `after()` for heavy work.
- `POST /api/tenant/pylon/reimport/[token]` — re-pull the design from Pylon (the fix loop for flagged proposals: tradie edits in Pylon studio, re-imports, flags re-evaluate).
- `GET /api/pylon/q/[token]/asset/[kind]` — token-gated serving of cached snapshot/SLD/site-info.
- `GET /api/q/pylon/[token]/pdf` — Gotenberg PDF (pattern: solar quote PDF).

### 4.4 Customer quote — `/q/pylon/[token]` page + PDF (same order, mirroring the Pylon sample exactly)

1. **Cover / hero** — Pylon snapshot image (the real designed layout), tenant branding, system headline (kW, panel count), trust badges (CEC accreditation, licence footer — existing compliance components).
2. **Proposed panel layout** — the snapshot image full-width with caption (design date, "Designed in Pylon studio by {tenant}"). No Google imagery, no Gemini.
3. **Panel strings & component markings** — the single-line diagram (PDF page rendered to image at import time, or embedded object in the PDF). This is the engineer-authored SLD — strictly better than the Google path's indicative strings.
4. **System details** — component cards from the SKU datasheets (module/inverter/battery: brand, model, key specs, warranty) + the design's system summary; daily-production-per-month chart **only if** the design payload exposes production figures (Phase 0 verifies; otherwise reuse `lib/solar/charts.ts` monthly-production builder scaled to the design's annual yield, labelled "modelled").
5. **Utility costs — before / with solar** — Pylon's figures when exposed; else QuoteMate's `utility-costs.ts` fed by the design's annual yield + the optional customer bill field, labelled accordingly.
6. **Included services & warranty** — from line items flagged as services + static tenant copy.
7. **20-year financial summary** — NPV / discounted payback / total ROI / IRR stat cards. Pylon's values when exposed; else `lib/solar/financial-summary.ts` on the design's price + yield (same escalation/discount config constants, config-versioned).
8. **Financial analysis** — annual-bill-over-time + monthly-bill-comparison charts (same sourcing rule).
9. **Environmental analysis** — CO₂e/yr + 20-year totals + equivalents, from the design's yield × the config's cited carbon factor.
10. **Quote table + payment** — the design's `line_items[]` verbatim: descriptions, quantities, unit prices, GST treatment, STC deduction lines, total, deposit; Stripe deposit CTA (post-confirm only).
11. **Assumed values** — DC kW, panel count, tilt/azimuth per the design, "STC count verified against Pylon ✓/✗", config version.
12. **Assumptions & disclaimers → T&Cs → Warranty + manufacturers tables → System summary** — extended `compliance-copy.ts`; AU framing (CEC, STC, "indicative" where QuoteMate modelled a number).

**Gating identical to the solar page:** sections containing dollar figures (5, 7, 8, 10) render only after `confirmed_at`; geometry/production/environment sections may render pre-confirm. `lib/pylon/proposal-html.ts` mirrors the page for the PDF with the same section order.

### 4.5 Money-path integrity (how this satisfies the grounding rule)

The repo rule is "money-touching steps never come from free-form generation". On this tab, **every price is the tradie's own human-authored number from their Pylon design** — imported verbatim, displayed verbatim. No LLM touches the money path at all (there is no estimation step). Two guardrails on top:

- **STC validation:** `GET /v1/au/stc_amount` for the design's kW/postcode/year vs. the design's STC line item; `|Δ| > 1` certificate ⇒ flag `stc_mismatch_pylon`, which blocks confirm until re-import resolves it.
- **Totals re-add:** server recomputes `Σ line_items` vs. `pricing.total`; divergence ⇒ flag `pricing_mismatch_pylon` (defends against partial/odd payloads).

Gemini is **not used anywhere** on this tab — the snapshot is the real design. (If a photorealistic hero is ever wanted here, it inherits the "illustrative" labelling rule, but it is out of scope.)

### 4.6 Dashboard UX — sub-tabs inside `SolarTab`

`SolarTab` gains an internal two-tab header (Maintain design system, all-caps mono):

- **Instant estimate** — the existing content, byte-identical.
- **Pylon** — (a) connection state (key present? `PYLON_PROPOSALS_ENABLED`? clear empty-states when off); (b) "Import from Pylon" — design list with search + Import button; (c) imported-proposal cards: status badge (same `STATUS_META` vocabulary), kW, total, customer/address, View → `/q/pylon/[token]`, links to Pylon's own web/PDF proposal, **Confirm & release** for clean proposals, **Re-import** for flagged ones with the flag reason spelled out.

Deep-link `?tab=solar&sub=pylon` supported (existing `DEEP_LINK_TABS` mechanism extended with a sub param).

### 4.7 Flags & config

- `PYLON_PROPOSALS_ENABLED` env gate (default **off**) — gates the sub-tab, all `/api/tenant/pylon/*` routes and `/q/pylon/*`. Independent from `SOLAR_PREMIUM_QUOTE`.
- Reuses `PYLON_ENABLED` + `PYLON_API_KEY` for client-level enablement; `PYLON_LEAD_PUSH_TENANTS` unchanged.
- **The key once pasted in chat must be rotated before this ships** (carried over from the sibling spec — still owed).

### 4.8 Error handling & degradation matrix

| Condition | Behaviour |
| --- | --- |
| `PYLON_PROPOSALS_ENABLED` off / key missing | Sub-tab renders a setup notice; routes 404; Google path untouched |
| Pylon API down during browse/import | Tab shows retryable error; nothing persisted |
| Snapshot / SLD / site-info asset fetch fails | Import succeeds; that section omitted from page + PDF; dashboard card notes the gap |
| Component datasheet 404 for a SKU | Card falls back to the line-item name/qty only |
| Design payload missing production/financial fields | QuoteMate pure modules compute them from design facts, sections labelled "modelled by QuoteMate" |
| STC or totals mismatch | Proposal flagged; confirm blocked; re-import is the fix loop |
| Stripe/Gotenberg/SMS unavailable | Identical degradation to the solar path (no CTA / no PDF link / log) |
| Design deleted in Pylon after import | Cached snapshot stays renderable; re-import surfaces the error |

### 4.9 Testing

- Unit (vitest, colocated): client list/design/component/asset functions (mocked fetch, JSON:API unwrap, timeout, size cap); import mapper (design payload → `pylon_proposals.design` + view model); STC + totals validation flag logic; line-item table builder (GST/STC rendering, AU currency); section gating (pre/post-confirm); `proposal-html.ts` snapshot tests; sub-tab gating logic.
- Existing suites stay green — especially `stc-crosscheck`, `pylon client`, solar page/report suites (untouched paths must prove it).
- E2E smoke: import-from-fixture → dashboard card → confirm → `/q/pylon/[token]` renders all sections → PDF route 200; degraded fixture (no assets, no financial fields) renders the reduced page.

## 5. Build order (each phase shippable behind `PYLON_PROPOSALS_ENABLED`)

1. **Foundation** — migration 108, client extension (list/design/component/asset), import route + asset caching, view models.
2. **Dashboard** — SolarTab sub-tabs, design picker, proposal cards, confirm/re-import wiring.
3. **Customer output** — `/q/pylon/[token]` page sections 1–12 with gating, `proposal-html.ts` + PDF route, SMS/MMS on confirm.
4. **Guardrails & polish** — STC + totals validation, lead-push hookup, deep-link, degraded-mode passes, E2E smoke.

## 6. Out of scope (recorded for the next iteration)

Two-way sync (pushing QuoteMate edits back into Pylon designs), Pylon e-signature, financing products, Pylon files/events/pipelines, auto-import via webhooks (poll/manual import only for v1), per-tenant Pylon keys (single platform key for the pilot; revisit before multi-tenant GA), embedding Pylon's hosted proposal in an iframe (rejected — breaks branding, gating and the deposit flow).
