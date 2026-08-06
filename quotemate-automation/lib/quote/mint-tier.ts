// ════════════════════════════════════════════════════════════════════
// Generic-funnel payment gate — which trades still sell a Good/Better/Best
// deposit, and which sell only the flat $99 site inspection.
//
// Spec elec-plumb-site-visit-first (owner decision 2026-08-06): electrical
// and plumbing adopt roofing's model. The single customer payment is the
// flat $99 REFUNDABLE site inspection, credited toward the final quote.
// The G/B/B prices stay VISIBLE as information — they are just no longer
// sold against; the price is confirmed on site. Evidence: the $99 path
// converts at 14.8% on electrical (4/27) vs 3.2% for the 30% deposit
// (3/93), and plumbing's deposit path has never converted (0/53).
//
// ⚠ THE GENERIC FUNNEL IS SHARED. `/q/[token]` and `/r/[token]/[tier]`
// serve FIVE trades: electrical, plumbing, solar, commercial_painting, and
// the roofing rows that live on the `quotes` table — the last three still
// legitimately mint G/B/B deposits here. So the gate below is an
// ALLOWLIST of exactly two trades, never a blocklist ("not solar" would
// silently kill roofing's deposit path).
//
// FAIL OPEN. A trade that cannot be resolved (missing intake, legacy
// trade-less row, an unrecognised value) is NOT provably electrical or
// plumbing, so it passes through to today's behaviour. Every caller reads
// the RAW `intakes.trade` for this — never the `?? 'electrical'` display
// fallback — so the page, the mint, the book page and the draft route all
// answer the same question the same way.
//
// ⚠ `needs_inspection` is NOT repurposed here. It force-nulls the G/B/B
// tiers by design (an Opus-drafted inspection quote may not ship fabricated
// prices), so those rows have no tiers to show and are already $99-only —
// their behaviour is unchanged. This gate targets the needs_inspection=false
// majority: prices still shown, $99 charged instead of a deposit.
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

/** The two trades whose only customer payment is the $99 site inspection. */
export const SITE_VISIT_FIRST_TRADES: ReadonlySet<string> = new Set(['electrical', 'plumbing'])

/** The priced tiers a generic pay short-link can name. */
const DEPOSIT_TIERS: ReadonlySet<string> = new Set(['good', 'better', 'best'])

/**
 * PURE — is this trade on the $99-only allowlist?
 *
 * Exact match against the `intakes.trade` value (trimmed + lower-cased).
 * Deliberately NOT alias-mapped: a fuzzy match here would be a chance to
 * wrongly capture another trade's deposit. Null/undefined/unknown → false,
 * so every caller fails open.
 */
export function isSiteVisitFirstTrade(trade: string | null | undefined): boolean {
  return SITE_VISIT_FIRST_TRADES.has((trade ?? '').trim().toLowerCase())
}

export type GenericMintTier =
  /** Electrical/plumbing G/B/B link → 302 onto /r/<token>/inspection. */
  | { kind: 'redirect_to_inspection' }
  /** Every other trade/tier combination → today's behaviour, untouched. */
  | { kind: 'passthrough' }

/**
 * PURE — what a `/r/<token>/<tier>` click may start (spec
 * elec-plumb-site-visit-first R1). Applied BEFORE resolvePayRedirect so a
 * lapsed price hold can't dead-end an electrical/plumbing customer whose
 * only remaining payment ($99) has no hold at all.
 *
 * Redirecting rather than 400ing keeps every previously-texted deposit link
 * working — exactly the treatment painting gave its retired tier mints
 * (lib/painting/pay-redirect.ts).
 */
export function resolveGenericMintTier(
  tier: string,
  trade: string | null | undefined,
): GenericMintTier {
  if (!isSiteVisitFirstTrade(trade)) return { kind: 'passthrough' }
  if (DEPOSIT_TIERS.has(tier)) return { kind: 'redirect_to_inspection' }
  // The 'inspection' literal (and anything else the route already rejects)
  // is unaffected — it IS the payment these trades now take.
  return { kind: 'passthrough' }
}

export type BookUnpaidAction =
  /** Priced quote whose hold lapsed — the "price expired" dead-end page. */
  | { kind: 'expired' }
  /** Send them to the mint for this tier. */
  | { kind: 'pay'; tier: string }

/**
 * PURE — what an UNPAID visitor to the shared `/q/[token]/book` page gets
 * (spec elec-plumb-site-visit-first R3).
 *
 * The bug this fixes: `priceExpired` was gated on `!needs_inspection` but was
 * never tier-aware, so a typical electrical/plumbing row (needs_inspection
 * false, hold lapsed, unpaid) landing here got the "price expired" dead-end
 * instead of being sent to pay the $99 — which has no price hold and is now
 * their ONLY payment. The mint route already got this right
 * (resolvePayRedirect exempts 'inspection'); this page did not.
 *
 * Scoped by the same allowlist: solar (the other trade on this shared page)
 * keeps today's behaviour exactly, and an unresolvable trade fails open.
 */
export function resolveBookUnpaidAction(input: {
  /** RAW intakes.trade for this quote — null when it can't be resolved. */
  trade: string | null | undefined
  /** isPriceHoldExpired(price_hold_until, created_at), computed by the caller. */
  holdExpired: boolean
  /** quotes.needs_inspection — indicative prices, exempt from the hold. */
  needsInspection: boolean
  /** resolveNextTier(?tier, selected_tier) — the tier the pay step would charge. */
  nextTier: string
}): BookUnpaidAction {
  if (isSiteVisitFirstTrade(input.trade)) return { kind: 'pay', tier: 'inspection' }
  if (!input.needsInspection && input.holdExpired) return { kind: 'expired' }
  return { kind: 'pay', tier: input.nextTier }
}
