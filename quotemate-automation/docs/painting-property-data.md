# Painting — property-data enrichment

How the Paint Estimate turns an address into building facts, and where each
field comes from. Design + rationale: [`docs/superpowers/specs/2026-07-01-paint-estimate-property-data-enrichment-design.md`](superpowers/specs/2026-07-01-paint-estimate-property-data-enrichment-design.md).

## Pipeline

```
address ─▶ Solar (footprint)                       lib/painting/providers/solar.ts
        ─▶ enrichPaintingFacts()                   lib/painting/enrich.ts
             ├─ Geoscape enrich  (storeys, eave height, use, footprint fallback)
             │                                     lib/painting/providers/geoscape-enrich.ts
             └─ PropRadar enrich (beds/baths/car/type/land/floor-area/year)
                                                    lib/painting/providers/propradar.ts
        ─▶ user storeys override (always wins)      lib/painting/measure.ts
        ─▶ area engine ─▶ pricing ─▶ estimate       lib/painting/area.ts, pricing.ts
```

Both enrichers run concurrently and **merge non-null patches** onto the base
facts. Each **no-ops** when its API key is unset or its lookup misses, so an
estimate always completes on Solar alone.

## Field provenance

| PropertyFacts field | Source | Notes |
|---|---|---|
| `footprint_m2` | Google Solar (Geoscape `area` as fallback) | never overwritten once Solar sets it |
| `storeys` | Geoscape `estimatedLevels` | user's declared storeys overrides it |
| `eave_height_m` | Geoscape `averageEaveHeight` | ground-to-eave wall height → drives exterior façade area (clamped 2.1–15 m) |
| `property_type` | Geoscape `zonings[0]` → PropRadar `property_type` | PropRadar's specific type (House/Apartment) wins |
| `floor_area_m2` (+ `floor_area_source: 'listing'`) | PropRadar `floor_area_sqm` | high-confidence; preferred over the footprint derivation |
| `land_size_m2` | PropRadar `land_size_sqm` | |
| `bedrooms` / `bathrooms` / `car_spaces` | PropRadar `bedrooms` / `bathrooms` / `parking` | on-market/sold only |
| `year_built` | PropRadar `year_built` | **sparse** — frequently absent; no reliable self-serve source |

## Coverage boundaries (important)

- **Geoscape** — whole-of-market for aerial-covered addresses. Roof/height
  attributes are null for satellite/rural buildings. **No internal-floor-area or
  facade-material field exists on the live API** (confirmed by
  `scripts/probe-geoscape-building-attrs.mjs`).
- **PropRadar** — only **on-market or recently-sold** properties. Off-market
  addresses return `{found:false}` and contribute nothing (the majority of
  customer homes).
- **`year_built`** — no dependable self-serve source (Geoscape none; Domain
  package not entitled; PropRadar sparse). Left unfilled; would require CoreLogic
  or PropTrack (enterprise) to solve.

## Configuration

Both keys live in `.env.local` (gitignored) and are read at request time:

- `GEOSCAPE_API_KEY` — premium Geoscape key (shared with roofing). Host
  `https://api.psma.com.au/v1`, raw `Authorization: <key>` header.
- `PROPRADAR_API` — PropRadar key (`pr_live_…`). Host
  `https://api.propradar.com.au/v1`, `X-API-Key` header. Free tier = 50 calls/mo;
  production needs a paid plan.

Absent either key ⇒ that enricher silently no-ops.

## Where the data surfaces

- **Tradie** — `PaintResultView` (`/dashboard/painting` live + `/p/[token]`):
  storeys, beds/baths/car, land size, type/built, eave height, and the
  provenance in the capture note. Persisted automatically in
  `painting_measurements.estimate` jsonb — no migration.
- **Customer** — `/q/paint/[token]` "About your home" panel: type, bedrooms,
  bathrooms, car spaces, land size (only the fields present).

## Diagnostics

Read-only probes (run `node --env-file=.env.local scripts/<probe>.mjs "<address>"`):

- `scripts/probe-geoscape-building-attrs.mjs` — dumps a building's live attributes.
- `scripts/probe-propradar-apis.mjs` — search → detail field coverage.
- `scripts/probe-domain-apis.mjs` — Domain package entitlement (currently blocked).
