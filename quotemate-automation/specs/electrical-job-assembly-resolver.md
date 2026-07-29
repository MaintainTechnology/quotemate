# Phase 1 — every electrical job type resolves to exactly one assembly

## Goal

Each of the ten electrical `job_type` values resolves deterministically to the single correct
`shared_assemblies` row, so the parts recipe that already exists in the database can be found at
quote time. Today only two of ten resolve at all, which is why seven seeded recipes are
unreachable.

## Role

Principal engineer. This resolver feeds a bill of materials and a labour figure, so it must be
deterministic and offline — no network ranker on this path. A wrong row here produces a
confidently wrong quote, which is worse than the current no-recipe fallback.

## Context

All paths relative to `quotemate-automation/`. Every claim verified by reading the file.

**The failing code, duplicated at two sites.** `lib/estimate/run.ts:1617-1625` (`buildBomHint`,
always on) and `:1880-1897` (`loadDeterministicInputs`, behind `DETERMINISTIC_BOM`) both do:

```
const term = jobType.replace(/_/g, ' ')
let aq = supabase.from('shared_assemblies').select('id, name, trade').ilike('name', `%${term}%`)
if (trade) aq = aq.eq('trade', trade)
const { data: asm, error: aerr } = await aq.limit(5)
```

Site 2's own comment says `// Match the job the same way buildBomHint does`, which is the
coupling a shared function removes.

**Only two of ten electrical job types resolve today.** The enum
(`lib/intake/schema.ts:10-36`) is `downlights`, `power_points`, `ceiling_fans`, `smoke_alarms`,
`outdoor_lighting`, `switchboard`, `oven_cooktop`, `ev_charger`, `fault_finding`, `renovation`,
plus `other`. No seeded assembly name contains the substrings `downlights`, `power points`,
`ceiling fans`, `smoke alarms`, `outdoor lighting`, `oven cooktop`, `switchboard`, `renovation`
or `other`. Only `ev_charger` → `Install EV charger` and `fault_finding` → `Diagnostic call-out
(fault finding)` match.

**The existing filter builder, and why swapping it in alone makes things worse.**
`lib/estimate/assembly-search.ts:95-99` `buildAssemblyOrFilter(query: string): string` returns a
raw PostgREST `.or()` argument, `name.ilike.%term%,name.ilike.%term%,...`, expanded from the full
phrase, bidirectional synonym classes and every token of length ≥ 3. It is already used at
`lib/estimate/tools.ts:203-210` and `:222-231`.

After that swap a job type matches **many** rows: `power_points` → 5, `ceiling_fans` → 5,
`oven_cooktop` → 4, `outdoor_lighting` → 4 including a GPO row. Three consequences the spec must
close in the same change:

1. **Nothing in the repo can rank them.** `assembly-search.ts` exports only
   `expandAssemblyQuery` and `buildAssemblyOrFilter`; there is no scorer. The one ranker that
   exists, `rerankRows` at `lib/estimate/tools.ts:44-64`, is a network cross-encoder that returns
   rows unchanged below three candidates and silently falls back to raw SQL order on any failure
   — unusable on a deterministic money path.
2. **`.limit(5)` becomes a truncation bug.** With an OR filter and no `ORDER BY`, Postgres may
   return any five of the matched rows, so the correct row can be cut before JS sees it.
3. **The BOM queries fan out over every match.** Both sites do `const ids = asm.map(a => a.id)`
   then `.in('assembly_id', ids)` — at `:1633-1648` and `:1905-1922`. Widening the filter without
   narrowing this would concatenate recipe lines from several unrelated assemblies into one BOM:
   `ceiling_fans` would build a quote mixing exhaust-fan, AC-fan and DC-fan-with-wall-control
   parts, with labour hours taken from whichever row happened to land first.

**An exact narrowing already exists and `run.ts` already imports it.** `run.ts:29` imports
`categoryForJobType` from `lib/sms/product-options.ts:434-452`, which maps `job_type` →
`shared_assemblies.category`. It covers five electrical job types: `downlights` → `downlight`,
`power_points` → `gpo`, `ceiling_fans` → `fan`, `smoke_alarms` → `smoke_alarm`,
`outdoor_lighting` → `outdoor_light`. The `category` column came from migration 029 and was
populated for electrical by 036 and 037.

**CORRECTED 2026-07-28 — the NULL-category claim in the first draft of this spec was false.**
All four migration-069 rows set `category` inline at insert time. There are **zero NULL
categories** across all 26 seeded electrical assemblies. No NULL handling is needed.

**CORRECTED — a name/category heuristic cannot resolve these job types, so do not build one.**
Verified against every seeded row:

- `downlights` matches both `Install LED downlight` (no BOM) and
  `Install LED downlight (new install, single-storey)` (has the BOM). A "prefer the row without a
  parenthetical" rule — which the first draft of this spec specified — picks the row with **no
  recipe**, defeating the entire phase at its headline job type.
- `power_points` matches five `gpo` rows, two of which have BOMs (`Replace double GPO`,
  `Install 20A dedicated GPO`) with identical token overlap. Nothing in the data distinguishes them.
- `oven_cooktop` is four-way ambiguous; `ceiling_fans` three-way.
- The asymmetry runs both directions: for `smoke_alarms` the BASE row has the BOM and the
  parenthetical variant does not — the opposite of `downlights`.
- Only 5 of the 10 electrical job types have a `categoryForJobType` mapping at all
  (`switchboard`, `oven_cooktop`, `ev_charger`, `fault_finding`, `renovation` all return null).
- `fault_finding`'s category is `fault_find`, not `fault_finding`.

**Therefore: resolution must be an explicit, auditable job_type → assembly-name map**, not an
inferred score. The data does not encode "this row is the default for this job type", and guessing
it produces a confidently wrong recipe — worse than today's no-recipe fallback. The map is the
smallest change that is deterministic and reviewable, and a wrong entry is a one-line fix rather
than a heuristic re-tune.

`switchboard` and `renovation` have no assembly at all and must resolve to null (inspection route).

## Task

1. Add a pure exported resolver to `lib/estimate/assembly-search.ts`:
   `JOB_TYPE_ASSEMBLY: Record<string, string>` — an explicit electrical job_type → exact
   assembly-name map — plus `pickBestAssembly(jobType, rows): row | null` which selects the mapped
   name from the candidate rows. Entries chosen so the resolution reaches a seeded recipe wherever
   one exists:

   | job_type | assembly | why |
   |---|---|---|
   | `downlights` | `Install LED downlight (new install, single-storey)` | the only downlight row with a BOM |
   | `power_points` | `Replace double GPO` | easy-5 default; holds the 074 price_recipe and the 084 BOM |
   | `ceiling_fans` | `Supply + install AC ceiling fan` | has a BOM; tradie-supplied is the default |
   | `smoke_alarms` | `Hardwire 240V smoke alarm` | base row holds the BOM here |
   | `outdoor_lighting` | `Install outdoor IP-rated LED light` | existing-circuit default, has the BOM |
   | `oven_cooktop` | `Install oven (existing wiring)` | one of the two rows with a BOM |
   | `ev_charger` | `Install EV charger` | sole `ev_charger` row (no BOM yet — Phase 2) |
   | `fault_finding` | `Diagnostic call-out (fault finding)` | sole `fault_find` row |
   | `switchboard`, `renovation`, `other` | *(unmapped)* | no assembly exists; inspection route |

   Unmapped job types return null. `pickBestAssembly` must be pure and must not depend on row
   order. Keep `buildAssemblyOrFilter` for the candidate fetch so a renamed row still surfaces.
2. Add one shared DB-touching resolver used by both call sites, e.g.
   `resolveJobAssembly(supabase, jobType, trade)`, returning the chosen row or null. It must:
   filter with `buildAssemblyOrFilter(jobType.replace(/_/g,' '))`, scope by `trade`, fetch with a
   `FETCH_LIMIT`-style constant of 12 mirroring `lib/estimate/tools.ts:41`, then rank in JS with
   `pickBestAssembly`.
3. Replace both `run.ts` sites with a call to that resolver. Delete the duplicated `term` /
   `ilike` / `limit(5)` blocks and the now-stale comment at `:1880`.
4. Narrow the BOM and recipe reads from `.in('assembly_id', ids)` to
   `.eq('assembly_id', chosen.id)` at all four query sites (`:1633-1648`, `:1905-1922`).
5. Replace the silent failure paths with observable ones: `buildBomHint`'s bare `return null`
   (`:1624`) and `loadDeterministicInputs`'s `return { input: null, reason: 'no matching assembly' }`
   (`:1889-1891`) each get a `log.warn` naming the unresolved `job_type`, and the intake gains a
   risk flag so a miss is visible on the quote rather than invisible in the pipeline.

## Constraints

- The resolver must be offline and deterministic. Do not call `rerankRows`, an embedding model or
  any network service from it.
- Do not change `buildAssemblyOrFilter` or `expandAssemblyQuery` — they are live on the
  `lookup_assembly` tool path and covered by `lib/estimate/assembly-search.test.ts`.
- Do not seed, edit or delete any `shared_assembly_bom` row in this change. Recipe data is Phase 2.
- Do not enable `DETERMINISTIC_BOM`. Site 2 stays dormant; this change only makes it correct for
  when it is switched on later.
- `switchboard`, `renovation` and `other` have no assembly and are inspection-only by design. The
  resolver returns null for them and that is a pass, not a failure.

## Acceptance criteria & gates

Gate commands, confirmed from `package.json` (note there is no `npm run check` in this repo):

```
npm test          # vitest run --testTimeout=20000
npm run typecheck # tsc --noEmit
npm run lint      # eslint
```

Required tests. `vitest` runs with `globals: false`, so import `describe`, `it`, `expect`
explicitly. Co-locate beside the module, per the 486-file convention in `lib/`.

- **The headline gate, pure, no mocks** — in the style of
  `lib/estimate/assembly-search.test.ts`: a fixture of the 26 seeded electrical assembly names
  with their categories, then for each of the ten electrical `job_type` values assert
  `pickBestAssembly` returns the one expected name, and null for `switchboard`, `renovation` and
  `other`. This test fails today and is what proves the phase.
- A test that a NULL-category "new install" variant still resolves rather than being dropped.
- A test that ranking is independent of input row order — shuffle the fixture and assert the same
  winner.
- A mocked-supabase test, following `lib/customers/lookup.test.ts:11-27`, asserting the BOM query
  receives `.eq('assembly_id', <chosen>)` and never `.in(...)` with more than one id.
- A test that an unresolved job type produces a warn and a risk flag rather than a silent null.

Completion bar: the three gates pass, every electrical `job_type` resolves as specified,
`/verify` confirms a real electrical draft now logs a found recipe for `downlights` where it
previously logged nothing, and `/review` plus `/code-review` report no blocker or major findings.

## Examples

<example>
The pure test shape and the file that already owns this bug class —
`lib/estimate/assembly-search.test.ts:1-12,50-61`. It imports `{ describe, it, expect }` from
vitest, imports the module relatively, asserts on the emitted filter string, and names the
regression in the test title (`'THE BUG FIX: a "power point" query expands to include "gpo"'`).
Add the resolver cases to this file or a sibling; do not create a new directory.
</example>

<example>
The chainable Supabase mock for the narrowing assertion — `lib/customers/lookup.test.ts:11-27`
intercepts `@supabase/supabase-js` with a hand-rolled builder over a module-scope `state` object
and asserts which calls the sink received. That is exactly the shape needed to prove
`.eq('assembly_id', ...)` replaced `.in('assembly_id', ids)`.
</example>

<example>
If a helper must be imported from `lib/estimate/run.ts` itself, copy the env-stub pattern at
`lib/estimate/run-phase1.test.ts:29-37` — `vi.hoisted()` sets the two Supabase env vars before
the hoisted imports so the module's top-level `createClient` can be constructed without a live
instance. No network call is made. Prefer putting the pure logic in `assembly-search.ts` so this
is unnecessary.
</example>

<example>
The safety envelope to preserve — `lib/estimate/deterministic-bom.ts:150-157` returns
`{ tiers: null, reason }` rather than shipping a hole, and `lib/estimate/run.ts:388-394` catches
any throw and falls back to the Opus draft. A resolver that returns null must keep both
properties: no throw into the request, and no partially-built recipe.
</example>
