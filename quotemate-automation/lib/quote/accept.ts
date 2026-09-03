// ════════════════════════════════════════════════════════════════════
// Customer quote acceptance — the pure decision behind the "Accept quote
// & confirm site visit" block (Gap #1 / #3 / #4).
//
// Every customer surface (electrical/plumbing /q/[token], solar, roofing,
// commercial painting, residential painting) computes its OWN gate state
// (is it paid? are prices released/confirmed? is the hold expired?) and
// hands the NORMALISED result to resolveAcceptView(), which returns one
// consistent Accept-block view model + the exact payment URL to navigate
// to after acceptance is recorded.
//
// The two product decisions this encodes (locked 2026-07-08):
//   • Acceptance is an EXPLICIT step (Jon's "Accept & confirm" block), not
//     folded silently into a bare "Pay deposit" CTA.
//   • A quote that is HELD for tradie review (prices not yet released) gets
//     the refundable $99 site-visit path — NOT a full deposit against an
//     unreviewed price. Full deposit unlocks only once prices are released.
//
// Both the deposit and the $99 site-visit routes funnel through the generic
// short-link /r/<token>/<tier>, which already mints a fresh Stripe Session
// per click (app/r/[token]/[tier]/route.ts). 'inspection' is charged $99
// via createInspectionCheckoutSession and needs no good/better/best tiers,
// so the site-visit path works for ANY quote row that exists.
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

export type AcceptMode =
  /** Confirmed + priced + hold live → accept, then pay the deposit. */
  | 'deposit'
  /** Held for review / inspection-routed → accept, then pay the $99 site visit. */
  | 'inspection'
  /** Deposit (or site-visit fee) already paid → show the booked state. */
  | 'paid'
  /** Price hold lapsed → reply for a refreshed quote (no accept action). */
  | 'expired'

export type AcceptView = {
  mode: AcceptMode
  /** Where "Accept & continue" navigates once acceptance is recorded.
   *  null for terminal states (paid / expired). */
  payHref: string | null
  /** The tier the acceptance records against ('good'|'better'|'best'|'inspection'). */
  acceptTier: string
  /** Primary button label. */
  ctaLabel: string
  /** Heading for the block. */
  heading: string
  /** The "By accepting you confirm…" bullet lines. */
  confirmations: string[]
  /** Whether the block should render an interactive accept button. */
  actionable: boolean
}

export type ResolveAcceptInput = {
  token: string
  /** Featured priced tier for the deposit path. */
  tier: 'good' | 'better' | 'best'
  /** paid_at present on the quote (deposit OR site-visit fee already paid). */
  isPaid: boolean
  /** Prices are released/confirmed AND visible to the customer (deposit-eligible). */
  pricesVisible: boolean
  /** Price hold has lapsed — only meaningful for a priced (non-inspection) quote. */
  priceExpired: boolean
  /** Human-readable price the customer is accepting, e.g. "$3,970 inc GST". */
  priceLabel: string | null
  /** Human-readable deposit line, e.g. "30% deposit ($1,191)". Optional. */
  depositLabel?: string | null
  /** Whether a booking/site-visit time is part of this acceptance. Adds the
   *  "confirm the site visit" bullet Jon asked for. Defaults true. */
  confirmsSiteVisit?: boolean
  /** The site visit has ALREADY happened — a post-site-visit 'final' row
   *  (spec post-visit-money-sequence R5). The deposit-mode strings otherwise
   *  promise "you confirm the site visit / start time on the next step" and
   *  "secure your booking", both untrue once the tradie has been on site and
   *  priced the job: what this deposit buys is the job itself, with the
   *  balance requested on completion. Drops that bullet and re-labels the CTA.
   *  Defaults false, so every existing caller is byte-identical. */
  visitDone?: boolean
  /** Site-visit fee copy. Defaults "$99". */
  siteVisitFee?: string
  /** Override the deposit short-link. Surfaces NOT backed by public.quotes
   *  pass their own route here; defaults to the generic /r/<token>/<tier>.
   *  ⚠ Residential painting no longer passes one — it pins pricesVisible
   *  false so every actionable row takes the $99 site-visit branch (spec
   *  painting-site-visit-first). */
  depositHref?: string
  /** Override the $99 site-visit short-link. Roofing's dedicated surface
   *  (/r/roof/<token>/inspection) passes its own route. Defaults to the
   *  generic /r/<token>/inspection. */
  inspectionHref?: string
}

/**
 * PURE — the Accept-block view model + post-accept payment target.
 *
 * Precedence:
 *   1. paid                       → 'paid'    (terminal, no action)
 *   2. prices visible + hold live → 'deposit' (accept → /r/<token>/<tier>)
 *   3. priced but hold expired    → 'expired' (terminal, reply for refresh)
 *   4. otherwise (held/review)    → 'inspection' (accept → /r/<token>/inspection, $99)
 */
export function resolveAcceptView(input: ResolveAcceptInput): AcceptView {
  const {
    token,
    tier,
    isPaid,
    pricesVisible,
    priceExpired,
    priceLabel,
    depositLabel,
    confirmsSiteVisit = true,
    visitDone = false,
    siteVisitFee = '$99',
    depositHref,
    inspectionHref,
  } = input

  if (isPaid) {
    return {
      mode: 'paid',
      payHref: null,
      acceptTier: tier,
      ctaLabel: 'Secured',
      heading: 'Booking secured',
      confirmations: ['Your tradie has your acceptance and will be in touch to lock in the details.'],
      actionable: false,
    }
  }

  if (pricesVisible && !priceExpired) {
    const confirmations: string[] = []
    if (priceLabel) confirmations.push(`You accept the quoted price of ${priceLabel}.`)
    if (confirmsSiteVisit && !visitDone) {
      confirmations.push('You confirm the site visit / start time on the next step.')
    }
    if (visitDone) {
      confirmations.push(
        depositLabel
          ? `Next: pay the ${depositLabel} to confirm the job; the balance is requested by your tradie on completion.`
          : 'Next: pay the deposit to confirm the job; the balance is requested by your tradie on completion.',
      )
    } else {
      confirmations.push(
        depositLabel
          ? `Next: secure your booking with the ${depositLabel}, credited to the final invoice.`
          : 'Next: secure your booking with the deposit, credited to the final invoice.',
      )
    }
    return {
      mode: 'deposit',
      payHref: depositHref ?? `/r/${token}/${tier}`,
      acceptTier: tier,
      ctaLabel: visitDone ? 'Accept & pay deposit' : 'Accept & confirm booking',
      heading: visitDone ? 'Accept your final quote' : 'Accept your quote',
      confirmations,
      actionable: true,
    }
  }

  // Expiry is only meaningful for a priced/visible quote whose hold lapsed.
  // A held (unreleased) quote is never "expired" — it falls through to the
  // site-visit path below.
  if (pricesVisible && priceExpired) {
    return {
      mode: 'expired',
      payHref: null,
      acceptTier: tier,
      ctaLabel: 'Reply to your tradie for a refreshed quote',
      heading: 'This price has expired',
      confirmations: [
        'The price on this quote was held for a limited time and has now lapsed.',
        'Reply to your tradie’s SMS and they’ll send a refreshed quote.',
      ],
      actionable: false,
    }
  }

  // Held for tradie review (prices not yet released) → the refundable
  // site-visit path. Accept + pay the fee to lock in a visit; the tradie
  // confirms the full price on-site.
  return {
    mode: 'inspection',
    payHref: inspectionHref ?? `/r/${token}/inspection`,
    acceptTier: 'inspection',
    ctaLabel: `Accept & book ${siteVisitFee} site visit`,
    heading: 'Accept & confirm your site visit',
    confirmations: [
      `You accept a refundable ${siteVisitFee} site visit — credited toward your final quote.`,
      'Your tradie confirms the final price with you on site before any work is booked.',
    ],
    actionable: true,
  }
}
