# Phase 4 — the customer's product choice decides the parts and the tasks

## Goal

When a customer picks a product, every other part and every task on the quote matches that choice,
and all three tiers survive. This is the half of the original brief that has never been built: today
the pick rewrites exactly one line and collapses the quote to a single tier.

## Role

Principal engineer. This is the deepest change in the plan and it lands on the money path. Two
structural blockers below were not in the earlier drafts and both must be cleared before the visible
behaviour can work at all.

## Context

All paths relative to `quotemate-automation/`. Every claim verified against the source.

**The two halves of 4A are not symmetrical.** `tierLadder` **is** a field of `DeterministicTierInput`
and **is** honoured by `chooseMaterial`, which the builder forwards per tier — so wiring the ladder
is a loader-only change. `chosenProduct` appears nowhere in `DeterministicTierInput`,
`ChooseMaterialInput` or `BuildBomInput`, so "pass the chosen product in" means adding a field plus
the code that reads it.

**The real loader construction site is `run.ts:2028-2035`**, not `1977-1984` as the umbrella spec
said. It sets 6 of the 7 fields; `tierLadder` is omitted.

**Deleting the tier collapse alone achieves nothing.** `applyChosenProduct` runs at `run.ts:797`,
long after the deterministic rebuild at `run.ts:360-402`. It rewrites the first non-sundry,
non-labour line (`findHeadlineMaterialIndex`, gated by `SUNDRY_RE`) plus `tier.label`. It can never
add or drop a part. So removing the collapse at `run.ts:806-814` yields three surviving tiers holding
the **identical product at the identical price**. The pick has to reach the builder to reshape
anything.

**The one place a recipe line becomes a quote line** is `buildBomQuoteLines`
(`catalogue.ts:290-333`). `include_when` and `quantity_per` must be evaluated there, at `:296` and
`:297`.

**BLOCKER 1 — the resolver signature cannot carry a pin.** `resolveMaterial` is injected as
`(category: string)`, so no other `BomLine` field can reach it. Phase 4C's `catalogue_id` pin needs
that signature widened before it can work at all.

**BLOCKER 2 — the deterministic loader's catalogue select is too narrow.** `run.ts:2014-2021` omits
`is_preferred`, `image_path`, `description` and `properties`. Consequences: `chooseMaterial`'s
`is_preferred` tiebreaker is dead on this path, product photos are always null, and — critically —
`include_when` has no attributes to evaluate against.

**The tier ladder is already read, but with the wrong columns.** An existing query loads it for the
prompt hint and omits `catalogue_id`, the one field `TierLadderEntry` requires. 4A cannot reuse it.

**A criterion from Phase 5b must move forward.** `catalogue.ts:191-198`'s shared-material fallback
ignores the tier argument, returning the same row for good, better and best. Any category without a
tier ladder — most of them on day one — therefore yields three identical tiers, which fails 4A's own
acceptance criterion. Pull that fix into 4A (roughly five lines: price-sort the shared candidates and
index good/better/best with clamping).

**4B's task half is strictly downstream of Phase 3.** No `*_assembly_tasks` table or task builder
exists, so conditioning tasks on a product cannot start until Phase 3 lands.

## Task

### 4A — the pick anchors the tiers, and three tiers survive

- **R1** Widen the deterministic loader's catalogue select (`run.ts:2014-2021`) to include
  `is_preferred`, `image_path`, `description` and `properties`. Nothing else in 4A/4B works without
  this.
- **R2** Load `tierLadder` with `catalogue_id` and pass it in the loader construction
  (`run.ts:2028-2035`). The builder and `chooseMaterial` already honour it.
- **R3** Add `chosenProduct` to `DeterministicTierInput` and make it a tier **anchor inside the
  builder**, not a post-draft rewrite: the chosen product occupies its category in the tier it
  belongs to, and the other tiers resolve their own product for that category.
- **R4** Make `catalogue.ts:191-198`'s shared fallback honour the tier argument (price-sort, index
  with clamping) so a category with no ladder still yields three distinct tiers.
- **R5** Remove the tier collapse at `run.ts:806-814`. Only valid once R3 and R4 land.
- **R6** In `selectProductOptions` (`lib/sms/product-options.ts`), keep exactly two options and make
  the tenant's `is_preferred` product always one of them: keep `sorted[0]` as *good* and make
  *better* the preferred row when one exists, else `sorted[last]`. If the preferred row **is**
  `sorted[0]`, keep it as good and take `sorted[last]` as better.

### 4B — parts and tasks reshape around the product

- **R7** Add nullable `include_when jsonb` to the BOM rows and (once Phase 3 lands) the task rows.
  Null means always include. Evaluate it in `buildBomQuoteLines` at `catalogue.ts:296` against the
  **live catalogue row** for the resolved product, falling back to include-on-unknown so a missing
  attribute never drops a required part.
- **R8** Add nullable `quantity_per` for ratios (one driver per four lights), evaluated at
  `catalogue.ts:297` alongside the Phase 2 `item_count` scaling.
- **R9** A `smart` product adds its dimmer part and pairing task; an `integrated_driver` product
  drops the separate driver line. These are the two acceptance scenarios.

### 4C — a recipe line can pin a real product

- **R10** Widen the injected `resolveMaterial` signature so it receives the whole `BomLine`, not just
  `category`. Blocker 1; nothing in 4C works first.
- **R11** Add nullable `catalogue_id` to `tenant_assembly_bom` referencing
  `tenant_material_catalogue`, editable from the Recipes line editor.
- **R12** Precedence, in order: tier-ladder hit → recipe-line `catalogue_id` pin → brand/range/tier
  scoring → shared fallback. The ladder wins because it is explicitly per-tier while the pin is not;
  a tier-agnostic pin would otherwise flatten all three tiers.

## Constraints

- Do not enable `DETERMINISTIC_BOM`. This phase makes the builder correct for when it is enabled.
- Do not start 4B's task conditioning before Phase 3 exists.
- Preserve the fail-closed envelope: `deterministic-bom.ts:150-157` returns `{tiers: null, reason}`
  on an unpriceable required part, and `run.ts:388-394` catches any throw and falls back to the Opus
  draft. `include_when` must never turn a required part into a silent omission.
- `include_when` evaluates against product attributes only. It is not a general rules engine.
- Do not widen where the product picker appears (SMS-only, mapped job types only) — still an open
  product decision.

## Acceptance criteria & gates

```
npm test          # vitest run --testTimeout=20000
npm run typecheck # tsc --noEmit
npm run lint      # eslint
```

- **The headline test:** same job, same chosen product, run twice → byte-identical line items.
- A test that all three tiers survive a product pick and hold **three different products** — this
  fails if R4 is skipped, which is the trap.
- A test that a `smart: true` product adds the dimmer line and the pairing task.
- A test that an `integrated_driver: true` product drops the separate driver line.
- A test that `quantity_per: 4` with `item_count: 10` yields 3 drivers (ceil), not 10.
- A test that an unknown/absent attribute **includes** a required part rather than dropping it.
- A test that a tier-ladder hit beats a recipe-line `catalogue_id` pin (R12 precedence).
- A test that `selectProductOptions` always includes the `is_preferred` row, including when it is
  neither cheapest nor dearest.
- A `LIVE_DB`-gated test asserting the widened loader select actually returns `properties` and
  `is_preferred` for a real tenant catalogue row.

Completion bar: the three gates pass, the headline determinism test is green, and `/review` plus
`/code-review` report no blocker or major findings.

## Examples

<example>
What "rewrites one line" means today — `applyChosenProduct` with `findHeadlineMaterialIndex` and
`SUNDRY_RE = /sundr|seal|tape|\bclip\b|terminal|^fittings,/i`. It picks the first line that is
neither labour nor a sundry and overwrites its description, price, source and catalogue_id. Read it
before replacing it; R3 makes it redundant on the deterministic path but it still governs the Opus
fallback path.
</example>

<example>
The tier mechanism to extend, not replace — `chooseMaterial`'s `tierLadder` branch already resolves
a pinned product per tier. R3's anchor should sit alongside it in the same precedence chain, not in a
parallel code path.
</example>

<example>
The safety envelope to preserve — `lib/estimate/deterministic-bom.ts:150-157` never ships a hole, and
`lib/estimate/run.ts:388-394` never throws into the request. Every `include_when` and `quantity_per`
branch must keep both properties.
</example>

<example>
The determinism test to imitate — `lib/estimate/deterministic-bom.test.ts`'s header states the
invariant it proves: *"same recipe + catalogue = identical good/better/best every time, at the
operator's marked-up price"*. R-headline is the same assertion with a chosen product added.
</example>
