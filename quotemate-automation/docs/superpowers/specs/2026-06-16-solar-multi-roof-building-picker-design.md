# Solar multi-roof building picker — design (approach A)

> Status: approved 2026-06-16. Lets a user pick which building on a property the
> solar estimate is for, instead of being locked to the single building Google's
> `buildingInsights:findClosest` snaps to. Switching a building re-runs the
> estimate against that roof.

## Problem

A solar estimate today is keyed to one address → one geocoded point → Google
`buildingInsights:findClosest`, which returns the **single nearest building**
([lib/solar/coverage.ts](../../../lib/solar/coverage.ts),
[lib/roofing/solar-api.ts](../../../lib/roofing/solar-api.ts)). On a property with
several structures (house + shed + granny flat) the customer/tradie cannot choose
or correct which building is estimated. `findClosest` is single-building by
design — the only way to reach a different building is to query a different point.

## Decisions (locked with the requester)

1. **Switch / pick the right building** — one system per estimate, but the user
   chooses which roof. (Not multi-building aggregation, not per-roof-face.)
2. **Picker on all three surfaces** — customer address entry, customer
   quote/heatmap page, tradie dashboard — one shared component.
3. **Pre-detect & highlight all buildings** — show every structure as a tappable
   outline (not free-click).
4. **Lazy compute** — detect + outline cheaply up front; compute a building's full
   solar (roof facts + sun heatmap + pricing) only when it is selected.

## Approach A — one property record, `buildings[]` cache + `selected_building_id`

The existing `solar_estimates` row becomes the **property record**:

- `buildings jsonb` — the detected building list (lightweight metadata for the
  picker), `DetectedBuilding[]`.
- `selected_building_id text` — pointer to the building the headline estimate
  currently reflects.

The row's existing `estimate` jsonb always mirrors the **selected** building, so
the quote page, `redraft`, `confirm`, and `SolarTab` keep reading the row
unchanged. A child table **`solar_building_cache(estimate_id, building_id,
estimate jsonb, computed_at)`** stores each *other* building's lazily-computed
result so switching back is instant. Heatmap PNGs are namespaced per building:
`solar/{id}/{building_id}/flux-annual-*.png`.

Detection is a **route-level concern** — the deterministic engine
(`runSolarEstimate`) stays building-agnostic and only gains an optional
`targetLocation` (the building centroid) that overrides the geocoded point fed to
`findClosest` / `dataLayers`. This is exactly what `redraft` already does, just
re-pointed.

## Components

### 1. Detection — `lib/solar/buildings.ts`
`detectPropertyBuildings(address, { measureAll })` wraps the roofing Geoscape
`measureAll` ([lib/roofing/providers/geoscape.ts](../../../lib/roofing/providers/geoscape.ts))
which already enumerates every structure (primary + secondary, up to 6) with
footprint polygon, area, roof shape, storeys. Maps each into `DetectedBuilding`,
ranks primary-first, computes a footprint centroid, and derives a friendly label
by role/area. Geoscape-only (~6 credits), no Google Solar spend.

Degrades safely: Geoscape unset/unavailable or ≤1 building → `[]` or a single
primary; the picker is hidden and behaviour equals today's (findClosest at the
geocoded address). The **primary** building's estimate keeps using the geocoded
location (no regression); only an explicitly-selected building uses its centroid.

### 2. Engine — `lib/solar/intake.ts`
`runSolarEstimate` gains optional `targetLocation: LatLng`. When set, it replaces
the geocode/address-validation result as the point used for coverage, insights,
and dataLayers. Everything downstream (sizing/pricing/sun assets) is unchanged.

### 3. Persistence — `lib/solar/persist-helpers.ts`
`buildSolarRowPayloads` gains optional `buildings` + `selectedBuildingId` and
stamps them on the `solar_estimates` insert (default `[]` / null).

### 4. API
- `POST /api/solar/[tenantSlug]/detect` `{ address }` — pre-estimate detection so
  the **address form** can show the picker before generating. 1 building → skip
  to generate; >1 → customer confirms which, then create the estimate for it.
- `GET  /api/solar/q/[token]/buildings` — detected buildings (footprints,
  centroids, labels, status) for the picker.
- `POST /api/solar/q/[token]/select-building` `{ building_id }` — flips the
  pointer; cache-hit loads instantly, cache-miss runs the engine at that centroid
  (lazy), caches it, repoints the row, regenerates the heatmap, returns the
  updated view. Reuses the redraft engine internally.
- The creation route (`/api/solar/[tenantSlug]/estimate`) runs detection in its
  `after()` and stamps `buildings` + the primary `selected_building_id`.

### 5. UI — one shared `BuildingPicker`
Renders the satellite image
([static-map route](../../../app/api/solar/q/[token]/static-map/route.ts)) with
**SVG building outlines projected onto the image** — the same projection
technique [SunShadeOverlay](../../../app/q/solar/[token]/SunShadeOverlay.tsx) uses
to pin the sun dots, so **no new map library**. Selected building shows its
heatmap + green sun markers; others are dimmed, tappable outlines. Reused on the
address form (local selection pre-estimate), the quote page (calls
`select-building`), and `SolarTab` (tradie, authed).

## Gating & locking

- **Customer** may switch only while the estimate is **unreleased**
  (`confirmed_at IS NULL`); pricing stays hidden behind the tradie's
  [Confirm & Release](../../../app/api/solar/confirm/[token]/route.ts) the whole
  time.
- **After release → locked.** Switching a released quote returns 409 — the path
  forward is a new estimate (mirrors `redraft`'s post-confirm block).
- **Tradie** switches during review; the re-estimate re-runs guardrails so a
  newly-selected roof with issues surfaces flags in `SolarTab` exactly like
  redraft.

## Edge cases

- **1 or 0 buildings detected** → picker hidden; behaves like today (incl. manual
  fallback when uncovered).
- **Selected building has no Google Solar coverage** (404 / below imagery floor)
  → `solar_status: 'no_coverage'`, shown as "no solar data for this roof", not
  selectable for pricing (a shed may lack data even when the house has it).
- **Distant buildings** (rural) → `dataLayers` re-centres its 50 m radius on the
  selected building's centroid; the detection map auto-zooms to a bbox enclosing
  all footprints.
- **Felt variant** → static-map picker ships first; wiring the same outlines into
  the Felt map ([lib/solar/felt-map.ts](../../../lib/solar/felt-map.ts)) is a
  fast-follow.

## Data model (migration 114)

```sql
alter table public.solar_estimates
  add column if not exists buildings jsonb not null default '[]'::jsonb,
  add column if not exists selected_building_id text;

create table if not exists public.solar_building_cache (
  estimate_id  uuid not null references public.solar_estimates(id) on delete cascade,
  building_id  text not null,
  estimate     jsonb not null,           -- the per-building SolarEstimate
  computed_at  timestamptz not null default now(),
  primary key (estimate_id, building_id)
);
```

## Build sequence

1. Migration 114 + `run-migration-114.mjs`.
2. `DetectedBuilding` types in `lib/solar/types.ts`.
3. `lib/solar/buildings.ts` + tests (detection mapping, centroid, labels).
4. `runSolarEstimate` `targetLocation` override.
5. `persist-helpers` + creation route detection in `after()`.
6. API: detect, buildings, select-building.
7. Shared `BuildingPicker` + projection util; wire 3 surfaces.
8. Gating/lock + edge cases.
9. Typecheck, lint, tests.

## Integration decisions (build 2026-06-16)

Two consequential decisions surfaced while wiring this into the live pipeline:

1. **Multi-building estimates are HELD unreleased.** Clean solar estimates
   auto-release (Path B) which stamps `confirmed_at` and would lock the picker
   before anyone could choose the roof. So when ≥2 buildings are detected the
   estimate is **not** auto-released — it stays tradie-review so the customer/
   tradie picks the right building, then the tradie confirms. Single-building
   estimates auto-release exactly as before. Detection + release + notify are
   folded into one ordered `after()` block so the building count gates release
   without a cross-callback race; a detection failure falls back to today's
   auto-release. ⚠ This changes live auto-send behaviour for multi-building
   properties — flag for sign-off.
2. **Address-form static-map proxy is AU-bounds-guarded.** The pre-estimate
   picker needs a satellite image before a token exists, so a public
   tenant-gated `GET /api/solar/[tenantSlug]/static-map` proxies Google Static
   Maps. Tenant ids are effectively public, so the route is constrained to AU
   coordinates to kill its value as a free global image proxy. ⚠ Residual risk:
   it still spends the server Maps key for any AU coordinate — a signed,
   short-lived URL is the proper follow-up.

## Testing

Unit (Geoscape→`DetectedBuilding` mapping, labelling, centroid, footprint→image
projection, selection state machine, engine `targetLocation` override), API
(gating/lock, lazy compute + cache hit), and an e2e extension of the existing
solar specs (multi-building address → switch → estimate + heatmap update).
