# Phase 3 — every job carries an ordered task checklist the tradie owns

## Goal

A tradie can define the steps of a job alongside its parts, and edit their own copy without
touching the shared baseline. There is no task, step or checklist table anywhere in the schema
today — the "task list" for a job is one free-text `description` and a single labour-hours scalar.

## Role

Principal engineer. This is the one genuinely new build in the plan. It carries no money, so the
risk is schema quality and convention drift rather than mis-pricing — mirror the BOM pair exactly
and it stays boring.

## Context

All paths relative to `quotemate-automation/`. Verified against the source and the live database.

**Everything to mirror already exists and is tight.** The BOM pair is two small tables —
`shared_assembly_bom` (migration 028) and `tenant_assembly_bom` (migration 031) — a four-endpoint
API (`GET`/`POST` on `/api/tenant/bom`, `PATCH`/`DELETE` on `/api/tenant/bom/[id]`,
`POST /api/tenant/bom/fork`) driven by two Zod schemas in `lib/tenant/update-schema.ts`, and a
single self-contained `RecipesTab` at `app/dashboard/page.tsx:12141-12702`.

**Migration 028's header states the design rule to follow verbatim:** tenant-owned data goes in a
physically separate table, never a nullable `tenant_id` on a shared table.

**Next free migration number is 184.** Highest existing SQL is `183_tradie_send_log.sql`, highest
runner is `scripts/run-migration-183.mjs`, and nothing numbered 184 exists in either directory.
Confirmed against the live DB: `shared_assembly_tasks` and `tenant_assembly_tasks` do not exist.

**Do not seed tasks from `shared_assemblies.description`.** All 65 rows have a description, but only
31 of 65 are comma-delimited step lists; the other 34 are prose whose commas are grammatical. A
blind split produces garbage tasks that a tradie then has to delete one by one. If seeding is wanted
it belongs in a separate opt-in script, not this migration.

**Rollback convention:** neither 028 nor 031 has a down migration. Use `184_down.sql` — 24 of the 25
down files in the tree use that form; `183_tradie_send_log_down.sql` is the lone outlier.

**Runner convention for a keystone schema change:** copy `scripts/run-migration-031.mjs` — dry-run
by default, `--apply` to opt in, then a post-apply `information_schema` assertion that the table
exists. Migration 183's runner applies immediately; 031's gate is the safer template for a table
creation.

**Drop the fork endpoint's gap apparatus.** `/api/tenant/bom/fork` reports `category_gaps`,
`has_category_gaps`, `gap_detection_failed` via `mapForkGaps` and `resolveCatalogueBadge` — all of
which exist because a BOM line must join to a product by category. A task has no
`material_category` to join on, so there is nothing to report. Mirror the auth, the id regex, the
trade scope, the `already_customised` 409 head-count guard, the `no_baseline` 404 and the bulk
insert. Drop the rest rather than porting dead code.

## Task

- **R1** Migration `184` creating `shared_assembly_tasks` and `tenant_assembly_tasks`, mirroring the
  BOM pair's DDL. Columns: `assembly_id` (FK cascade to `shared_assemblies`), `trade` with the same
  `check (trade in ('electrical','plumbing'))` as the BOM tables, `title text not null` (the step),
  `notes text` (optional), `required boolean not null default true`, `sort int not null default 0`.
  The tenant table adds `tenant_id` (FK cascade), `updated_at` plus a
  `tenant_assembly_tasks_set_updated_at` trigger; the shared table stays trigger-less with
  `created_at` only, exactly as `shared_assembly_bom` is.
- **R2** Unique indexes: `shared_assembly_tasks` on `(assembly_id, lower(title))`;
  `tenant_assembly_tasks` on `(tenant_id, assembly_id, lower(title))`. A single-column key is
  sufficient because a task has no category dimension.
- **R3** `sql/migrations/184_down.sql` dropping both tables cascade plus the trigger function, and
  `scripts/run-migration-184.mjs` following the 031 dry-run/`--apply` pattern with a post-apply
  existence assertion.
- **R4** `TenantTaskLineSchema` in `lib/tenant/update-schema.ts`, mirroring `TenantBomLineSchema`'s
  bounded style: `title` trimmed and length-capped, `notes` capped, `required` boolean, `sort`
  integer bounded, `trade` the existing `TRADE_ENUM`.
- **R5** `/api/tenant/tasks` with `GET`/`POST`, `/api/tenant/tasks/[id]` with `PATCH`/`DELETE`, and
  `/api/tenant/tasks/fork` — mirroring the BOM routes' auth, guards and status codes, minus the gap
  reporting. `assembly_id` and `trade` stay immutable on PATCH, as they are on the BOM route.
- **R6** A second panel inside `RecipesTab`, slotted between the `{selectedAsm.name} — recipe`
  header (`page.tsx:12445-12449`) and the parts list, reusing the existing `selectedAsm` state, job
  picker and trade filter. Add, edit, reorder and remove tasks; one-click fork of the shared
  baseline.
- **R7** *(added 2026-07-30 — a review gap, not a build gap.)* Both tables enable RLS in migration
  184 itself. R1 said "mirror the BOM pair's DDL" and the BOM pair is RLS-on, but neither 028 nor 031
  enables it in-file — it was turned on later by a bulk migration — so mirroring their DDL literally
  produces RLS-off tables. Every table-creating migration since 144 (144, 150, 152, 158, 172) enables
  it in the same file; follow those, not 028/031. No positive policies: routes use the service-role
  key, and tenant-scoped policies are RLS Phase 2, deferred repo-wide. The runner asserts
  `pg_class.relrowsecurity` after apply, because a missing RLS grant changes nothing observable
  through the service-role key and would otherwise ship unnoticed.

## Scope addendum — the picker narrowing also lands on `/api/tenant/bom`

*(Added 2026-07-30 after browser verification. Recorded here rather than left as undocumented scope
creep.)*

Verification found the Recipes tab opening on **"Ducted system — supply & install (per kW)" (aircon)**
on an 8-trade tenant, with every add-step submit returning 400. Cause: both Recipes `GET`s offered
every job in the *tenant's* trades, while both writers accept only `TRADE_ENUM`
(electrical/plumbing). `lib/tenant/recipe-trades.ts` narrows the picker to trades a recipe can
actually be stored against.

The identical bug already existed on `/api/tenant/bom` — 16 jobs (2 aircon, 14 roofing) with zero
shared baselines, zero existing tenant rows, and a `POST` that rejects them. The guard is applied to
**both** GETs rather than only the new one: the two panels live in the same card, and fixing the
steps picker while leaving the parts picker offering dead jobs would make one card behave two ways.
Nothing functional is hidden — every removed option was unwritable.

## Constraints

- **No hours per task.** Settled decision. `shared_assemblies.default_labour_hours` stays the single
  source of labour. The table shape must not preclude adding hours later, but this phase does not.
- Do not seed from `description` (see Context).
- The estimator does not read these tables in this phase. Tasks carry no price and no hours, so they
  are scope-of-works data. `buildBomHint` and the deterministic builder stay untouched.
- Copy the two-trade `check (trade in ('electrical','plumbing'))` verbatim even though eight trades
  are live — `TRADE_ENUM` is exactly that pair and the whole Recipes surface is electrical plus
  plumbing. Widening it is a separate decision.
- New tab is not permitted; this is a second panel in the existing `RecipesTab`.

## Acceptance criteria & gates

```
npm test          # vitest run --testTimeout=20000
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npm run test:e2e  # playwright — Recipes is a dashboard surface
```

- A migration-shape test reading `sql/migrations/184_*.sql` as text and asserting both
  `create table` statements, both unique indexes, the trade CHECK and the trigger — following the
  `lib/roofing/edge-analysis-migration.test.ts` pattern, so no database is needed.
- A test that `184_down.sql` drops both tables and the trigger function.
- A test that `TenantTaskLineSchema` rejects an empty `title` and an out-of-range `sort`.
- A test that the fork endpoint returns 409 `already_customised` when the tenant already has tasks
  for that assembly, and 404 `no_baseline` when the shared table has none — mirroring the BOM fork's
  contract.
- A test that PATCH cannot change `assembly_id` or `trade`.

Verify the UI panel with the repo's dashboard driver (`quotemate-automation:verify`).

Completion bar: the four gates pass, a tradie can fork and edit a task list end to end, and
`/review` plus `/code-review` report no blocker or major findings.

## Examples

<example>
The DDL to mirror — `sql/migrations/031_tenant_assembly_bom.sql` in full: tenant FK cascade,
`updated_at` with a `set_updated_at` trigger, a tenant-scoped unique index, and a
`(tenant_id, assembly_id)` lookup index. Copy the structure and change only the identity column.
</example>

<example>
The runner to copy — `scripts/run-migration-031.mjs`: dry-run by default, `--apply` opts in,
post-apply `information_schema` assertion. Do **not** copy `run-migration-118.mjs`, whose header
documents an `--apply` flag it does not implement and which whitelists `sundry` as an allowed
orphan category.
</example>

<example>
The API shape to mirror — `app/api/tenant/bom/[id]/route.ts` states the immutability rule in a
comment: *"assembly_id / trade are intentionally NOT editable here — moving a line to a different
job is a delete + re-add."* Carry that rule and that comment style across.
</example>
