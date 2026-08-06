# Electrical + plumbing: $99 paid site inspection is the only customer payment

Date: 2026-08-06
Status: ready to build
Follows: specs/painting-site-visit-first.md (same product model, different funnel)

## Product decision (owner, 2026-08-06)

Electrical and plumbing adopt roofing's model: the single customer payment is
the flat **$99 refundable paid site inspection**, credited toward the final
quote. Good/Better/Best prices remain **visible** as information; the price is
confirmed on site. The 30% tier deposit is retired for these two trades.

Evidence that drove it (live DB, 2026-08-06): the $99 path converts at
**14.8%** on electrical (4/27) vs **3.2%** for the 30% deposit (3/93);
plumbing's deposit path has **never** converted (0/53). Average deposit ask
was **$249 electrical / $425 plumbing** against an AI-drafted price nobody had
confirmed on site.

## Background — verified recon (trust this; verify only what you touch)

- **The generic funnel is SHARED by five trades**: electrical, plumbing,
  solar, commercial_painting, and some roofing rows that live on the `quotes`
  table and legitimately mint G/B/B through `/r/[token]/[tier]`
  (`app/q/[token]/page.tsx:993-1013`). Every gate added here MUST be an
  **allowlist of exactly `['electrical','plumbing']`** — never a blocklist.
- Trade on the page: `intakes.trade` → `intakeTrade` (`page.tsx:244-254`),
  `resolveTradeFormat`; `usesGenericCard` is true **only** for
  electrical/plumbing, so the five-section block (`page.tsx:1077-1872`) is
  already trade-isolated and safe to edit.
- **The mint route does not know the trade today** (`app/r/[token]/[tier]/route.ts`
  select at `:299-301` has `intake_id` but no join). It must load it.
- The route's existing `'inspection'` branch is **complete**: `canTakePayment`,
  the one-payable-session expiry, and Connect routing are all shared with the
  deposit branch (`route.ts:157,185-192,268-279`). No gap to close.
- `resolveMintDiscount` already excludes `'inspection'`
  (`lib/quote/early-bird.ts:230-231`). It stays untouched — solar and
  commercial_painting still mint discounted G/B/B on this same route.
- ⚠ **`needs_inspection` must NOT be repurposed.** It force-nulls the G/B/B
  tiers (`lib/estimate/inspection-normalize.ts:18-24`, `lib/estimate/run.ts:349-368`)
  because an Opus-drafted inspection quote may not ship fabricated prices. So
  "show G/B/B **and** charge $99" is only meaningful for `needs_inspection=false`
  rows — which is 78% of electrical and 82% of plumbing. Genuinely
  inspection-routed rows have no tiers to show and are already $99-only:
  their behaviour is unchanged.
- ⚠ **Real bug found** (`app/q/[token]/book/page.tsx:81-87`): `priceExpired` is
  gated on `!quote.needs_inspection` but is **not tier-aware**. Under the new
  policy a typical elec/plumb row (`needs_inspection=false`, lapsed
  `price_hold_until`, unpaid) hitting `/book` directly gets the "price expired"
  dead-end instead of being sent to pay the non-expiring $99. The mint route
  gets this right (`resolvePayRedirect`, `route.ts:113`); the book page does not.
- `createCheckoutSessionsForQuote` (draft-time 3-session mint,
  `app/api/estimate/draft/route.ts:613-698`) has **no other callers** — a
  contained, electrical/plumbing-only edit site.
- SMS: `buildInspectionQuoteSms` deliberately omits tier prices, so it is NOT
  reusable here. The model is painting's `buildPaintingQuoteSms`
  (`lib/sms/painting-compose.ts:81-118`): list the tier prices with no deposit
  amount or per-tier link, then one "$99 site visit" line.

## Requirements

### R1 — mint route: trade-scoped $99 gate

- New **pure, exported, unit-tested** helper (mirroring
  `resolvePaintMintTier`), living in a shared module (NOT `lib/painting/*`)
  — e.g. `lib/quote/mint-tier.ts`:
  ```
  resolveGenericMintTier(tier, trade) →
    | { kind: 'redirect_to_inspection' }   // trade ∈ {electrical, plumbing} AND tier ∈ {good,better,best}
    | { kind: 'passthrough' }              // every other trade/tier combination
  ```
  Solar, commercial_painting, roofing and the `inspection` tier itself always
  pass through unchanged.
- `app/r/[token]/[tier]/route.ts` loads `intakes.trade` (embedded join or a
  second select keyed on the already-selected `intake_id`) and applies the
  helper **before** `resolvePayRedirect`. A redirect verdict 302s to
  `/r/[token]/inspection`. Everything else — `resolvePayRedirect`,
  `mintFreshDepositUrl`, `resolveMintDiscount`, the expiry pattern — is
  **byte-for-byte unchanged**.
- A trade that cannot be resolved (null/missing intake) must **pass through**
  (fail-open to today's behaviour), never redirect — an unknown trade is not
  provably electrical/plumbing.

### R2 — customer page: $99 is the only CTA for these two trades

Within the already-trade-isolated five-section block and the shared inputs
that feed it, for `intakeTrade ∈ {electrical, plumbing}`:
- `resolveAcceptView` receives `pricesVisible: false` so every actionable
  unpaid row resolves to the inspection branch ($99 copy). Do **not** edit
  `lib/quote/accept.ts`; change the caller's inputs only.
- Tier cards in section 04 stay **visible with their prices** but become
  display-only (no per-tier deposit CTA/href).
- The sticky bar pins the $99 site visit for unpaid rows.
- Section 05 and the hero greeting use site-visit framing.
- Solar, commercial_painting and roofing rendering paths are untouched.

### R3 — book page: tier-aware price expiry (trade-scoped)

Fix the bug above: for electrical/plumbing, an unpaid visitor is sent to pay
the $99 rather than shown "price expired" — the $99 has no price hold. Scope
the fix to these trades; solar's behaviour on this shared page is unchanged.

### R4 — draft-time minting

In `app/api/estimate/draft/route.ts`, electrical/plumbing always take the
`createInspectionCheckoutSession` branch. `draft.good/better/best` computation
is **untouched** — the prices are still produced and stored, they just aren't
sold against. Do not delete `createCheckoutSessionsForQuote`; leave it in the
codebase, unreachable (same treatment painting gave its tier mint).

### R5 — copy

Update every electrical/plumbing customer-visible surface that promises a
tier deposit as the payment:
- `lib/sms/templates.ts` — `buildQuoteSms` / `buildQuoteUpdatedSms`: for these
  two trades, keep the tier prices, drop the per-tier deposit amount and link,
  add one "$99 refundable site visit" line with the inspection URL. Follow
  `buildPaintingQuoteSms`'s shape. The call sites
  (`app/api/estimate/draft`, `quote/[id]/{edit,approve,send}`) all already have
  `trade` in scope.
- Quote page: tier-card CTA, section 05, sticky bar, hero greeting, the
  "Deposit" stat cell.
- `app/q/[token]/thanks/page.tsx:207,211-213`: the summary/description
  hardcode "Site inspection" whenever the paid tier is `inspection` — make the
  wording correct for a normally-priced job that paid the $99.
- Leave `buildInspectionQuoteSms` (genuine inspection rows) alone.

### R6 — docs

- `docs/strategy.md`: append a **v20** iteration entry — electrical/plumbing
  adopt the $99 model, with the conversion data above as the rationale, and a
  note that this completes the pattern across roofing/painting/electrical/
  plumbing while solar + commercial_painting keep deposit tiers.
- Root `CLAUDE.md`: update the auto-send/review-gates rows, the "What the
  customer pays" bullet, and the pay-first invariant line so the per-trade
  payment model is stated once and correctly.

### R7 — constraints

- **Allowlist only.** Solar, commercial_painting and roofing keep per-tier
  deposits on this shared route and page — any regression there is a failure.
- `resolveAcceptView`, `resolvePayRedirect`, `resolveNextTier`,
  `canTakePayment`, `resolveMintDiscount`, `DISCOUNTABLE_TIERS`,
  `createCheckoutSessionForTier`, `TradeTiers`' `depositEnabled`,
  `resolveSolarDepositCta` — all byte-identical. Extend at call sites.
- `needs_inspection`, the grounding validator, and `lib/routing/decide.ts` are
  untouched. Genuinely inspection-routed rows behave exactly as today.
- Stripe webhook untouched. No new dependencies. No changes to the roofing or
  painting funnels.

## Definition of done

1. `npx tsc --noEmit` clean; full `npx vitest run` green.
2. New/updated unit tests: `resolveGenericMintTier` (both trades redirect on
   G/B/B; solar/commercial_painting/roofing pass through; `inspection` passes
   through; unknown trade passes through), the book-page expiry fix, the
   accept-view inputs for an electrical released-unpaid row, and the SMS copy
   (tier prices present, deposit link absent, $99 line present).
3. Existing SMS fixture tests updated faithfully, none weakened.
4. Review verifies R1–R7 with file:line evidence, and explicitly proves
   **solar and commercial_painting can still reach a G/B/B mint** while
   electrical and plumbing cannot.
