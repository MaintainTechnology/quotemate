import { customerWantsForm } from './painting-receptionist'
import type { FormOfferPin } from './extract-slots'

export const FORM_OFFER_TRADE = 'plumbing'
export function buildQuoteRequestUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/quote-request/${token}`
}
export function buildTradeFormOffer(args: { trade: string; firstName?: string | null; formUrl: string }): string {
  const first = (args.firstName ?? '').trim().split(/\s+/)[0]
  return [
    `${first ? `Hi ${first}, ` : 'Hi, '}happy to sort a ${args.trade} quote for you.`,
    `Quickest way is this short form — the tradie will review your request before any quote is sent: ${args.formUrl}`,
    "Or just reply here and I'll ask you a few quick questions instead.",
  ].join('\n')
}
export const FORM_OFFER_ACK =
  "Great — fill that in whenever you're ready. The tradie will review your request before any quote is sent. Or just reply here anytime and I'll ask a few quick questions instead."
export type FormOfferAction = 'offer' | 'acknowledge' | 'gather' | 'none'
export function decideFormOfferTurn(args: {
  pin: FormOfferPin | null | undefined; agentHasReplied: boolean; suppressed: boolean; inbound: string
}): FormOfferAction {
  // Busy/opted-out threads remain suppressed even when an old pin exists.
  if (args.suppressed) return 'none'
  if (args.pin) return args.pin.step === 'gather' ? 'none'
    : customerWantsForm(args.inbound) ? 'acknowledge' : 'gather'
  return args.agentHasReplied ? 'none' : 'offer'
}

/** Preserve plumbing's shipped form-first path without changing other trades. */
export function plumbingFormOfferEnabled(trades: unknown, jobTrade: unknown, service = process.env.SMS_WORKER_SERVICE): boolean {
  const enabled = Array.isArray(trades) ? trades.filter((trade): trade is string => typeof trade === 'string') : []
  if (!enabled.includes('plumbing')) return false
  if (service === 'plumbing') return true
  if (service && service !== 'platform') return false
  return jobTrade === 'plumbing' || (enabled.length === 1 && enabled[0] === 'plumbing')
}
