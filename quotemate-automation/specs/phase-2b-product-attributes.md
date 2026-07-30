# Phase 2b — a tradie can tag what a product actually is

## Goal

A tradie can mark a catalogue product as smart, dimmable or integrated-driver, and the estimator
can act on it. The column already exists and is indexed, but nothing in the product has ever been
able to write it, so it is empty on every row.

## Role

Principal engineer. Small surface, no migration, and it unblocks Phase 4B — which cannot reshape a
recipe around a product whose attributes are all unset.

## Context

All paths relative to `quotemate-automation/`. Verified against the source.

**No migration needed.** `tenant_material_catalogue.properties jsonb default '{}'::jsonb` was added
by migration 028 and given a GIN index by migration 082. The storage is ready.

**It is invisible to the tradie at four separate points**, and all four must change:

1. `MaterialCatalogueSchema` in `lib/tenant/update-schema.ts` — 15 fields, `properties` absent
2. The POST row-builder in `app/api/tenant/catalogue/route.ts` — no mention
3. The PATCH field-allowlist in the same route — no mention
4. The dashboard `CatalogueRow` type, `blankForm`, and form JSX — no attribute inputs

**Two of the three attributes already have readers.** `applyPropertyFilters`
(`lib/estimate/tools.ts:103-104`) filters on `properties->>smart` and `properties->>dimmable` as
strict-true matches. Using those exact key names makes tagging immediately effective in the
estimator's material lookup — no reader work required.

`integrated_driver` has **no reader anywhere** — not in `applyPropertyFilters`, not in `SPEC_DEFS`.
Tagging it is write-only until Phase 4B consumes it. That is acceptable and expected; 4B is the
consumer.

**Nothing in application code writes `properties` today.** The only writers are
`scripts/backfill-catalogue-properties.mjs` and one hand-written migration, both name-parsing
backfills. This phase creates the first tradie-facing write path.

**Known gap to leave alone:** the supplier `bulk-add` route will still create rows with `{}`.
Backfilling or prompting for attributes on bulk import is out of scope.

## Task

- **R1** Add `properties` to `MaterialCatalogueSchema` as an optional, bounded object. Accept only
  known boolean keys — `smart`, `dimmable`, `integrated_driver` — rather than an open record, so a
  typo cannot silently create a key no filter will ever read.
- **R2** Add `properties` to the POST row-builder and the PATCH field-allowlist in
  `app/api/tenant/catalogue/route.ts`. PATCH must merge rather than replace, so editing one
  attribute does not clear the others.
- **R3** Add the three attributes to the dashboard Catalogue form: `CatalogueRow` type, `blankForm`,
  form state, and one control per attribute. Reuse whatever boolean control the form already uses;
  do not introduce a new pattern.
- **R4** Use the exact key names `smart` and `dimmable` so `applyPropertyFilters` picks them up with
  no reader change.

## Constraints

- No migration. The column and index exist.
- Do not change `applyPropertyFilters`. Matching its existing keys is the point.
- Do not backfill existing rows, and do not touch the supplier bulk-add path.
- Keep `properties` an allowlisted key set, not a free-form record — an open shape here is how
  `material_category` ended up unvalidated in Phase 2.
- Do not add a reader for `integrated_driver` in this phase; that is Phase 4B's job.

## Acceptance criteria & gates

```
npm test          # vitest run --testTimeout=20000
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npm run test:e2e  # playwright — the Catalogue form is a dashboard surface
```

- A test that `MaterialCatalogueSchema` accepts `{ smart: true, dimmable: false }`, and **rejects**
  an unknown key such as `{ smrt: true }`. Fails today because the field does not exist.
- A test that a PATCH setting only `dimmable` leaves an existing `smart: true` intact — the merge,
  not replace, requirement.
- A test that a product tagged `smart: true` is returned by `applyPropertyFilters` with
  `{ smart: true }` and excluded when untagged, proving the key names line up with the existing
  reader.

Because this changes a Clerk-authed dashboard surface, verify with the repo's dashboard driver
(`quotemate-automation:verify`) rather than assuming the form renders.

Completion bar: the four gates pass, a real tradie can save an attribute and see it persist, and
`/review` plus `/code-review` report no blocker or major findings.

## Examples

<example>
The reader whose keys must be matched — `lib/estimate/tools.ts:103-104`:
`if (f.dimmable === true) query = query.eq('properties->>dimmable', 'true')`. Note it compares to
the **string** `'true'`, so the writer must store real JSON booleans for this to match. Worth a test.
</example>

<example>
The schema style to follow — every field in `MaterialCatalogueSchema` is explicitly typed and
bounded. Follow it with an object of optional booleans rather than `z.record(z.boolean())`, which
would accept any key.
</example>
