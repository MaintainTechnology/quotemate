# Electrical Recipe Engine — deterministic parts and tasks per job type

## Goal

The same electrical job with the same customer product choice produces a byte-identical
quote every time, with the parts and tasks derived from a stored recipe rather than invented
by an LLM. Today 227 of 231 production quotes were written by Opus choosing its own line
items, which is why the same job yields mismatched parts on different days.

## Role

Principal engineer for this repo. The money path is the blast radius: every change here can
alter a figure a customer is charged. Reason before acting, open the file before describing
it, and never enable a flag whose downstream coupling has not been traced.

## Context

All paths relative to `quotemate-automation/`. Every claim below was verified by reading the
file, not inferred.

**The engine already exists and is dormant.** `lib/estimate/deterministic-bom.ts`
`buildDeterministicTiers()` rebuilds good/better/best from recipe × catalogue by arithmetic,
is pure and unit-tested, fails closed on an unpriceable required part, and is already wired
into `lib/estimate/run.ts:353-394`. It is gated on `process.env.DETERMINISTIC_BOM === '1'`,
which has never been set. Production `quotes.pricing_path`: 227 `opus_fallback`,
4 `inspection`, **0 `deterministic`**.

**The load-bearing defect is a name match.** `lib/estimate/run.ts:1620-1624` does
`const term = jobType.replace(/_/g, ' ')` then `.ilike('name', '%' + term + '%')`. The intake
enum writes plural (`downlights`, `power_points`, `ceiling_fans`, `smoke_alarms` —
`lib/intake/schema.ts:10-36`); every seeded assembly name is singular
(`Install LED downlight (new install, single-storey)`). It returns `null` with no log and no
risk flag. The identical bug is duplicated in the deterministic loader at
`lib/estimate/run.ts:1882-1888`, so enabling the flag would not fix it. **The fix already
exists**: `lib/estimate/assembly-search.ts` `buildAssemblyOrFilter()` was written for this
exact bug class and documents it in its header; it is called only from `lib/estimate/tools.ts:206`
and `:225`, never from either `run.ts` site.

**Recipe data is ~60% seeded and ~0% reachable.** 26 electrical `shared_assemblies` rows
exist; 10 carry `shared_assembly_bom` lines (7 with genuine parts, 2 consumables-only).
Of 11 electrical job types, only `fault_finding` currently resolves an assembly *and* finds a
BOM. Migration 118 already covered `outdoor_lighting`, `oven_cooktop` and `fault_finding`
beyond the four named jobs.

**The grounding validator has no job-type dimension.** `lib/estimate/validate.ts:713`
`validateQuoteGrounding(draft, pricingBook, candidates)` — no intake, no `job_type`, no BOM.
It proves each `unit_price_ex_gst` traces to a real row and that a line's description category
matches its *source row's* category. It cannot detect a missing driver or a real-but-irrelevant
part.

**The SMS receptionist has no reply guard.** `assertGroundedReply` has exactly one production
call site, `lib/sms/llm-receptionist.ts:947`, inside `runTurn`, reached only via
`roofingTurnViaLlm` and `paintingTurnViaLlm`. `app/api/sms/inbound/route.ts:43-51` imports five
symbols from that module and `assertGroundedReply` is not one of them, so it is structurally
unreachable from the electrical branch. Worse, `lib/sms/dialog.ts:188` instructs the model
`- $ + plain number for AUD` and `:657` says `Reply with its link (and figure if asked).` The
model is never passed the tenant catalogue, so any brand it names is invented by construction.
Only three cosmetic scrubs run post-model (`lib/sms/dialog.ts:1929-1945`); none inspects a number.

**The category vocabulary is data, not a constant, and the UI offers the wrong one.**
`chooseMaterial()` matches `r.category?.trim().toLowerCase() === cat`. The authoritative
electrical set in `shared_materials.category` is exactly seven values: `ceiling_fan`,
`downlight`, `gpo`, `outdoor_light`, `safety_switch`, `smoke_alarm`, `sundries` (documented in
the header of `sql/migrations/118_shared_assembly_bom_seed.sql`, verified against prod
2026-06-18). The Recipes dropdown is fed from `lib/estimate/categories.ts` `CATEGORIES`, which
is the coarse **grounding** vocabulary — 11 of the 15 electrical options a tradie can pick match
no product at all. There is no enum, no `isCategory()` call and no DB CHECK on the write path;
migration 130 deliberately declined a constraint.

**Roofing carries 12 pricer backstops; the electrical builder has 3.** Missing: monotonic tier
ordering (roofing has three layers including a throwing tripwire at `lib/roofing/pricing.ts:406-417`),
a call-out dollar floor (`lib/roofing/pricing.ts:545-556`), read-time re-validation of tenant
overrides (`lib/roofing/rate-card-overlay.ts:333-340`), and drop-not-clamp semantics for a bad
tenant value (`lib/roofing/rate-card-overlay.ts:17-23`). Also `lib/estimate/catalogue.ts:191-198`
— the shared-material fallback ignores the tier argument entirely, so any category without a
tier ladder returns the same product for good, better and best.

**Auto-send is hard-coupled to the flag.** `lib/routing/decide.ts:106`
`if (input.pricingPath !== 'deterministic') reasons.push('pricing_path_not_deterministic')`.
Enabling `DETERMINISTIC_BOM` therefore flips electrical from *never auto-sends* to
*always auto-sends* in one deploy.

**Tenant recipe data is junk.** `tenant_assembly_bom` holds 6 rows across 3 tenants; one maps
'Diagnostic call-out (fault finding)' to `downlight` ×6. Enabling the engine before cleaning
these would deterministically quote 6 downlights for a fault-finding call-out.

**Product attributes exist but are unwritable.** `properties jsonb` is on `shared_materials`
(mig 007), `tenant_material_catalogue` (mig 028) and `supplier_catalogue` (mig 041), and is
indexed (mig 082). `lib/tenant/update-schema.ts` has no `properties` field, so no tradie-facing
path can ever set one.

**Tooling that already exists.** `scripts/import-bom-catalogue.mjs` loads
`shared_assembly_bom` from a JSON array, dry-run by default, `--apply` to write, idempotent via
`on conflict do nothing`. The admin CSV loader (`lib/admin-loader/*`) writes
`shared_assemblies`, `shared_materials`, `categories` and the trades registry — **not**
`shared_assembly_bom`. `scripts/run-migration-118.mjs` is the only runner with backup + verify +
rollback, but it whitelists `sundry` as an allowed orphan category — do not copy that line.
Migration 118's header documents an `--apply` flag that does not exist; the runner writes
immediately.

## Task

Ordered by dependency. Each stage must pass its gates before the next begins.

### Stage 1 — make recipes reachable

1. **Phase 0.** Delete the 6 junk `tenant_assembly_bom` rows via a new migration + runner.
   Correct the two stale module headers in `lib/estimate/spec-registry.ts:12-13` and
   `lib/estimate/spec-reconcile.ts:13-14` that claim "NOT wired into the live pipeline" when
   both are reached from `run.ts`.
2. **Phase 1.** Route both `lib/estimate/run.ts:1620` (`buildBomHint`) and `:1882`
   (`loadDeterministicInputs`) through `buildAssemblyOrFilter()` from
   `lib/estimate/assembly-search.ts`. Replace each silent `return null` / `return {input:null}`
   with a `log.warn` naming the unresolved `job_type`, and add a risk flag on the intake so a
   miss is observable.

### Stage 2 — make the customer's choice bind

3. **Phase 2.** Fix the Recipes category dropdown to be fed by the **material** vocabulary
   (the seven values above), not `lib/estimate/categories.ts` `CATEGORIES`. Add a DB CHECK or
   FK so an unmatched `material_category` is rejected on write to both `shared_assembly_bom`
   and `tenant_assembly_bom`. Then seed the remaining genuine parts recipes with
   `scripts/import-bom-catalogue.mjs`, replacing consumables-only rows for
   `oven_cooktop` and `fault_finding`, and adding `ev_charger`.
4. **Phase 2b.** Add `properties` to `MaterialCatalogueSchema` in `lib/tenant/update-schema.ts`
   and to the Catalogue section UI, so a tradie can tag a product `smart`, `dimmable`,
   `integrated_driver`.
5. **Phase 3.** New tables `shared_assembly_tasks` and `tenant_assembly_tasks`, mirroring the
   BOM pair exactly (`assembly_id`, `trade`, `seq`, `description`, `required`). **No hours per
   task** — `shared_assemblies.default_labour_hours` stays the single source of labour. Surface
   an editable list beside parts in the Recipes section.
6. **Phase 4A.** Pass `chosenProduct` and `tierLadder` into `DeterministicTierInput` at
   `lib/estimate/run.ts:1977-1984` (both are already honoured by the builder and simply omitted
   by the loader). Remove the tier collapse at `lib/estimate/run.ts:799-807` so a product pick
   keeps all three tiers. In `lib/sms/product-options.ts` `selectProductOptions`, make the
   tenant's `is_preferred` product always one of the two offered.
7. **Phase 4B.** Add nullable `include_when jsonb` to the BOM and task rows, evaluated against
   the chosen product's `properties`, plus nullable `quantity_per` for ratios (one driver per
   four lights). Null means always include. Evaluate inside the pure builder, not in the loader.
8. **Phase 4C.** Add nullable `catalogue_id` to `tenant_assembly_bom` referencing
   `tenant_material_catalogue`, so a tradie pins a specific product as a recipe line's default.
   `chooseMaterial` honours it above brand inference.

### Stage 3 — make it safe

9. **Phase 5.** Give `validateQuoteGrounding` the intake and the resolved BOM. Assert every
   `required` category is present and no line falls outside the recipe plus an explicit extras
   allowance. Default to shadow mode (log only), matching `lib/estimate/spec-guard.ts:43-49`.
10. **Phase 5b.** Port the four missing roofing backstops: monotonic tier assertion, call-out
    dollar floor from `pricing_book.call_out_minimum`, read-time bounds re-validation of tenant
    values, and drop-not-clamp on an out-of-range value. Make `roundTo` non-finite-safe. Fix
    `lib/estimate/catalogue.ts:191-198` so the shared-material fallback honours the tier
    argument instead of returning one row for all three.
11. **GATE.** Decouple auto-send from the recipe switch in `lib/routing/decide.ts:106` so
    enabling `DETERMINISTIC_BOM` does not simultaneously enable auto-send.

### Stage 4 — turn it on

12. **Phase 6.** Make `DETERMINISTIC_BOM` resolvable per tenant rather than one global env flag.
13. **Phase 7.** Allow `tenant_assembly_bom` to reference a `tenant_custom_assemblies` row
    (nullable `custom_assembly_id` + a CHECK that exactly one of the two parents is set). Change
    `app/api/tenant/estimation/route.ts:53` from an inner join on the BOM table to a left join so
    a job with no recipe is still visible in the Estimating section.

## Constraints

- **Do not enable `DETERMINISTIC_BOM` until Stage 3 is complete**, and never before Phase 0 has
  removed the junk tenant rows.
- Do not set `temperature` on any Opus 4.7/4.8 call — the parameter was removed and returns a
  400. See the existing guard `lib/aircon/plan-extract.ts:35-38`.
- Do not rebuild `buildDeterministicTiers` or its fail-closed envelope; extend it.
- Do not add hours to the task tables in this change (settled decision).
- Every new migration needs a matching `NNN_down.sql` and a `scripts/run-migration-NNN.mjs`;
  keep `sql/init.sql` representative. Do not copy the `sundry` orphan exemption from
  `run-migration-118.mjs`.
- Prices stay ex-GST in storage, inc-GST in display. Australian English throughout.
- Do not widen where the customer product picker appears (SMS-only, mapped job types only) —
  that is an open product decision, out of scope here.

## Acceptance criteria & gates

Gate commands, confirmed against `package.json` (note: `npm run check` does not exist in this
repo):

```
npm test          # vitest run --testTimeout=20000
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npm run test:e2e  # playwright test — only when a dashboard surface changed
```

Per-stage acceptance:

- **Stage 1.** A test asserting that every value of the electrical `job_type` enum resolves to
  exactly one `shared_assemblies` row through the shared resolver. A test asserting an
  unresolved job type produces a log and a risk flag rather than a silent null.
- **Stage 2.** A test that the same intake plus the same `chosen_product` produces an identical
  line-item set across two runs. A test that a `smart` product adds its dimmer line and pairing
  task while an `integrated_driver` product drops the separate driver line. A test that a recipe
  line with an unmatched `material_category` is rejected at write time.
- **Stage 3.** A test that Best ≥ Better ≥ Good for every tier build. A test that a total below
  `call_out_minimum` is lifted to the floor. A test that an out-of-range tenant markup is dropped
  to the default rather than coerced to zero. A test that a category with no tier ladder still
  yields three distinct products.
- **Stage 4.** A test that `decideRouting` can return `auto_send` for a non-deterministic pricing
  path once decoupled, and that enabling the recipe engine for one tenant does not change another.

Completion bar: `npm test`, `npm run typecheck` and `npm run lint` pass; `npm run test:e2e`
passes when a dashboard surface changed; `/verify` confirms a real electrical quote end to end
with `quotes.pricing_path = 'deterministic'`; `/review` and `/code-review` report no blocker or
major findings.

## Examples

<example>
The resolver to imitate, not rewrite — `lib/estimate/assembly-search.ts` already handles the
plural/singular and synonym problem, including `gpo` ↔ `power point` and
`downlight` ↔ `down light`. Its header documents the exact bug Phase 1 fixes. Wire it in; do not
write a second matcher.
</example>

<example>
The safety envelope to preserve — `lib/estimate/deterministic-bom.ts:150-157` returns
`{tiers: null, reason}` when a required part cannot be priced, and `lib/estimate/run.ts:388-394`
catches any throw and falls back to the Opus draft. Phases 4B and 5b must keep both properties:
never ship a hole, never throw into the request.
</example>

<example>
The backstop pattern to copy — `lib/roofing/pricing.ts:545-556` applies the call-out floor and
then `const bestEx = Math.max(applyFloor(bestRaw), betterEx)` to guarantee ordering, and
`lib/roofing/rate-card-overlay.ts:17-23` states the drop-not-clamp merge contract that
`:242-244` enforces per field. Mirror both for the electrical builder.
</example>

<example>
The shadow-mode pattern to copy for Phase 5 — `lib/estimate/spec-guard.ts:43-49`
`specGuardMode()` defaults to `'shadow'` and requires an explicit opt-in to enforce. The
completeness check must ship the same way so it can be observed on real traffic before it can
reject a quote.
</example>
