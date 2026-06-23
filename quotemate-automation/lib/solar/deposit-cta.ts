// c:/Users/dalig/Downloads/QuoteMax/quoteMate/.claude/worktrees/solar-estimate/quotemate-automation/lib/solar/deposit-cta.ts
// Pure deposit-CTA gate for /q/solar/[token] (spec §6). The deposit is
// the existing per-tier short-link /r/[token]/[tier] (lib/quote/booking
// + app/r/[token]/[tier]/route.ts). It only renders once the tradie has
// confirmed the estimate AND the estimate isn't routed to inspection —
// inherits roofing's forced-review rule. No I/O.

export type SolarDepositCta =
  | { show: true; href: string; reason: 'ready' }
  | { show: false; href: null; reason: 'awaiting_confirmation' | 'inspection_required' }

export function resolveSolarDepositCta(args: {
  confirmed: boolean
  token: string
  tier: 'good' | 'better' | 'best'
  inspectionRequired: boolean
}): SolarDepositCta {
  if (args.inspectionRequired) {
    return { show: false, href: null, reason: 'inspection_required' }
  }
  if (!args.confirmed) {
    return { show: false, href: null, reason: 'awaiting_confirmation' }
  }
  return { show: true, href: `/r/${args.token}/${args.tier}`, reason: 'ready' }
}
