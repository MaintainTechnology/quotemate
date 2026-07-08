// Pure CTA derivation for the customer roofing quote page's tier cards and
// sticky bar (specs/quote-confirm-send.md task 4). The page's real money
// action is the on-page AcceptBlock ($99 site visit, mig 165), so priced CTAs
// anchor there; while the confirm gate hides prices the CTA deep-links into
// the customer's SMS thread (the gate opens by replying YES over text).

export type RoofCta = { label: string; href: string | null }

export function roofQuoteCta(args: {
  showPrices: boolean
  indicative: boolean
  /** AcceptBlock is actionable (mode 'deposit' | 'inspection') — paid or
   *  expired views have nothing for a tier CTA to point at. */
  acceptActionable: boolean
  smsNumber: string | null
}): RoofCta {
  if (!args.showPrices) {
    return {
      label: 'Reply YES to see prices',
      // The `?&body=` separator is the form both iOS and Android honour.
      href: args.smsNumber ? `sms:${args.smsNumber}?&body=YES` : null,
    }
  }
  if (args.acceptActionable) {
    return { label: args.indicative ? 'Book site visit' : 'Accept & book', href: '#accept' }
  }
  return { label: args.indicative ? 'Reply to confirm' : 'Reply to book', href: null }
}
