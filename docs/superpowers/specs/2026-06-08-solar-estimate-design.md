# Solar Panel Installation Estimate — v1 Design Spec

> Status: design, awaiting user review (2026-06-08).
> Companion research: [2026-06-08-solar-estimate-feasibility-research.md](2026-06-08-solar-estimate-feasibility-research.md)
> Approach confirmed: **mirror the roofing/painting deterministic trade pattern**.

## 1. Goal & scope

Add an **instant, self-serve solar estimate** to QuoteMate: a customer enters their address and immediately sees an honest, roof-specific estimate (system size, annual production, net price after the STC rebate, and a banded payback), with a real satellite photo of their roof and a stats overlay. The estimate is **indicative until the tradie confirms it**; the deposit button is gated behind that confirmation.

**Decisions locked during brainstorming (2026-06-08):**

| Decision | Choice |
|---|---|
| v1 job | Instant estimate, tradie-finalised (no auto-send) |
| Who/pricing ownership | Electricians upselling solar; QuoteMate ships a tweakable default AU rate card; "final install by an accredited installer" framing |
| Visual | Real Google satellite roof photo + stats overlay (no generative/invented panels) |
| Economics depth | Core numbers **+ banded payback** (range, assumptions shown) |
| Coverage fallback | Manual-roof fallback estimate (2–3 questions); never lose the lead |
| Architecture | A — new self-contained `lib/solar/` deterministic pipeline + dedicated `/q/solar/[token]` page + `solar` trade row, hand-wired like roofing/painting |
| Entry / send model | Per-tenant self-serve `/solar/[tenantSlug]`; customer sees estimate instantly but framed "indicative — installer confirms"; deposit gated behind tradie confirmation |

**Why not the alternatives:** bolting solar onto the existing `/q/[token]` + Opus estimator breaks (the grounding validator can't express per-kW pricing, an STC *rebate subtraction*, or payback — every solar quote would silently collapse to the $99 inspection; the trade union is hardcoded). Partnering/embedding OpenSolar adds an external, soon-paid dependency and dilutes brand/UX — revisit if solar becomes a major line.

## 2. End-to-end flow

```
/solar/[tenantSlug]  → customer enters address
        ▼ geocode (Google Maps) → lat/lng
Coverage gate: offline GeoJSON pre-check → live buildingInsights:findClosest (MEDIUM floor)
   covered ─────────────┐                       uncovered / 404 ───────────┐
   roof analysis (geometry, panel configs,      manual-roof fallback:
   DC energy, satellite image)                  ask direction + rough size/storeys
        └──────────────┬───────────────────────────────────────────────────┘
                       ▼ lib/solar engine (pure code)
   2–3 system-size tiers: kW, panels, yearly kWh, gross $, STC rebate, net $, annual savings, banded payback
                       ▼ create intake (trade='solar') + solar_estimates row + quote row → token
                       ▼ /q/solar/[token] — instant, framed "indicative", real roof photo + stats overlay
                       ▼ tradie notified (SMS/WhatsApp) → reviews/adjusts → confirms
                       ▼ confirmed; per-tier Stripe deposit unlocks (reuse /r/[token]/[tier])
```

Covered and uncovered addresses feed the **same** pricing/economics engine; only the roof-data source differs (Google vs customer-declared). The engine stays one testable unit.

## 3. Modules — `lib/solar/`

Pure functions on the money path (no LLM pricing), mirroring `lib/roofing/*` and `lib/painting/*`.

| Module | One job | Depends on |
|---|---|---|
| `coverage.ts` | Usable lat/lng? Offline GeoJSON pre-check → live `findClosest` (MEDIUM floor). Returns covered + imageryQuality + imageryDate, or uncovered. | Solar API client |
| `roof.ts` | Normalise `buildingInsights` → roof facts (usable area, segments, `maxArrayPanelsCount`, `panelCapacityWatts`, per-config `yearlyEnergyDcKwh`). | Solar API client |
| `sizing.ts` | Pick 2–3 honest system-size tiers from real `solarPanelConfigs`, capped by roof capacity AND DNSP export limit (default 5 kW/phase). | `roof.ts` |
| `production.ts` | DC→AC derate **0.80–0.82**, scale by `panelCapacityWatts/400`, 0.5%/yr degradation, cross-check vs CEC city benchmark, attach ±band. | `sizing.ts` |
| `pricing.ts` | Gross $ from rate card (per-kW) − `floor(kW × zone × deeming) × STC_price` = net $. | config |
| `economics.ts` | Annual savings (self-consumption × retail + export × feed-in); banded payback range. | `production.ts`, config |
| `intake.ts` | Address-first intake + manual-roof fallback branch (both produce normalised roof facts). | `coverage.ts`, `roof.ts` |
| `manual-fallback.ts` | Estimate roof capacity from declared direction + size/storeys when uncovered. | — |

**Reused as-is:** Google Solar API client (`lib/roofing/solar-api.ts` — already calls `buildingInsights:findClosest`, currently only reads pitch), Stripe deposit redirect `/r/[token]/[tier]`, GST display, tradie-notify, Maintain design system.
**Net-new surfaces:** `/solar/[tenantSlug]` entry page, the `lib/solar/` engine, `/q/solar/[token]` page.

## 4. Data model

- **`solar` trade row** in the trades registry (new migration, hand-wired like roofing migration 080 — NOT the v9 CSV loader).
- **`solar_estimates`** table (mirrors `roofing_measurements`): token-keyed; roof facts; `imagery_quality` / `imagery_date` / `coverage_source` (`google` | `manual`); chosen tiers + economics (jsonb); satellite image URL; `confidence_band`; `solar_config` version used.
- Standard **`intakes`** (trade='solar') + a **quote** row for pipeline consistency (dashboard, notify, deposit).
- Tenant rate-card override via **`pricing_book.overlays`**; ship a default solar rate card.

## 5. Config & freshness

A dated **`solar_config`** (DB table or versioned config), no magic numbers in code:
- STC `deeming_year` schedule (2026=5, 2027=4, 2028=3, 2029=2, 2030=1, then 0 — SRES ends).
- CER **postcode → STC zone** table (NSW spans zones 2–4, QLD 1–3 — do not state-default).
- Conservative **STC price** (e.g. ~$38, date-stamped; open market ~$38–39.50 vs $40 clearing-house cap).
- **Feed-in** by network: NSW IPART benchmark; QLD split Energex (deregulated) vs Ergon (QCA-mandated).
- Default **rate card** ($/kW installed) + DNSP export-limit defaults + derate factor + self-consumption %.

Every published estimate **date-stamps** the config version it used. QuoteMate admin owns refresh cadence (deeming flips Jan 1; STC price + FiT reviewed ~yearly). Stale config (deeming year past, STC price unset) blocks publish and alerts admin.

## 6. Customer page — `/q/solar/[token]`

Mirrors `/q/roof/[token]`, Maintain design system.
- **Hero:** real satellite roof photo + stats overlay (size, panels, orientation, yearly kWh), captioned *"Indicative layout based on Google aerial imagery, [imageryDate]."*
- **Tier cards (2–3):** kW · panels · yearly production · gross price · **STC rebate (subtraction line)** · **net price** · est. annual savings · **payback range**.
- **Assumptions panel (always visible):** self-consumption %, retail + feed-in rates, derate, STC params used.
- **Confidence band:** ±20% (covered/HIGH) → ±30% + "indicative only" chip for MEDIUM/manual/stale imagery.
- **Compliance copy (mandatory):** "Final system designed & installed by a Solar Accreditation Australia (SAA)-accredited installer using Clean Energy Council–approved components. STC rebate subject to eligibility & install date. Estimate, not a contract."
- **CTA:** deposit gated until tradie confirms; pre-confirmation shows "Your installer will confirm this estimate."

**Tradie side:** reuse dashboard + SMS/WhatsApp notify; tradie adjusts tier prices/sizes and confirms. **Forced review, no auto-send** (inherits roofing's high-ticket rule).

## 7. Guardrails & error handling

- Coverage 404 / imageryQuality < MEDIUM → manual fallback (never hard-fail).
- **Deterministic output check** (solar's analogue of the grounding validator): each tier net = gross − STC, values within sane bounds (gross ~$700–$1,800/kW, payback 2–12 yrs, AC/kW within ±35% of CEC benchmark); out-of-bounds → flag for tradie, never publish silently.
- Solar API failure / quota → graceful "estimate shortly" + manual path; daily GCP quota caps to cap cost.
- Stale config → block publish, alert admin.

## 8. Testing

- Unit tests on `pricing.ts` / `production.ts` / `economics.ts` with fixed fixtures (known address → known kWh/STC/net).
- Fixture set of real `buildingInsights` payloads (covered + uncovered).
- Parity/sanity script (à la `test-sms-parity.mjs`): STC math vs worked CER examples; payback within band.
- One Playwright e2e: address → estimate → page render → fallback path.

## 9. Cost

- **buildingInsights-only: ~$0.01/quote** (~$0 under the 10k/mo free cap). This is the v1 default.
- No Data Layers / GeoTIFF spend in v1 (deferred with the raster visual).

## 10. Out of scope for v1 (deferred to v2+)

Generative/photorealistic panel renders; raster GeoTIFF compositing; batteries + battery rebates (federal Cheaper Home Batteries, NSW PDRS VPP); full 10/20-yr financial model & financing; the v9 admin-CSV onboarding path; Stripe Connect fund-splitting (test-mode deposit only, consistent with the rest of the app).

## 11. Open items to confirm during planning

- Exact default rate-card $/kW and the 2–3 default tier sizes (e.g. 6.6 / 10 / 13.2 kW) — tradie-overridable.
- Whether `solar_config` is a DB table vs a versioned file (leaning DB table for admin edit).
- Per-DNSP/per-postcode export-limit table fidelity for v1 (start with a 5 kW/phase default + a small override list).
- Confirm an AU-specific Google Solar API pricing list before volume budgeting.
