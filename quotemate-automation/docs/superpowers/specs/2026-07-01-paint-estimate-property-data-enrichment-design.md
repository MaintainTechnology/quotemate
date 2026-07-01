# Paint Estimate — property-data enrichment (Geoscape + PropRadar)

- **Date:** 2026-07-01
- **Status:** Design approved (brainstorming), pending spec review → implementation
- **Owner:** painting module (`lib/painting/*`, `app/dashboard/painting/*`, `app/q/paint/*`, `app/p/*`)
- **Related:** removal of the REA tab + demo toggle (prior change); roofing Geoscape client (`lib/roofing/providers/geoscape.ts`)

## 1. Goal

Enrich the Paint Estimate with real per-address building data so the tradie and
customer see complete, accurate property details and the paintable-m² estimate
is driven by real inputs (floor area, storeys, eave height) instead of
assumptions. Keep Google Solar as the footprint source; layer verified
providers on top.

## 2. What each source can and cannot give (verified against live APIs, 2026-07-01)

| Field | Google Solar (today) | Geoscape (premium key) | PropRadar (free key) |
|---|---|---|---|
| Building footprint | ✅ (used) | ✅ | — |
| Storeys | ❌ (user types it) | ✅ `estimated_floors` | — |
| Internal floor area | ❌ | ✅ `total_floor_area` (est.) | ✅ `floor_area_sqm` (listing) |
| Eave/ridge height | ❌ | ✅ `eave_height`/`roof_height` | — |
| Wall/facade material | ❌ (Street-View guess) | ✅ Facade Material pack | — |
| Building use (res/commercial) | ❌ | ✅ `building_use` | ✅ `property_type` |
| Land size | ❌ | Cadastre (separate product) | ✅ `land_size_sqm` |
| Bedrooms / bathrooms / car | ❌ | ❌ (not observable) | ✅ `bedrooms`/`bathrooms`/`parking` |
| Year built | ❌ | ❌ | ⚠️ schema field exists but was **not returned** for the probed property → sparse; do not rely on it |

**Coverage boundaries (critical):**
- **Geoscape** covers any address in **aerial** coverage; premium roof/height/facade
  attributes are NULL for satellite/rural buildings. Whole-of-market for geometry.
- **PropRadar** only holds **on-market or recently-sold** properties. An off-market
  address returns `{"found": false}`. So beds/baths/floor-area from PropRadar are
  **opportunistic** — present for a minority of customer addresses, absent for most.
- **Year built** has no reliable self-serve source (Geoscape none; Domain package
  blocked; PropRadar sparse). It stays unfilled unless CoreLogic/PropTrack
  (enterprise) is added later. This is an accepted gap, not a bug.

## 3. Architecture

A **sequential enrichment step** in the painting orchestrator
(`lib/painting/measure.ts`), after the Solar footprint lookup:

```
Solar.lookup(address)            → PropertyFacts (footprint only)
  → enrichFromGeoscape(facts)    → merge storeys, floor area, eave height,
                                    wall material, building use, capture note
  → enrichFromPropRadar(facts)   → if found: merge beds/baths/car, property type,
                                    land size, floor area (listing), year built
  → area engine → pricing → estimate
```

- Each enricher is a pure-ish adapter that does its own I/O and returns a
  **partial** `PropertyFacts` patch. The orchestrator merges **non-null only** and
  **never overwrites the Solar footprint**.
- Each enricher **no-ops** when its key is unset or the lookup misses
  (`GEOSCAPE_API_KEY` / `PROPRADAR_API`). No new feature flags — key presence is
  the gate, matching the roofing pattern.
- Floor-area merge is **confidence-ranked** (see §5), not last-write-wins.

**Why enrichment, not a new primary provider:** matches the chosen "Solar +
enrichment" strategy, keeps Solar's whole-of-market footprint coverage, and lets
each provider fail independently without breaking the estimate.

## 4. Data-model changes (`lib/painting/types.ts`)

Add to `PropertyFacts`:
- `eave_height_m: number | null` — Geoscape eave height (exterior wall band).
- `wall_material: string | null` — Geoscape facade material (seeds/cross-checks `MaterialCheck`).
- `car_spaces: number | null` — PropRadar parking (shown in "about your home").

Add to `FloorAreaSource`:
- `'geoscape_gfa'` — Geoscape estimated total floor area.

`bedrooms`, `bathrooms`, `year_built`, `property_type`, `land_size_m2` already
exist on `PropertyFacts` — they are populated, not added. All existing providers
(Solar, mock) must set the new fields to `null` (TS will enforce).

**No DB migration:** the full `PaintingEstimate` (incl. `facts`) is stored
verbatim in `painting_measurements.estimate` jsonb by `buildSavedPaintingRow`, so
new fields persist and flow to `/p` and `/q/paint` automatically.

## 5. Floor-area precedence (`lib/painting/area.ts`)

`resolveFloorArea` already prioritises: manual → `facts.floor_area_m2`
(source-typed) → footprint×storeys → beds. Extend the source→confidence map:

| Source | Confidence | Set by |
|---|---|---|
| `manual` | high | user override |
| `listing` | high | **PropRadar** `floor_area_sqm` |
| `geoscape_gfa` | medium | **Geoscape** `total_floor_area` |
| `footprint` | medium | Solar (derived) |
| `beds_estimate` | low | fallback |

Confidence-ranked merge so PropRadar (listing, high) wins over Geoscape GFA
(medium), which wins over the footprint derivation. The enricher only sets
`facts.floor_area_m2` if its source outranks whatever is already there.

**Exterior wall band:** `measurePaintableArea` uses the constant
`EXTERIOR_WALL_BAND_M = 2.7`. Change to `facts.eave_height_m` when present
(clamped to a sane 2.1–4.0 m range), else keep 2.7. Emit a derivation note when
the real eave height is used.

## 6. Provider adapters

### 6a. `lib/painting/providers/geoscape-enrich.ts` (new)
- Host `https://api.psma.com.au/v1`; auth header `Authorization: <GEOSCAPE_API_KEY>` (raw, no Bearer).
- Reuse **pure exported helpers** from `lib/roofing/providers/geoscape.ts`
  (`pickAddressId`, `pickBuildingSummaries`, `extractStoreys`, `extractArea`) —
  **do not modify** the roofing provider.
- Flow: `GET /addresses?addressString=&state=` → addressId → `GET /buildings?addressId=`
  → building summary `links` → GET the painting-relevant sub-resources.
- New **tolerant extractors** (mirror roofing's multi-alias style) for:
  `total_floor_area`, `eave_height`, facade/wall material, `building_use`,
  capture method/date. Extractors try several key names and degrade to `null`.
- **Build step 0 (blocking): live field-name probe.** Extend
  `scripts/probe-geoscape-apis.mjs` (or add sub-resource probing) to dump the
  exact `links`/field names your premium key returns for eave height, floor area
  and facade material against one address. Lock the extractor key lists to the
  probe output before finishing the adapter. (Premium pack fields are documented
  as bulk PSV; per-address live availability must be confirmed, not guessed.)
- Returns a partial `PropertyFacts` patch; unknown/absent fields → omitted.

### 6b. `lib/painting/providers/propradar.ts` (new)
- Host `https://api.propradar.com.au/v1`; auth header `X-API-Key: <PROPRADAR_API>`.
- Flow: `GET /properties/search?address=<street+suburb+state>&postcode=<4-digit>`.
  - On `{"found": false}` (off-market) → return an **empty patch** (no error).
  - On a match → take `property_id` → `GET /properties/{id}`.
- Map `attributes`: `bedrooms`→`bedrooms`, `bathrooms`→`bathrooms`,
  `parking`→`car_spaces`, `property_type`→`property_type`,
  `land_size_sqm`→`land_size_m2`, `floor_area_sqm`→`floor_area_m2`
  (source `'listing'`, high), `year_built`→`year_built` **iff present**.
- Respects the 429 / quota headers (`x-ratelimit-remaining`); on 429 → empty patch.
- Free plan = 50 calls/month; production needs a paid tier (noted, not solved here).

## 7. UI changes

**Tradie — `app/dashboard/painting/_components/PaintResultView.tsx`** (renders on
`/dashboard/painting` and `/p/[token]`):
- `Beds · baths`, `Land size`, `Type · built`, footprint already render from
  `facts.*` — they populate automatically once enrichment fills them.
- Add two stats: **`Eave height`** (`facts.eave_height_m`) and **`Wall material`**
  (`facts.wall_material`), shown only when non-null.
- Show data provenance: append the enrichment source(s) to the existing
  `capture_note` line (e.g. "Storeys + floor area from Geoscape; attributes from
  PropRadar listing").

**Customer — `app/q/paint/[token]/page.tsx`:**
- Add a concise **"About your home"** panel: floor area, storeys, property type,
  bedrooms/bathrooms (when present), and wall material — the human-meaningful
  fields only. **Do not** surface raw metadata (capture dates, footprint m²,
  valuation, quality flags). Renders only fields that are present.

**`MaterialCheck.tsx`:** when `facts.wall_material` is present, seed the panel
with it (Geoscape material as the baseline, Street-View AI as confirmation)
rather than starting from an empty guess. Non-breaking.

## 8. Config

- `GEOSCAPE_API_KEY` — already set (roofing). Reused; no change.
- `PROPRADAR_API` — new, in `.env.local` (gitignored). Document in `.env` example.
- No new feature flags. Keys absent ⇒ enrichers no-op ⇒ estimate still runs on Solar.

## 9. Testing

- `geoscape-enrich.test.ts`: each tolerant extractor parses fixture bodies
  (from the step-0 probe); missing sub-resource → field omitted; merge never
  overwrites Solar footprint; key-absent → empty patch.
- `propradar.test.ts`: `found:false` → empty patch; a match maps every attribute
  correctly incl. `_sqm` → `_m2`; missing `year_built` → omitted; 429 → empty patch.
- `area.test.ts` (extend): `eave_height_m` present changes exterior m²; clamp
  applied; `geoscape_gfa` source resolves to medium confidence.
- `measure.test.ts` (extend): enrichers absent → estimate identical to Solar-only;
  floor-area precedence (PropRadar listing > Geoscape GFA > footprint).
- Pure functions only — no live API calls in unit tests (inject `fetchImpl`).

## 10. Success gates

- `pnpm typecheck` clean.
- `pnpm test` green (existing + new).
- `pnpm lint` — no new errors (pre-existing `set-state-in-effect` warnings excepted).
- `/code-review` reports no blocker/major findings.

## 11. Out of scope / non-goals

- No reliable `year_built` source (needs enterprise CoreLogic/PropTrack) — left unfilled.
- Domain API (project not scoped for property lookup) — parked.
- Geoscape Cadastre land-parcel product (land size via Geoscape) — PropRadar covers
  land size opportunistically; not adding a second Geoscape product now.
- Roof-only Geoscape fields (roof material/shape/slope, solar, tree overhang) — roofing, not painting.
- PropRadar valuation/rental data — not painting-relevant; not displayed.
- PropRadar paid tier / production quota — flagged, not provisioned here.

## 12. Reversibility

- All changes are additive: new adapter files, additive `PropertyFacts` fields,
  additive UI stats, no migration, no edits to the roofing provider.
- Removing the two keys reverts behaviour to Solar-only with zero code changes.

## 13. Files to change / create

**Create:** `lib/painting/providers/geoscape-enrich.ts` (+ `.test.ts`),
`lib/painting/providers/propradar.ts` (+ `.test.ts`),
`docs/painting-property-data.md` (integration + data-flow doc).
**Edit:** `lib/painting/types.ts`, `lib/painting/measure.ts`, `lib/painting/area.ts`,
`app/dashboard/painting/_components/PaintResultView.tsx`,
`app/dashboard/painting/_components/MaterialCheck.tsx`,
`app/q/paint/[token]/page.tsx`, `.env` example.
**Diagnostics (already created):** `scripts/probe-geoscape-apis.mjs`,
`scripts/probe-geoscape-building-attrs.mjs`, `scripts/probe-domain-apis.mjs`,
`scripts/probe-propradar-apis.mjs`.

## 14. Probe findings (2026-07-01) — design corrections

Live probe of the premium Geoscape key (`scripts/probe-geoscape-building-attrs.mjs`,
31 Greens Rd Coorparoo) returned per-address building attributes. The valid
`?include=` whitelist is authoritative: `area, averageEaveHeight, centroid,
elevation, estimatedLevels, footprint2d, footprint3d, maximumRoofHeight,
overhangingTree, roofComplexity, roofMaterial, roofShape, solarPanel,
swimmingPool, zonings`. Corrections to §2/§4/§5/§6a/§7:

- ❌ **No `total_floor_area` / GFA field exists** on the live API. Drop the
  `geoscape_gfa` `FloorAreaSource` and the Geoscape floor-area path entirely.
  Floor area = PropRadar `floor_area_sqm` (listing, high) when on-market, else the
  existing footprint×storeys derivation. No `FloorAreaSource` change needed.
- ❌ **No facade/wall material field** on this key. Drop the Geoscape `wall_material`
  path and the `MaterialCheck` seeding edit. Street-View AI remains the wall source.
- ✅ **Storeys** ← `estimatedLevels` (e.g. 2). **Eave height** ← `averageEaveHeight`
  (e.g. 8.94 m) — this is the **total ground-to-eave wall height**, so the exterior
  façade uses `perimeter × eave_height × gable` and drops the `× storeys` factor
  (clamped 2.1–15 m). **Building use** ← `zonings[0]` (e.g. "Residential") → `property_type`.
  **Footprint** ← `area` (used only as a fallback when Solar's footprint is null).
- **Revised `PropertyFacts` additions:** `eave_height_m?`, `car_spaces?` only
  (drop `wall_material`). Both optional so existing provider literals/fixtures are
  untouched.
- **Merge orchestration** lives in a new pure-testable `lib/painting/enrich.ts`
  (`applyEnrichment` + `enrichPaintingFacts`) rather than inline in `measure.ts`.
- Available-but-out-of-scope for painting (roofing/context): `roofMaterial`,
  `roofShape`, `maximumRoofHeight`, `roofComplexity`, `solarPanel`, `swimmingPool`,
  `overhangingTree`, `elevation`, `footprint3d`.
