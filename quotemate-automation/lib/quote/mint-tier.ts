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

// ── The post-site-visit chain (spec post-visit-money-sequence) ───────
//
// After the $99 is paid, a job grows two more `quotes` rows: a 'final' row
// carrying the confirmed price (charged as a deposit, less the $99 credit)
// and a 'balance' row for the remainder. They share the parent's intake —
// and therefore its electrical/plumbing trade — so EVERY gate below that
// asks "is this site-visit-first?" would otherwise answer yes and try to
// sell the customer a SECOND $99 site visit on a job already visited.
//
// The trade alone can no longer answer the question. `quote_kind` must be
// part of it, which is why isSiteVisitFirstRow (not isSiteVisitFirstTrade)
// is what the page, the SMS builders, the send/edit routes and the mint all
// call now.

/** quotes.quote_kind — 'initial' is every row that existed before the chain. */
export type QuoteKind = 'initial' | 'final' | 'balance'

/** The tier literal each child kind is allowed to charge. Children never use
 *  good/better/best/inspection: a distinct literal keeps paid_tier, the
 *  Payouts label and the webhook's tier metadata unambiguous. */
export const CHILD_TIER_FOR_KIND: Readonly<Record<'final' | 'balance', string>> = {
  final: 'deposit',
  balance: 'balance',
}

/** Normalise an unknown/legacy quote_kind. NULL columns on pre-migration
 *  rows, and anything unrecognised, mean 'initial' — the behaviour every
 *  existing row already has. */
export function asQuoteKind(v: string | null | undefined): QuoteKind {
  return v === 'final' || v === 'balance' ? v : 'initial'
}

/**
 * PURE — does this ROW sell the $99 site visit?
 *
 * True only for an initial row on an allowlisted trade. A 'final' or
 * 'balance' child is past the site visit by definition, so it sells its own
 * deposit/balance instead. Replaces isSiteVisitFirstTrade at every call site
 * that can be reached by a child row.
 */
export function isSiteVisitFirstRow(input: {
  /** RAW intakes.trade — never the `?? 'electrical'` display fallback. */
  trade: string | null | undefined
  /** quotes.quote_kind. Omitted → 'initial' (every legacy caller). */
  quoteKind?: string | null | undefined
}): boolean {
  if (asQuoteKind(input.quoteKind) !== 'initial') return false
  return isSiteVisitFirstTrade(input.trade)
}

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
  /** A child row asked for a tier it cannot charge — mint NOTHING and bounce
   *  to the quote page. Critically this covers 'inspection' on a child: that
   *  tier is passthrough for every row today, so without this a click on
   *  /r/<child>/inspection would mint a live second $99, claim the child's
   *  single paid_at slot with paid_tier='inspection', and permanently block
   *  the deposit the row exists to collect. */
  | { kind: 'refuse' }
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
  /** quotes.quote_kind. Defaults to 'initial' so every existing two-argument
   *  caller — and the 17 cases in mint-tier.test.ts — behave exactly as before. */
  quoteKind?: string | null | undefined,
): GenericMintTier {
  const kind = asQuoteKind(quoteKind)

  // A child row is trade-blind: it charges its own literal and nothing else.
  // Anything else (a stale G/B/B link, the deposit tier on a balance row,
  // and above all 'inspection') mints nothing.
  if (kind !== 'initial') {
    return tier === CHILD_TIER_FOR_KIND[kind] ? { kind: 'passthrough' } : { kind: 'refuse' }
  }

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
  /** A 'final'/'balance' child row: there is no visit left to book, so this
   *  page has nothing to offer. The caller sends them to the quote instead. */
  | { kind: 'not_bookable' }

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
  /** quotes.quote_kind. Omitted → 'initial' (every legacy caller). */
  quoteKind?: string | null | undefined
}): BookUnpaidAction {
  if (asQuoteKind(input.quoteKind) !== 'initial') return { kind: 'not_bookable' }
  if (isSiteVisitFirstRow({ trade: input.trade, quoteKind: input.quoteKind })) {
    return { kind: 'pay', tier: 'inspection' }
  }
  if (!input.needsInspection && input.holdExpired) return { kind: 'expired' }
  return { kind: 'pay', tier: input.nextTier }
}
