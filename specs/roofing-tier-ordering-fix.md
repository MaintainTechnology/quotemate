# Roofing tier-ordering fix — Spec

## Objective
Roofing quotes present three price tiers that must read cheapest → dearest:
**Patch** (`good`) → **Re-roof** (`better`) → **Upgrade** (`best`). Today that
order can break: the middle tier (Re-roof) is sometimes priced **higher** than
the top tier (Upgrade), so the options look out of order and the "Upgrade" costs
less than the "Re-roof". This was reported on a live combined-roof quote. The
fix must guarantee the invariant **`good ≤ better ≤ best`** (by ex-GST price) for
every roofing quote — single-structure and combined — using only rates already
present in the rate card, so the bug is closed without waiting on new pricing
data.

## Context / background
All roofing tier math lives in
[`lib/roofing/pricing.ts`](quotemate-automation/lib/roofing/pricing.ts).

**Confirmed root cause** — `calculateRoofingPrice()` (≈ lines 301–324):
- `betterRaw = area × baseRate × loadingMultiplier` — "Re-roof, same material",
  priced at the customer's **existing** material rate (`inputs.material`).
- `bestRaw = area × upgradeRate × loadingMultiplier` — "Upgrade material", priced
  at a **single fixed** material `rateCard.upgrade_material`
  (`colorbond_kliplok`, $115/m²).
- `goodRaw = betterRaw × GOOD_TIER_SCOPE_FRACTION` (0.20) — "Patch".

The design assumes the fixed upgrade material is always the dearest. The current
`DEFAULT_ROOFING_RATE_CARD` (≈ lines 127–141) breaks that assumption:

| Material | rate/m² |
|---|---|
| colorbond_corrugated | 90 |
| colorbond_trimdek | 95 |
| concrete_tile | 95 |
| colorbond_spandek | 105 |
| **colorbond_kliplok (upgrade_material)** | **115** |
| **terracotta_tile** | **130** ← exceeds the "upgrade" rate |
| cement_sheet | 0 (routes to inspection) |
| unknown | 0 (routes to inspection) |

When `inputs.material === terracotta_tile`, `baseRate (130) > upgradeRate (115)`,
so `betterRaw > bestRaw` ⇒ **Re-roof > Upgrade**, deterministically. Corrugated
($90) and Spandek ($105) sit below $115 and behave correctly — **terracotta is
the trigger**. A tenant rate-card overlay
([`lib/roofing/rate-card-overlay.ts`](quotemate-automation/lib/roofing/rate-card-overlay.ts))
can reproduce the same inversion for any material priced above the upgrade
material.

**Combined multi-structure path** — `priceMultiRoof()` (≈ lines 454–466) sums
tiers by fixed position `[0,1,2]` with no re-sort, so any per-structure inversion
propagates into the combined total. (Note: once each structure is individually
monotonic, the per-position sum is also monotonic — `Σgood ≤ Σbetter ≤ Σbest` —
so fixing the per-structure tiers fixes the combined total too.)

**Chosen approach (hybrid — per-material upgrade ladder + monotonic backstop).**
A pure per-material map is the most product-correct option but blocks the build:
two materials (kliplok, terracotta) sit at the top of their family with no dearer
target in the rate card. The hybrid keeps the product-correct ladder where a real
upgrade exists and adds a universal backstop that guarantees the invariant
everywhere — including top-of-ladder materials — with no fabricated numbers and
no missing-data blocker.

## Requirements

1. **Per-material upgrade ladder.** Introduce a deterministic mapping from each
   existing roof material to its upgrade target, replacing the single
   `rateCard.upgrade_material` lookup inside the best-tier computation. Default
   ladder (upgrades stay within the same material family):

   | Existing material | Upgrade target | Target rate (from card) |
   |---|---|---|
   | colorbond_corrugated | colorbond_kliplok | $115 |
   | colorbond_trimdek | colorbond_kliplok | $115 |
   | colorbond_spandek | colorbond_kliplok | $115 |
   | colorbond_kliplok | colorbond_kliplok (top of family) | $115 |
   | concrete_tile | terracotta_tile | $130 |
   | terracotta_tile | terracotta_tile (top of family) | $130 |
   | cement_sheet | n/a (routes to inspection) | — |
   | unknown | n/a (routes to inspection) | — |

2. **Resolver, not schema change.** Implement the ladder as a code-level
   resolver `upgradeMaterialFor(existingMaterial, rateCard)` (e.g. a
   `DEFAULT_UPGRADE_PATH: Record<RoofMaterial, RoofMaterial>` constant). It must
   fall back to `rateCard.upgrade_material` when a material has no ladder entry.
   Do **not** add a SQL migration or change the `RoofingRateCard` type's stored
   shape; `upgrade_material` remains as the fallback field.

3. **Universal monotonic backstop.** Compute the upgrade rate as
   `upgradeRate = max(rate(upgradeMaterialFor(material)), baseRate)`, and after
   the call-out floor is applied enforce `bestEx = max(bestEx, betterEx)`. This
   guarantees `better ≤ best` by construction even when the upgrade target equals
   or is cheaper than the existing material (the top-of-ladder cases).

4. **Patch tier stays below Re-roof for realistic quotes.** `goodRaw` remains
   `betterRaw × 0.20`, so `good ≤ better` holds for every normal-size roof and is
   confirmed under test for the standard 220 m² fixtures. Note the interaction
   with the separately-shipped **edge-works feature** (ridge/valley repointing):
   for a `full_reroof` it charges edge works on the patch-scoped `good` tier but
   shows them at $0 on `better`/`best`. On a *micro-roof* whose `better` sits at
   or just above the call-out floor, that edge charge can lift `good` above the
   tiny `better` — a benign state (customers still see a coherent quote) that must
   not crash pricing. Therefore `good ≤ better` is **not** enforced as a hard
   throw (see Req 5).

5. **Invariant enforcement (single structure).** After the three tiers are built
   in `calculateRoofingPrice()`, assert the reported-bug invariant **`better.ex_gst
   ≤ best.ex_gst`** (Upgrade never below Re-roof). A violation is treated as a
   programmer error and **throws**, matching the file's existing convention for
   impossible states. The upgrade-rate ladder + backstop guarantee this by
   construction, so the assertion never fires in production — it is a regression
   tripwire. It deliberately does **not** throw on `good > better`, for the
   edge-works reason in Req 4.

6. **Invariant enforcement (combined).** After `combinedTiers` is built in
   `priceMultiRoof()`, assert the same `better ≤ best` invariant on the combined
   ex-GST totals and throw on violation.

7. **Overlay safety.** The ladder + backstop must operate on the **effective**
   (post-overlay) rate card, so a tenant overlay that raises a material above its
   upgrade target cannot reintroduce an inversion.

8. **Honest tier copy.** When the upgrade target resolves to the **same** material
   as the existing one (top-of-ladder: kliplok, terracotta), the best-tier scope
   line and label must not claim a different "upgrade material". Use copy that is
   true for a same-material premium re-roof (e.g. "Full re-roof in premium-grade
   <material>, including ridge caps and flashings; bespoke material upgrade quoted
   on inspection") rather than the existing
   `"… using <upgradeMaterial> as a material upgrade …"` wording. When the target
   differs (corrugated→kliplok, concrete→terracotta), existing "upgrade material"
   wording stays.

9. **No change to unaffected materials.** Corrugated, trimdek, spandek, and
   concrete_tile quotes must produce the **same** tier prices as today (their
   ladder targets match the current fixed upgrade or a higher tile rate, and they
   were never inverted). Existing assertions such as `pricing.test.ts:287` (best
   uses kliplok $115 for a colorbond base) must still pass.

## Non-goals

- **No new premium rates in this version.** Sourcing real slate / premium-
  terracotta / premium-colorbond rates so that top-of-ladder materials get a
  genuinely *dearer* upgrade (instead of collapsing to ≈ Re-roof) is a **future
  enhancement**, tracked in Open questions — not part of this fix.
- **No rate-card schema migration** and no change to the persisted
  `RoofingRateCard` shape or the `tenants` overlay storage.
- **No change** to the Good-tier 20% scope model, GST handling, the call-out
  minimum floor, loading multipliers (multi-storey, asbestos), or inspection-
  routing thresholds, beyond what the invariant requires.
- **No customer-page sorting layer.** The data layer is the single source of
  truth for tier order; `app/q/roof/[token]/page.tsx` is not modified. (A display
  guard is explicitly out of scope — fixing the data is the fix.)
- Not rebuilding the rate-card overlay system — only ensuring it can't yield a
  non-monotonic quote.

## Constraints

- **Stack:** Next.js 16 App Router, TypeScript, vitest. Changes are confined to
  `lib/roofing/` and its test files.
- **Money-touching code:** every tier price must derive from the effective rate
  card — no fabricated premium percentages or invented rates. If enforcing the
  invariant makes Upgrade equal to Re-roof for a material, that is acceptable
  (roofing already forces `tradie_review` sign-off before send).
- **Test-first:** add failing tests that reproduce the inversion before changing
  production code (see Definition of done).
- **Next 16 caveat:** if any work touches `app/` (it should not), read
  `node_modules/next/dist/docs/` first per
  [`quotemate-automation/AGENTS.md`](quotemate-automation/AGENTS.md).
- **Do not delete** the existing name-order test (`pricing.test.ts:159`); it
  checks tier *names*, not prices. New tests cover prices.

## Edge cases to handle

- **Terracotta single roof** → Re-roof at $130/m²; Upgrade backstops to ≥ $130/m²
  (target = terracotta itself); `good ≤ better ≤ best` holds; best-tier copy does
  not claim a different material.
- **Kliplok single roof** (already top colorbond) → Upgrade = Re-roof at $115/m²;
  invariant holds; honest copy.
- **Corrugated / trimdek / spandek roof** → Upgrade = kliplok $115/m²; prices
  unchanged from today.
- **Concrete-tile roof** → Upgrade target = terracotta $130/m² (a genuine dearer
  upgrade); monotonic.
- **Combined: terracotta dwelling + corrugated shed** → each structure monotonic;
  combined `Σgood ≤ Σbetter ≤ Σbest`.
- **Tenant overlay raises spandek to $140/m²** (above kliplok $115) → backstop
  makes Upgrade ≥ $140/m²; no inversion.
- **cement_sheet / unknown material** → routes to inspection (rate $0); tiers are
  left at 0 (not fabricated); invariant trivially holds; behaviour unchanged.
- **Sub-floor tiny job below call-out minimum** → all positive tiers clamp to the
  floor; `better ≤ best` holds (equal is allowed). `good` may exceed the tiny
  `better` if the edge-works feature charges ridge/valley works on the patch tier
  — benign, and not a hard-throw case (per Req 4/5).
- **Backstop would otherwise fire (best < better)** → best is raised to better;
  no thrown error in production; the `better ≤ best` assertion is satisfied.

## Definition of done

- [ ] A new test in
      [`lib/roofing/pricing.test.ts`](quotemate-automation/lib/roofing/pricing.test.ts)
      prices a single **terracotta** roof with `DEFAULT_ROOFING_RATE_CARD` and
      asserts `tiers[1].ex_gst ≤ tiers[2].ex_gst` (Upgrade not below Re-roof — the
      reported bug). It **fails** on pre-fix code and **passes** after the fix.
- [ ] A new test in
      [`lib/roofing/multi-roof-pricing.test.ts`](quotemate-automation/lib/roofing/multi-roof-pricing.test.ts)
      prices a **combined terracotta + corrugated** job and asserts the combined
      tiers are monotonic. Fails before, passes after.
- [ ] A new test drives a **rate-card overlay** that pushes an existing material
      above its upgrade target and asserts the resulting quote is still monotonic.
- [ ] A parametrised test asserts `good ≤ better ≤ best` for **every** material in
      the rate card (corrugated, trimdek, spandek, kliplok, concrete_tile,
      terracotta), ex-GST and inc-GST.
- [ ] Unaffected-material prices are unchanged: existing assertions including
      `pricing.test.ts:287` still pass, and corrugated/trimdek/spandek/concrete
      tier totals match pre-fix values.
- [ ] The `assertTierMonotonic` tripwire throws on a synthetically inverted
      (`better > best`) tier set and does not throw on an ordered one (covered by a
      test that constructs the impossible state), confirming the guard works for
      both the single-structure and combined call sites.
- [ ] Best-tier scope/label copy for a same-material upgrade (terracotta, kliplok)
      no longer claims a different "upgrade material"; verified by a copy
      assertion.
- [ ] The existing name-order test (`pricing.test.ts:159`) still passes unchanged.
- [ ] `npm test` passes for the roofing suite with no regressions.
- [ ] Manual one-by-one check (as Jon/Jeph requested): generate a quote for each
      roof material and confirm on `/q/roof/[token]` that Patch ≤ Re-roof ≤
      Upgrade every time; cross-check terracotta and corrugated against the rates
      in Jon's PDF.

## Open questions

- **Premium upgrade rates (future enhancement).** To give top-of-ladder
  materials (kliplok, terracotta) a genuinely *dearer* upgrade tier instead of
  collapsing to ≈ Re-roof, we need real $/m² rates for premium targets (e.g.
  slate or premium-terracotta above $130; a premium-colorbond above kliplok).
  Source from Jon's PDF / tradie input, then extend `DEFAULT_UPGRADE_PATH` and
  the rate card. Non-blocking for this fix.
- **Ladder ownership.** Should the upgrade ladder eventually become a
  tenant-overridable field on the rate card (like `upgrade_material` today)
  rather than a code constant? Deferred until a tenant actually needs a custom
  ladder.
