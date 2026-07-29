# Phase 2 — a recipe line can only name a part that exists, and quantities follow the job

## Goal

A tradie cannot save a recipe line that is unpriceable, and a recipe quantity scales with the
number of items the customer asked for. Today 23 of the 27 options in the Recipes category
dropdown match no product at all, and the downlight recipe is hardcoded to 6 regardless of the
count on the intake.

## Role

Principal engineer. This phase decides which parts appear on a priced quote, so a wrong value
here is a wrong invoice. Two of the defects are silent by design — nothing errors, the line just
becomes unpriceable — so every fix needs a test that fails today.

## Context

All paths relative to `quotemate-automation/`. Every claim verified against the source.

**The dropdown is wired to the wrong vocabulary.** `app/dashboard/page.tsx:12645-12659` feeds the
Recipes "Material category" select from `CATEGORIES` (`lib/estimate/categories.ts:24-55`, imported
at `page.tsx:29`). That array is the coarse **grounding** vocabulary. `shared_assembly_bom.material_category`
must instead equal a `shared_materials.category` string exactly — migration 130's column comment
says so: *"MUST equal a shared_materials.category string (exact trim+lowercase match by
chooseMaterial())"*.

`categories.ts:1-14` names its three intended consumers — `validate.ts categorise()`,
`CustomServiceSchema.category`, and the dashboard "Category" select. The Recipes BOM editor is
**not** one of them.

**The real electrical material vocabulary is seven values:** `ceiling_fan`, `downlight`, `gpo`,
`outdoor_light`, `safety_switch`, `smoke_alarm`, `sundries`.

**Only 4 of the 27 dropdown options resolve** — `downlight`, `gpo`, `smoke_alarm`,
`outdoor_light`. The other 23 are unpriceable, and three are near-miss synonyms a tradie would
reasonably trust:

| Tradie picks | Real value | Result |
|---|---|---|
| `fan` | `ceiling_fan` | unpriceable |
| `rcbo` | `safety_switch` | unpriceable |
| `sundry` | `sundries` | unpriceable — the exact singular/plural bug migration 130 fixed in the DB while leaving the dropdown offering it |

**The dropdown is not trade-scoped.** `page.tsx:12234-12236` narrows the *job* picker by trade;
the category select still offers all 12 plumbing options on the electrical hub.

**Second-order: the Catalogue product select uses the same array** (`page.tsx:11674-11688`), so a
tradie's own product also gets stamped `fan`/`rcbo`/`sundry`. Two wrong vocabularies can
accidentally agree with each other — the tenant-catalogue leg of `chooseMaterial` resolves while
the shared fallback never can — which is why this has gone unnoticed.

**Nothing prevents a bad value.** `TenantBomLineSchema` accepts
`material_category: z.string().trim().min(1).max(40)`. There is no CHECK, FK or enum on either BOM
table's `material_category`; migration 130 declined one deliberately. `scripts/import-bom-catalogue.mjs`
validates `trade` and `assembly_name` but performs zero vocabulary validation.

**The quantity gap, and why the obvious fix does nothing.** Migration 118 seeds the downlight
recipe as literally `6`, and `buildBomQuoteLines` (`lib/estimate/catalogue.ts:290-333`) uses
`num(b.quantity)` verbatim at `:297`. `loadDeterministicInputs` receives the whole `intake` but
never reads `intake.scope.item_count`.

⚠ `DETERMINISTIC_BOM` defaults **off**, so `buildBomQuoteLines` does not run in production. The
hardcoded 6 reaches real quotes only through the always-on soft hint `formatBomHint`
(`catalogue.ts:458`). **A fix confined to `buildBomQuoteLines` would change nothing in prod** —
the hint path must scale too, or this phase is invisible.

## Task

- **R1** Add a material-vocabulary source of truth. Create an exported list of the real
  `shared_materials.category` values per trade (electrical's seven above) — separate from
  `CATEGORIES`, which stays untouched for its three legitimate consumers.
- **R2** Feed **both** category selects from R1, scoped to the hub's trade — the Recipes one
  (`page.tsx:12645`) **and** the Catalogue product one (`page.tsx:11674`). Fixing only Recipes is a
  regression; see the audit below.
- **R3** Reject an unmatched `material_category` at write time. Tighten `TenantBomLineSchema` to
  the R1 vocabulary and add the same validation to `scripts/import-bom-catalogue.mjs`. A DB CHECK
  is optional; the Zod + script gate is the requirement.
- **R4** Scale recipe quantities by `intake.scope.item_count`. Thread the count into
  `buildBomQuoteLines` (`catalogue.ts:297`) **and** into `formatBomHint` (`catalogue.ts:458`), since
  only the latter reaches production today. A BOM row is a per-job quantity unless the phase adds
  an explicit per-item marker — decide and document which, and default to the behaviour that makes
  `downlight ×6` become `×10` when the customer asks for 10.
- **R5** Seed the one genuinely missing recipe: `ev_charger` (`Install EV charger` resolves but has
  no BOM rows). Use `scripts/import-bom-catalogue.mjs`, dry-run first.
- **R6** Replace the two consumables-only recipes with real parts:
  `Install oven (existing wiring)` and `Install cooktop (existing wiring)` currently carry only
  `sundries ×1`.
- **R7** Fix the misleading helper text under both selects. The Recipes one says *"Pick the same
  category you use in Catalogue"*, which is the instruction that created the problem.

## Production audit, 2026-07-28 — this is not hypothetical

Read-only counts against the live database:

**`tenant_assembly_bom`, electrical — 5 rows, 3 of them already unpriceable:**
`downlight` ✓, `gpo` ✓, `oven_cooktop` ✗, `rcbo` ✗, `security_camera` ✗

**`tenant_material_catalogue`, electrical — 24 rows, 6 mis-categorised:**
`gpo` ×7 ✓, `downlight` ×5 ✓, `smoke_alarm` ×3 ✓, `outdoor_light` ×3 ✓, **`fan` ×3 ✗**,
**`rcbo` ×3 ✗**

⚠ **THE TRAP: fixing only the Recipes select is a regression.** Both selects currently offer `fan`,
so a recipe line saying `fan` and a product stamped `fan` *agree* — the tenant-catalogue leg of
`chooseMaterial` resolves and those three fans price correctly today, by accident. Change Recipes
alone to offer `ceiling_fan` and the line stops matching the product. Six working products would
break. Hence R2 covers both selects.

- **R8** Provide a data-fix script for the existing rows, dry-run by default with `--apply`,
  mapping `fan` → `ceiling_fan` and `rcbo` → `safety_switch` across both
  `tenant_material_catalogue.category` and `tenant_assembly_bom.material_category`. Report
  `oven_cooktop` and `security_camera` as unmappable — no `shared_materials` row exists for them —
  rather than guessing. Do not run it silently as part of the build.

## Constraints

- Do **not** change `CATEGORIES` or `lib/estimate/categories.ts`. It is the grounding vocabulary
  and is consumed by `validate.ts`, which gates every quote. Adding a second, separate list is the
  smaller and safer change.
- Do **not** normalise `sundry` ↔ `sundries` in either direction. Migration 130 documents the
  two-vocabulary boundary as intentional: `shared_assemblies.category` uses `sundry`,
  `shared_materials.category` uses `sundries`.
- Do not enable `DETERMINISTIC_BOM`.
- Do not migrate existing bad `tenant_assembly_bom` rows silently. Report them; a data fix is a
  separate, reviewable step.

## Acceptance criteria & gates

```
npm test          # vitest run --testTimeout=20000
npm run typecheck # tsc --noEmit
npm run lint      # eslint
```

- A pure test asserting every value in the R1 electrical vocabulary matches a real
  `shared_materials.category`, and that `fan`, `rcbo`, `sundry`, `switchboard` and every plumbing
  value are **absent** from the electrical list. Fails today.
- A test that `TenantBomLineSchema` rejects `material_category: 'fan'` and accepts `'ceiling_fan'`.
- A test that a recipe of `downlight ×6` with `item_count: 10` produces 10, and that the same input
  produces an identical result twice.
- A test that the **hint** path scales too — the same `item_count` change is reflected in
  `formatBomHint` output, since that is the only path live in production.
- A `LIVE_DB`-gated test (mirroring `lib/estimate/live-job-assembly-resolve.test.ts`) asserting
  every `material_category` present in `shared_assembly_bom` for electrical matches a real
  `shared_materials.category`, so seeded data and vocabulary cannot drift apart.

Completion bar: the three gates pass, the live vocabulary test is clean, and `/review` plus
`/code-review` report no blocker or major findings.

## Examples

<example>
The write-time rejection to imitate — `lib/tenant/update-schema.ts` `TenantBomLineSchema` already
bounds `quantity` with `z.coerce.number().positive().max(10_000)` and `sort` with
`.int().min(0).max(999)`. Add the category constraint in the same place and the same style, rather
than validating in the route.
</example>

<example>
The live-data guard to imitate — `lib/estimate/live-job-assembly-resolve.test.ts` is
`describe.skipIf(!process.env.LIVE_DB)`, connects with `pg` via `SUPABASE_DB_URL`, runs read-only
selects and documents its own run command in the header. The vocabulary drift test is the same
shape with a different query.
</example>

<example>
The importer to extend for R3/R5 — `scripts/import-bom-catalogue.mjs` is dry-run by default,
`--apply` to write, and idempotent via `on conflict ... do nothing`. It already validates `trade`
and `assembly_name`; add `material_category` to that existing validation block rather than a new
pass.
</example>
