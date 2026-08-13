# Painting room schedule — per-room takeoff replaces the single-box heuristic

## Goal

`measurePaintableArea` currently models every house as ONE empty box: interior trim is
`1.08 × 4 × √floor_area × 1.6` (`lib/painting/area.ts:202-209`), which has no idea how many
rooms exist, and interior walls are `floor_area × 2.8–3.6`. Measured against real dimensioned
floor plans this is wrong in BOTH directions at once — walls **over** by 28–51%, skirting
**under** by 38–56% (evidence below). The errors do not cancel: roller work (cheap per m²) is
over-priced and brush work (expensive per lm, and the line that blows out on site) is
under-priced by half.

This spec adds a per-room path. When the caller supplies a room list, walls / ceilings / trim
are derived from real per-room geometry (Σ perimeter × height, Σ area, Σ perimeter) instead of
one whole-house perimeter. When no rooms are supplied, behaviour is **byte-identical to today**.

## Role

Principal engineer for this repo. Reason before acting; read before describing; parallel
independent calls; never guess parameters. **TDD everything** — this is the painting money path,
and `lib/painting/area.test.ts` / `takeoff.test.ts` are the style reference.

## Context (grounded in code opened 2026-08-13)

- **`measurePaintableArea(facts, inputs): PaintMeasurement | null`** — `area.ts:167`. Only ONE
  production call site: `lib/painting/measure.ts:149`. Everything else is tests. Adding an
  optional field to `PaintUserInputs` therefore reaches production without touching any other
  caller.
- **Current derivations** (`area.ts:189-234`): walls `floor × WALL_MULTIPLIER[ceiling_height]`
  (2.8 / 3.2 / 3.6 / 3.5); ceilings `floor`; trim `K_SHAPE_INTERIOR(1.08) × 4 × √floor × 1.6`;
  exterior `K_SHAPE_EXTERIOR(1.15) × 4 × √footprint × wallHeight × GABLE_FACTOR(1.1)`. Every
  surface passes through `withBand()` (`area.ts:179`) using
  `CONFIDENCE_BAND = {high:0.12, medium:0.25, low:0.4}` (`area.ts:67`).
- **`resolveFloorArea`** (`area.ts:91`) priority: `manual` → `facts.floor_area_m2` →
  `footprint × storeys × EAVES_CORRECTION(0.9)` → `bedrooms × 45`. Confidence mapping at
  `area.ts:118-123`: `listing|manual → high`, `footprint → medium`, **everything else → low**.
  A new `FloorAreaSource` value that is not added to that map silently degrades to `low`.
- **`PaintSurfaceArea` / `PaintMeasurement` are safe to EXTEND** — `pricing.ts` and `takeoff.ts`
  read `surfaces` only by named field (`.scope`, `.unit`, `.quantity`, `.quantity_low`,
  `.quantity_high`) and never by order or length. Adding fields is non-breaking; renaming
  `scope` or changing the `'m2'`/`'lm'` literals breaks `pricing.ts:249,396`,
  `takeoff.ts:212,222,309` and the UI display ternaries.
- **`measurement.notes` reach the CUSTOMER**, filtered through `customerMeasurementNotes`
  (`lib/painting/customer-notes.ts`) which strips sentences matching
  `/^(confirm|set |check )|before quoting|treated as confirmed/i`. New notes must read cleanly
  to a homeowner or be phrased so that filter removes them.
- **Floor-plan extraction already exists** for aircon: `runPlanExtraction` /
  `parsePlanExtraction` (`lib/aircon/plan-extract.ts:174,139`) return `AcPlanExtraction`
  (`lib/aircon/types.ts:194`) = `{ page, rooms: AcExtractedRoom[], stated_total_area_m2,
  overall_note }`, where `AcExtractedRoom` (`types.ts:180`) =
  `{ name, room_type: ExtractedRoomType, polygon: AcPlanPoint[], dimensions_text?, area_m2?,
  confidence: AcConfidence }`. `ExtractedRoomType` (`types.ts:168`) =
  `bedroom | living | kitchen | study | bathroom | laundry | garage | hall | other`.
  **`ROOM_TYPES` at `plan-extract.ts:42` is module-private — do not try to import it.**
- **`parseDimensionText(text): number | null`** (`lib/aircon/plan-scale.ts:31`) already parses
  `"3.6 x 4.2"`, `"3600 × 4200"`, `"3.6m x 4.2m"`, `"3,600 x 4,200"` — values ≥ 100 are read as
  millimetres — but returns **area only**, so it cannot yield a perimeter. This spec needs the
  width/length PAIR, which is a new parser, pinned to the existing one by an equivalence test.
- **Enricher template**: `lib/painting/providers/propradar.ts` — `Partial<Pick<PropertyFacts,…>>`
  patch type, a single shared `EMPTY` sentinel, `fetchImpl?: FetchLike` injection, env read
  inside the function body, an early no-op guard on missing key/inputs, an internal `getJson`
  that converts every non-2xx and every transport error into `null` (nothing throws), and
  file-scope `num()` / `str()` coercers. `applyEnrichment` merge rules are in `enrich.ts:45-90`.
- **Domain API, verified live 2026-08-13** (2 billable calls, trial quota 20/day):
  `GET https://api.domain.com.au/v1/properties/_suggest?terms=…&channel=All` with header
  `X-Api-Key` returns `[{ id, address, addressComponents, relativeScore }]` and is **free — it
  returns no `x-quota-perday-*` headers and the docs state it does not count toward quota**.
  `GET /v1/properties/{id}` costs 1 unit and returns `{ bedrooms, bathrooms, carSpaces, storeys,
  yearBuilt, propertyType, propertyCategory, areaSize (LAND m²), internalArea (m², present only
  when the advert carried it), addressCoordinate, features[], history.sales[],
  photos: [{ imageType: 'Property' | 'FloorPlan', fullUrl, rank, date, advertId }] }`.
  `imageType` is NOT reliable — on `TP-6525-NI` a photo tagged `FloorPlan` was an interior shot.
- **Evidence for the defect** (per-room geometry from real Domain plans vs the current engine,
  same floor area fed to both; walls net of 12% openings, skirting net of 10% for doorways):

  | | Point Piper — 10 rooms, 194 m², 2.7 m | Chandler — 19 rooms, 336 m², 3.0 m |
  |---|---|---|
  | Walls | plan 411 m² vs engine **621 m²** (over 51%) | plan 839 m² vs engine **1,075 m²** (over 28%) |
  | Skirting | plan 156 lm vs engine **96 lm** (under 38%) | plan 286 lm vs engine **127 lm** (under 56%) |

- **Gates**: `npm test` (vitest, node env, colocated `lib/**/*.test.ts`), `npm run typecheck`.
  Baseline confirmed green 2026-08-13: `lib/painting/area.test.ts` 11 tests +
  `lib/painting/takeoff.test.ts` 29 tests = 40 passing.

## Task

### A — Types (`lib/painting/types.ts`)

1. Add `export type PaintRoomType = 'bedroom' | 'living' | 'kitchen' | 'bathroom' | 'laundry' |
   'study' | 'hall' | 'garage' | 'other'` — deliberately the same nine members as aircon's
   `ExtractedRoomType` so the adapter is a total mapping with no fallback loss.
2. Add:
   ```ts
   export type PaintRoom = {
     id: string                      // stable key for include/exclude round-trips
     name: string                    // label as printed on the plan, e.g. "BEDROOM 2"
     room_type: PaintRoomType
     width_m: number | null          // null when the plan printed no dimensions
     length_m: number | null
     floor_area_m2: number | null    // width×length when known, else the plan's own area_m2
     included: boolean               // in this job's scope
     source: 'plan' | 'manual'
     confidence: PaintConfidence
   }
   ```
3. Extend `FloorAreaSource` with `'floor_plan'` — "summed from a dimensioned floor plan → high".
4. Add `rooms?: PaintRoom[]` to `PaintUserInputs` (optional; absent on every existing caller and
   every persisted row).
5. Extend `PaintMeasurement` additively with:
   - `basis?: 'rooms' | 'whole_house'` — which path produced the surfaces.
   - `rooms?: PaintRoom[]` — the rooms actually used (included only), echoed for the UI.
   Both optional so older `estimate` jsonb still type-checks and renders.
6. Add `floor_plan_urls?: string[] | null` to `PropertyFacts` (enrichment-only, optional).

### B — Room geometry engine (`lib/painting/rooms.ts`, NEW, PURE)

Export these constants and functions. No I/O, no `Date`, no randomness.

7. Constants, each with a comment stating what it models:
   - `ROOM_OPENING_DEDUCTION = 0.12` — doors/windows removed from gross wall area. Mid of the
     10–15% band `area.ts:47-49` already documents for `WALL_MULTIPLIER`.
   - `SKIRTING_RUN_FACTOR = 0.90` — share of a room's perimeter that actually carries skirting,
     after doorways and fitted joinery.
   - `ARCHITRAVE_LM_PER_ROOM = 5.0` — one standard 2040×820 door architrave set per room. Flat
     per room: it over-counts an open-plan space and under-counts a hall with four openings, and
     is a named constant so a tenant override can refine it later.
   - `DEFAULT_EXCLUDED_ROOM_TYPES: PaintRoomType[] = ['garage']` — painters quote the garage
     separately when they quote it at all.
8. `export function parseRoomDimensions(text: string | null | undefined):
   { width_m: number; length_m: number } | null` — the width/length pair. MUST accept exactly the
   formats `parseDimensionText` accepts (`"3.6 x 4.2"`, `"3600 × 4200"`, `"3.6m x 4.2m"`,
   `"3,600 x 4,200"`), MUST apply the same `≥ 100 ⇒ millimetres` rule, and MUST return `null` for
   anything it cannot parse. Where both return non-null, `width_m × length_m` must equal
   `parseDimensionText(text)` to within 0.01 m² — enforced by an equivalence test.
9. `export function roomPerimeterM(room: PaintRoom): number | null` —
   `2 × (width + length)` when both dimensions are known; else
   `K_SHAPE_INTERIOR × 4 × √floor_area_m2` when only the area is known (import
   `K_SHAPE_INTERIOR` — see A/C note below); else `null`.
10. `export function measureFromRooms(rooms, opts): RoomMeasurementTotals | null` where
    `opts = { ceilingHeightM: number }` and
    ```ts
    export type RoomMeasurementTotals = {
      floor_area_m2: number       // Σ included room floor areas
      wall_area_m2: number        // Σ (perimeter × ceilingHeightM) × (1 − ROOM_OPENING_DEDUCTION)
      ceiling_area_m2: number     // === floor_area_m2
      trim_lm: number             // Σ (perimeter × SKIRTING_RUN_FACTOR) + n × ARCHITRAVE_LM_PER_ROOM
      rooms_used: PaintRoom[]     // included rooms that contributed geometry
      rooms_without_dimensions: number  // included, contributed area but no printed w×l
      all_dimensioned: boolean    // every contributing room had a printed w×l
    }
    ```
    Only `included` rooms contribute. A room with neither dimensions nor area contributes
    nothing and is not counted in `rooms_used`. Returns `null` when no included room yields any
    geometry. Every returned number rounds through `roundTo(_, 1)`.

### C — Wire the per-room path into `lib/painting/area.ts`

11. Export `K_SHAPE_INTERIOR` (it is currently module-private at `area.ts:59`) so `rooms.ts` can
    reuse it rather than redeclaring 1.08. Do not change its value or any other constant.
12. In `measurePaintableArea`, **before** calling `resolveFloorArea`: when
    `inputs.rooms` is a non-empty array AND `measureFromRooms(inputs.rooms, {ceilingHeightM})`
    returns non-null, take the per-room path:
    - `floor_area_m2` = totals.floor_area_m2; `floor_area_source` = `'floor_plan'`;
      `confidence` = `'high'` when `totals.all_dimensioned`, else `'medium'`.
    - `inputs.manual_floor_area_m2` STILL WINS — a hand-entered area overrides the plan, matching
      the existing priority at `area.ts:97`. When it is set, take the whole-house path.
    - walls ← `totals.wall_area_m2`; ceilings ← `totals.ceiling_area_m2`; trim ← `totals.trim_lm`.
      Each still emitted through `withBand()` and still gated on `inputs.scopes`.
    - **exterior is UNCHANGED** — still `extPerimeter × wallHeight × GABLE_FACTOR` from the
      footprint. Interior rooms say nothing about the façade.
    - `basis: 'rooms'`, `rooms: totals.rooms_used`.
    - notes: one sentence per derived surface naming the room count, e.g.
      `Walls measured from 12 rooms on the floor plan (Σ perimeter × 2.4 m, 12% openings deducted).`
      and, when `rooms_without_dimensions > 0`,
      `3 rooms had no printed dimensions and were sized from their plan area.`
      These are customer-visible — no imperatives, no trade rates.
13. Otherwise take the existing whole-house path **unchanged**, additionally stamping
    `basis: 'whole_house'`.
14. Add `'floor_plan'` to the confidence mapping in `resolveFloorArea` (`area.ts:118-123`)
    alongside `listing`/`manual` → `'high'`, so a `PropertyFacts.floor_area_source` of
    `'floor_plan'` arriving from anywhere is not silently demoted to `low`.

### C2 — Amendments found during review (2026-08-13)

Three defects surfaced by `/code-review` that the original §C did not cover. They are
requirements, not suggestions.

19. **The exterior fallback must not read the room total.** `area.ts:244` derives the exterior
    footprint as `facts.footprint_m2 || floor / storeys`, and on the per-room path `floor` is the
    room-schedule sum. With `facts.footprint_m2` null that silently changes the façade area,
    breaking this spec's own "exterior is UNCHANGED" constraint. The exterior branch must use the
    **whole-house** resolved floor area (`resolveFloorArea(facts, inputs)`) for that fallback,
    never the room total. Test it with `footprint_m2: null` and rooms supplied: the exterior
    quantity must equal the no-rooms run exactly.

20. **A targeted structure suppresses the room path.** `inputs.structure` means the tradie picked
    ONE building at a multi-structure address, but a plan's room list covers the whole property.
    Measuring every room would quote the main house when the granny flat was selected. When
    `inputs.structure` is set, `resolveRoomTotals` must return `null` and the whole-house path
    runs. Add a note recording which building was measured. **The note is customer-visible** —
    `measurement.notes` reaches `/q/paint/[token]` and the customer PDF via
    `customerMeasurementNotes` — so it must state the fact in homeowner English with no internal
    jargon: `Measured for the selected building at this address.` A homeowner does not know what
    a "room schedule" is, and "so it was not used" reads as a failure. Assert in the test both
    that the note survives `customerMeasurementNotes` unchanged and that it contains no
    internals, mirroring the room-path note check.

21. **`sourceWords` must name the floor-plan source.** This supersedes the "No UI in this spec"
    constraint for exactly one line: `app/dashboard/painting/_components/PaintResultView.tsx:301`
    switches on `floor_area_source` and is NOT generic, so `'floor_plan'` falls to
    `default: 'estimated'` — labelling the most accurate source with the vaguest wording. Add
    `case 'floor_plan': return 'measured from floor plan'`. No other UI change is permitted.

22. **`rooms` must survive HTTP validation.** `PaintInputsSchema` (`lib/painting/request-schema.ts`)
    is a plain `z.object`, so Zod strips `rooms` and the per-room path is unreachable through
    `/api/painting/estimate` — the feature cannot run in production. Add a `rooms` array schema
    mirroring `PaintRoom`, `.optional()`, with sane bounds (name ≤ 120 chars, dimensions positive
    and ≤ 100 m, at most 200 rooms). Extend `lib/painting/request-schema.test.ts` to prove a
    request carrying rooms parses and that the parsed value reaches `inputs.rooms`.

### D — Plan-extraction adapter (`lib/painting/plan-rooms.ts`, NEW, PURE)

15. `export function paintRoomsFromPlanExtraction(extraction: AcPlanExtraction | null | undefined,
    opts?: { excludeTypes?: PaintRoomType[] }): PaintRoom[]`
    - Maps each `AcExtractedRoom` → `PaintRoom`: `name` verbatim; `room_type` 1:1 (identical
      unions); `width_m`/`length_m` from `parseRoomDimensions(dimensions_text)`;
      `floor_area_m2` = `width × length` when parsed, else `area_m2 ?? null`;
      `confidence` passthrough (`AcConfidence` and `PaintConfidence` are both
      `'high'|'medium'|'low'`); `source: 'plan'`.
    - `id` = stable, deterministic, unique within the returned array: slugified name plus a
      1-based ordinal, e.g. `bedroom-2-4`. Deterministic means no `Date`/`Math.random` — the same
      extraction must always produce the same ids.
    - `included` = `false` when `room_type` is in `opts.excludeTypes ?? DEFAULT_EXCLUDED_ROOM_TYPES`,
      else `true`.
    - Rooms with neither a parseable `dimensions_text` nor a positive `area_m2` are still
      returned (so the tradie can see and correct them) but with `floor_area_m2: null`;
      `measureFromRooms` ignores them.
    - Returns `[]` for null/undefined input or an empty `rooms` array.

### E — Domain property enricher (`lib/painting/providers/domain-enrich.ts`, NEW)

16. Follow `propradar.ts` structurally: `DomainEnrichOpts = { apiKey?: string; baseUrl?: string;
    fetchImpl?: FetchLike }`; `DomainPaintPatch = Partial<Pick<PropertyFacts, 'bedrooms' |
    'bathrooms' | 'car_spaces' | 'storeys' | 'year_built' | 'property_type' | 'land_size_m2' |
    'floor_area_m2' | 'floor_area_source' | 'has_floor_plan' | 'floor_plan_urls'>>`;
    `DomainEnrichResult = { patch: DomainPaintPatch; notes: string[]; found: boolean }`; a single
    shared `EMPTY` sentinel.
17. `export async function enrichFromDomain(input: PaintAddressInput, opts: DomainEnrichOpts = {}):
    Promise<DomainEnrichResult>`
    - Key: `opts.apiKey ?? process.env.DOMAIN_API_KEY ?? process.env.DOMAIN_API`. Base:
      `opts.baseUrl ?? process.env.DOMAIN_API_BASE_URL ?? 'https://api.domain.com.au'`.
    - Early `return EMPTY` when there is no key or no non-empty `input.address`.
    - `GET {base}/v1/properties/_suggest?terms=<address>&channel=All&pageSize=5` with headers
      `{ 'X-Api-Key': key, Accept: 'application/json' }`; take the **highest `relativeScore`**
      entry's `id`; `EMPTY` when the array is empty or unparseable.
    - `GET {base}/v1/properties/{id}` with the same headers.
    - Map: `bedrooms`, `bathrooms`, `carSpaces → car_spaces`, `storeys`, `yearBuilt → year_built`,
      `propertyType → property_type`, `areaSize → land_size_m2` (LAND, never floor area).
      `internalArea` → `floor_area_m2` **with `floor_area_source: 'listing'`**, and only when it
      is a positive finite number — it is absent on many records.
    - `floor_plan_urls` = `photos.filter(p => p.imageType === 'FloorPlan').map(p => p.fullUrl)`;
      `has_floor_plan` = that array's length > 0.
    - Note: `Domain: <address>` plus `internal area <n> m²` when present. `found: true` only when
      the detail fetch returned a usable object.
    - **Nothing throws.** Every non-2xx (including 429) and every transport error resolves to
      `EMPTY`, exactly like `propradar.ts`'s `getJson`.
18. Wire into `lib/painting/enrich.ts`: add `domain?: DomainEnrichOpts` to `EnrichPaintingOpts`,
    add `domain?: DomainEnrichResult` to `EnrichmentSources`, run `enrichFromDomain` in the
    existing `Promise.all`, and extend `applyEnrichment` with a Domain block that runs only when
    `found`, applying:
    - `bedrooms`, `bathrooms`, `car_spaces`, `year_built`, `land_size_m2` — fill only when the
      base value is `null`/absent (PropRadar stays authoritative where it has an answer).
    - `storeys` — fill only when base storeys is falsy or ≤ 0 (same guard Geoscape uses).
    - `property_type` — fill only a `null`.
    - `floor_area_m2` / `floor_area_source` — apply only when `!opts.targeted` AND the base
      `floor_area_m2` is null/≤0. Never override PropRadar's listing area or a targeted
      structure's footprint area.
    - `has_floor_plan` / `floor_plan_urls` — always applied when present.
    - Notes concatenated into `capture_note` like the other two.

## Constraints

- **PURE for all new maths.** `rooms.ts` and `plan-rooms.ts`: no I/O, no LLM, no `Date.now()`,
  no `Math.random()`. `domain-enrich.ts` is the only new file that touches the network.
- **Byte-identical fallback.** With `inputs.rooms` absent, empty, all-excluded, or yielding no
  geometry, `measurePaintableArea` must return exactly what it returns today for every field
  except the new `basis: 'whole_house'`. A dedicated invariance test enforces this.
- **Do not touch the exterior derivation, `resolveFloorArea`'s priority order, `pricing.ts`,
  `takeoff.ts`, `report-html.ts`, the SMS composers, or any customer-facing template.** Quoted
  numbers move only because the measured quantities are more accurate — no rate, multiplier,
  tier fraction, or GST factor changes.
- **Do not modify `lib/aircon/*`.** `parseDimensionText` is read as the reference for
  `parseRoomDimensions`; the aircon module itself stays untouched.
- **No UI in this spec**, with the single exception in item 21. `app/dashboard/painting/page.tsx`
  and `app/q/paint/[token]/page.tsx` are NOT edited, and in `PaintResultView.tsx` only the one
  `sourceWords` case may be added. Everything else there renders `measurement.surfaces` and
  `measurement.notes` generically and picks up better numbers with no change.
- **No new tables, no migrations, no new dependencies.** `rooms` rides `PaintUserInputs`;
  `basis`/`rooms` ride the existing `estimate` jsonb.
- **Backward compatibility.** Every persisted `PaintingEstimate` predates `basis`/`rooms`/
  `floor_plan_urls`; all three are optional and no consumer may assume them.
- **AU units** — m², lm, metres. Australian English in every note and comment.
- **No live Domain calls in tests.** The trial key has a 20/day quota. Every
  `domain-enrich.test.ts` case injects `fetchImpl`.

## Non-goals (explicitly NOT built)

- Downloading a floor-plan image, calling `runPlanExtraction` on it, persisting the result, or
  any orchestration that turns `floor_plan_urls` into `PaintRoom[]` at runtime. This spec
  delivers the adapter; the fetch/extract/cache pipeline is the next spec.
- Any UI for viewing or toggling rooms.
- Interior colour preview, lead-paint gating, job-character flags, multi-building schedules,
  prospecting — all separately specced later.
- Per-room ceiling heights, per-room condition, per-room colour.
- Changing what the customer is charged, or any pricing/tier/routing logic.

## Acceptance criteria & gates

1. `npm test` passes, including new `lib/painting/rooms.test.ts`,
   `lib/painting/plan-rooms.test.ts`, `lib/painting/providers/domain-enrich.test.ts`, and the
   extended `lib/painting/area.test.ts`. The 40 existing painting tests still pass unchanged.
2. `npm run typecheck` passes for every file in this spec's scope. Report any residual error in
   files outside it explicitly rather than fixing them.
3. **Invariance test** in `area.test.ts`: for a fixture with no `rooms`, every field of
   `measurePaintableArea`'s output equals the pre-change output, `basis` aside.
4. **Worked example test** (§Examples) reproduces the exact numbers below.
5. **Divergence test**: a 12-room fixture totalling the same floor area as a whole-house run
   produces materially MORE trim and LESS wall area than the whole-house path — the direction of
   the documented defect, asserted as a direction, not a magic number.
6. **Equivalence test**: for each of `"3.6 x 4.2"`, `"3600 × 4200"`, `"3.6m x 4.2m"`,
   `"3,600 x 4,200"`, `parseRoomDimensions` yields a pair whose product matches
   `parseDimensionText` within 0.01.
7. `domain-enrich.test.ts` covers, with an injected `fetchImpl` and zero network: no key → EMPTY;
   empty suggest array → EMPTY; HTTP 429 on either call → EMPTY, no throw; transport rejection →
   EMPTY, no throw; a full happy path asserting every mapped field; a record with no
   `internalArea` leaves `floor_area_m2` unset; `FloorPlan` photos filtered into
   `floor_plan_urls` with `has_floor_plan: true`; no `FloorPlan` photos → `has_floor_plan: false`.
8. `applyEnrichment` tests prove Domain never overwrites a PropRadar `floor_area_m2`, never
   overwrites a non-null base `bedrooms`, and never applies floor area when `targeted` is true.
9. `/review` confirms every task item; `/code-review` reports no blocker or major findings.

## Examples

<example>
Worked example — encode verbatim in `rooms.test.ts`.

Rooms (all `source: 'plan'`, `confidence: 'high'`):
- `bedroom-1`  Bedroom  4.0 × 3.0 → area 12.0, perimeter 14.0, included
- `living-2`   Living   6.0 × 4.0 → area 24.0, perimeter 20.0, included
- `garage-3`   Garage   6.0 × 6.0 → area 36.0, perimeter 24.0, **excluded by default**

`measureFromRooms(rooms, { ceilingHeightM: 2.4 })`:
- floor_area_m2 = 12 + 24 = **36.0**
- Σ perimeter    = 14 + 20 = 34.0
- wall_area_m2  = 34.0 × 2.4 × (1 − 0.12) = 81.6 × 0.88 = **71.8**
- ceiling_area_m2 = **36.0**
- trim_lm       = 34.0 × 0.90 + 2 × 5.0 = 30.6 + 10.0 = **40.6**
- rooms_used = 2, rooms_without_dimensions = 0, all_dimensioned = true
</example>

<example>
Per-room fallback when a room has an area but no printed dimensions:
`{ width_m: null, length_m: null, floor_area_m2: 16.0 }` →
perimeter = `K_SHAPE_INTERIOR(1.08) × 4 × √16` = 1.08 × 4 × 4 = **17.28**.
That room sets `all_dimensioned: false`, so the measurement's confidence is `'medium'` (band
0.25), not `'high'`.
</example>

<example>
Engine posture and test style to imitate: `lib/painting/area.ts` + `lib/painting/area.test.ts`
(pure module, exported constants, `roundTo`, `__test_only__` for asserting internals instead of
duplicating magic numbers; `describe` per function, factory fixtures with an `overrides` spread).
`lib/painting/takeoff.test.ts` shows the module-level-fixture variant — either is acceptable.
</example>

<example>
Enricher shape to imitate, exactly: `lib/painting/providers/propradar.ts` — header comment
recording how/when the live API was confirmed, `FetchLike` injection, env read inside the
function body, the shared `EMPTY` sentinel, the internal `getJson` that swallows every non-2xx
and every transport error, and file-scope `num()`/`str()` coercers.
</example>

<example>
Domain suggest response shape (verified live 2026-08-13, address
"670 London Road, Chandler QLD 4155"):
`[{ "address": "670 London Road, Chandler QLD 4155", "id": "RS-9254-SA", "relativeScore": 100,
   "addressComponents": {…} }, { "id": "RR-3689-ZP", "relativeScore": 24, … }]`
Detail response (`RS-9254-SA`), fields this spec maps:
`{ "bedrooms": 9, "bathrooms": 4, "carSpaces": 7, "storeys": 2, "yearBuilt": 1890,
   "propertyType": "House", "areaSize": 10120, "internalArea": 363,
   "photos": [{ "imageType": "Property", "fullUrl": "https://bucket-api.domain.com.au/…" },
              { "imageType": "FloorPlan", "fullUrl": "https://bucket-api.domain.com.au/…" }] }`
→ patch `{ bedrooms: 9, bathrooms: 4, car_spaces: 7, storeys: 2, year_built: 1890,
   property_type: 'House', land_size_m2: 10120, floor_area_m2: 363,
   floor_area_source: 'listing', has_floor_plan: true, floor_plan_urls: [<1 url>] }`.
Use these literals as the happy-path fixture.
</example>
