# Solar Estimate + Visualization for QuoteMate — Feasibility Brief

> Research output (2026-06-08). Produced by a multi-agent research workflow (24 agents, ~1M tokens):
> 3 codebase-integration scouts + 6 web-research agents → 14 critical claims adversarially fact-checked
> against Google Maps Platform docs, Clean Energy Regulator, and the QuoteMate codebase.
> This is **research input to a brainstorming/design conversation**, not an approved design.

## 1. Verdict
**Doable for AU (NSW/QLD metro), but build it as a NEW deterministic trade — not into the existing electrical/plumbing grounding validator — and promise production as a *modelled estimate at ±15–25%*, never a guarantee.** Coverage gates per-address (≈80% of NSW/QLD population works; Newcastle, Central Coast and inland regional NSW have zero coverage). All AU economics (STC rebate, feed-in, payback) are yours to compute — Google gives geometry and DC energy only.

## 2. APIs & data needed
- **Google Solar API — `buildingInsights:findClosest`** (SKU *Solar API Building Insights*, Essentials, ~$0.01/call, 10k/mo free). The workhorse: roof segments (pitch/azimuth/area), `maxArrayPanelsCount`, `solarPanelConfigs[]` (real installable layouts), and `yearlyEnergyDcKwh` per config. **Already integrated** in `lib/roofing/solar-api.ts` (only pitch is parsed today — the energy/layout fields are unused).
- **Google Solar API — `dataLayers:get` → `geoTiff:get`** (SKU *Solar API Data Layers*, Enterprise, ~$0.075/call, only 1k/mo free) — ONLY if you build a raster-composited visual. Returns RGB/mask/DSM/flux GeoTIFFs. Not currently used anywhere.
- **Geocoding**: already have `GOOGLE_MAPS_API_KEY`; address → lat/lng before any Solar call (address-first intake, like roofing).
- **What the API does NOT give you for AU (must build yourselves):**
  - **STC rebate math** — `floor(system_kW × postcode_zone_rating × deeming_years) × STC_price`. Zone is per-postcode (NSW spans 2–4, QLD spans 1–3 — ingest the CER postcode list, don't state-default). Deeming steps down by 1 every Jan 1 (2026=5 … 2030=1, then SRES ends) — **config-driven on install year, never hardcoded**. STC price floats (~$38–39.50 open market vs $40 ex-GST clearing-house cap) — quote conservative + date-stamp.
  - **AU feed-in tariffs** — NSW IPART benchmark (4.8–7.3 c/kWh 2025-26, falling) is non-binding; SE-QLD Energex is deregulated; regional-QLD Ergon QCA-mandated (8.66 c/kWh 2025-26). Split QLD by network.
  - **Compliance** — products on CEC approved lists + installer **SAA-accredited** (NOT "CEC accredited" — authority moved to Solar Accreditation Australia May 2024). One non-approved component voids the whole STC.
  - **DNSP export limits** — commonly 5 kW/phase fixed (10 kW/phase dynamic) — caps usable system size and export revenue.
  - **`financialAnalyses[]` is US-only** — USD, federal/state/SREC/net-metering fields, typically empty for AU buildings. Do not surface any of it.

## 3. Australian coverage reality
- **Works (≥ MEDIUM, 0.25 m/px):** Sydney, Parramatta, Penrith, Wollongong, Brisbane, Gold Coast, Sunshine Coast, Ipswich + most QLD regional cities (Toowoomba, Townsville, Cairns, Rockhampton, Mackay).
- **HIGH (0.1 m/px) is rare in AU:** confirmed only Brisbane CBD, Perth, Canberra. **Sydney CBD and Melbourne are MEDIUM.** Plan for MEDIUM as the floor.
- **Zero coverage in any tier (real gaps in core market):** **Newcastle** (AU's 7th-largest city), **Central Coast/Gosford**, and all inland regional NSW (Dubbo, Wagga, Tamworth). BASE/experimental does NOT rescue these (AU not in GA BASE region list).
- **Gating:** cheap offline pre-filter = point-in-polygon against Google's coverage GeoJSON (refresh periodically; Google warns it's an approximation). Authoritative gate = live `findClosest` with `requiredQuality=MEDIUM, exactQualityRequired=false`; a 404/NOT_FOUND = uncovered (free but counts toward rate limit).
- **Fallback when uncovered/low-quality:** drop to a manual/declared-roof path — collect roof size/orientation from the customer (or skip the visual), still produce a kW-sized estimate, and **force tradie review**. Never hard-fail the quote.

## 4. Accuracy
- **Honest band:** ±15–20% on annual AC kWh for HIGH-quality imagery on a pitched, well-oriented roof; widen to ±25–30% (label "indicative only") for MEDIUM/LOW imagery, flat/complex roofs, heavy shading, or imagery older than ~2–3 years. Dollar-savings bands are wider still.
- **Google over-estimates.** A public pvlib comparison found +77% on the largest config, driven by ~30% roof-area over-detection and a flush-to-roof tilt assumption (single US flat-roof case = upper bound, but the *direction* is consistent). **Lead with a conservative AU derate of 0.80–0.82, not Google's default 0.85.**
- **Derivation:** `initialAcKwhPerYear = yearlyEnergyDcKwh × dcToAcDerate`; scale by `panelCapacityWatts/400` (read `panelCapacityWatts` live — Google changed the default 250→400 W). Apply 0.5%/yr degradation over 20 yr. Cross-check derated AC/kW against the CEC city benchmark (Sydney ~1424, Brisbane ~1533 kWh/kW/yr) and flag outliers.
- **Why `financialAnalyses` is unusable for AU:** US-centric and unpopulated for non-US buildings. AU savings = AC kWh × self-consumption split (~30–50% no battery, valued at retail rate) + export × feed-in tariff − net install cost (STCs deducted).
- **Always surface `imageryDate` + `imageryQuality`** and downgrade the confidence band when stale/MEDIUM.

## 5. Visualization
- **Most defensible: deterministic raster compositing** — draw panel rectangles from real `solarPanelConfigs`/`roofSegmentSummaries` geometry onto the Solar API RGB ortho (or overlay the flux heatmap), labelled + source-attributed. Auditable, no hallucination. Cost: net-new engineering (GeoTIFF decode + projection + drawing — doesn't exist in the repo) and the pricier Data Layers SKU.
- **Generative Gemini render** is cheapest and a near-clone of the existing `lib/roofing/roof-after.ts` pipeline. **But it invents panel count/placement** — for a high-ticket ($10–30k+) sale this is an Australian Consumer Law / ACCC misleading-conduct exposure. If used, restrict to a clearly watermarked "artist's impression — indicative only."
- **Honest fallback: simple 2D diagram** (panel count on a schematic) where imagery is missing/low-quality.
- **Trust risk is the dominant concern**: the visual must never read as a promised layout or yield.

## 6. Cost per quote
- **buildingInsights-only: ~$0.01/quote** (and **$0.00** under the 10k/mo free cap). Default solar estimate.
- **+ raster Data Layers visual: ~$0.085/quote** (~8.5× more; free tier only 1k/mo). Gate behind explicit need; set daily quota caps in GCP.
- *UNCERTAIN:* whether an AU-specific Solar pricing list exists — confirm before budgeting.

## 7. Fit with QuoteMate grounding model
- **Solar breaks the existing tool-calling + validator pattern outright.** `validate.ts` only accepts units `hr/each/lm/m/metre/metres`, only ever adds catalogue-derived positive prices (no negative/STC line, no derived payback), and category-matches via electrical/plumbing keywords. A per-kW line, an STC *rebate subtraction*, and payback math are all inexpressible — any single failure silently dumps the whole quote to the $99 inspection.
- **Recommended seam — follow the roofing/painting precedent exactly:**
  1. Register `solar` as a **trade data row** (trades registry / `trade_pricing_defaults` — built and applied to prod, migrations 046–055).
  2. Build a **new self-contained `lib/solar/` deterministic pipeline** (own intake, own `pricing.ts` engine, own validator) that *bypasses* the Opus estimator — mirroring `lib/roofing/*` and `lib/painting/*`. Hand-wire it (legacy seed pattern), NOT through the v9 admin CSV loader. Reuse the existing Solar API client.
  3. **Dedicated `/q/solar/[token]` customer page** (mirror `/q/roof/[token]`) — system-size tiers with per-tier kWh/yr, gross price, STC deduction, net price, payback panel. The current `/q/[token]` Tier shape has no slots for any of this and hardcodes the trade union to electrical/plumbing/roofing.
- **Reusable as-is:** Stripe per-tier deposit redirect `/r/[token]/[tier]`, GST display, tradie-review/notify, Maintain design system. **Inherit roofing's forced-tradie-review / no-auto-send** (high ticket).

## 8. Top risks & open questions
- **Coverage gaps in core market** — Newcastle/Central Coast/inland-NSW = 0 coverage. Gate per-address; live 404 is ground truth.
- **Over-estimation + ACL exposure** — surfacing raw Google numbers or a hallucinated Gemini layout on a high-ticket sale is a misleading-conduct risk. Conservative derate + ±band + tradie review + "indicative" framing are mandatory.
- **Time-sensitive economics, easy to go stale** — deeming year (Jan 1), STC spot price (daily), feed-in benchmarks (IPART ~May / QCA ~June, trending down). Dated config with a refresh cadence; SRES rebate hits $0 after 2030.
- **Compliance correctness** — "SAA-accredited installer" (not CEC); one non-approved component voids the entire STC; STCs created within 12 months of install; DNSP export limits cap system size.
- **UNCERTAIN:** AU-specific Solar API pricing list; borderline-uncovered live behaviour; per-DNSP/per-postcode export limits + zone mappings; final QCA 2026-27 regional FiT; whether battery rebates (federal Cheaper Home Batteries, tiered from May 2026; NSW PDRS VPP) are in scope.
- **Open product questions:** fixed system-size tiers vs quality-tier (budget/mid/premium) framing? Where do the rate card + STC params live and who owns freshness? Build-vs-partner (OpenSolar is a free, AU-built, CEC/AS-NZS-aware incumbent — though its API is paid from April 2026)?

## 9. Recommended v1 scope (smallest honest, accurate slice)
A **read-only solar estimate behind a per-address coverage gate, no generative imagery, forced tradie review:**
1. Address-first intake → geocode → coverage gate (offline GeoJSON pre-filter + live `buildingInsights:findClosest` at MEDIUM floor). If uncovered → graceful manual-roof fallback or "not available at your address."
2. **buildingInsights-only** (~$0.01/quote): use real `solarPanelConfigs` to pick 2–3 honest system-size tiers; derate DC→AC at **0.80–0.82**; cross-check against CEC city benchmark.
3. **Deterministic AU economics engine** (`lib/solar/pricing.ts`): per-kW install price − `floor(kW × zone × deeming) × STC_price` (config-driven, date-stamped) = net price; payback from self-consumption + feed-in, presented as a **modelled estimate with a stated ±20% band**.
4. **Dedicated `/q/solar/[token]` page** with kW/kWh/STC/net/payback blocks; reuse Stripe deposit, GST, Maintain styling; **every quote tradie-reviewed before send** (no auto-send).
5. **No image in v1** (or, if a visual is required, a simple 2D panel-count diagram). Defer raster compositing and any generative render to v2 once the economics + compliance copy are proven.
