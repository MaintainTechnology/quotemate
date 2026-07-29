// Phase 1b — the electrical/generic dialog turn may not ship a figure,
// product name or link that no tool produced.
//
// Roofing has had this guard since llm-receptionist.ts shipped: any model
// turn stating an ungrounded number is discarded and the pure state machine
// answers instead. The electrical branch never wired it up, and its prompt
// actively taught the model to write dollar amounts. Electrical has no state
// machine to fall back to, only a holding line, so we swap the reply TEXT and
// leave every routing field exactly as the model returned it.
//
// Not in inbound-helpers.ts on purpose: that module documents itself as
// import-free, and assertGroundedReply lives in llm-receptionist.ts, which
// pulls in @ai-sdk/anthropic. Keeping this seam separate keeps the pure
// helpers pure.

import { assertGroundedReply } from './llm-receptionist'
import { deriveTradeFromJobType } from '@/lib/intake/schema'
import { INSPECTION_FEE_AUD } from '@/lib/quote/money'

/** The subset of TurnDecision this guard reads. Structural so the route can
 *  pass its decision straight in without a cast. */
export type DialogDecisionLike = {
  action: string
  reply_to_send: string
  ready_for_intake: boolean
  job_type_guess?: string | null
}

/**
 * Guard a dialog turn's reply text.
 *
 * `modelAuthored` is load-bearing. A route-composed reply (the inspection
 * offer, the Rule 5/6 name/suburb questions, the readiness-gate question) is
 * deterministic and therefore trusted — and the inspection offer could never
 * satisfy the guard anyway, because money is refused before any grounding
 * lookup happens. Guarding it would bail every escalation.
 */
export function enforceDialogGrounding(args: {
  decision: DialogDecisionLike
  authoritative: string[]
  conversational: string[]
  fallbackReply: string
  modelAuthored: boolean
}): { decision: DialogDecisionLike; grounded: boolean; reason: string | null } {
  if (!args.modelAuthored) {
    return { decision: args.decision, grounded: true, reason: null }
  }
  const verdict = assertGroundedReply(
    args.decision.reply_to_send,
    args.authoritative,
    args.conversational,
  )
  if (verdict.ok) {
    return { decision: args.decision, grounded: true, reason: null }
  }
  // Swap the text only. action / ready_for_intake / job_type_guess carry the
  // turn's routing and are the model's job, not the guard's.
  return {
    decision: { ...args.decision, reply_to_send: args.fallbackReply },
    grounded: false,
    reason: verdict.reason,
  }
}

/**
 * The inspection offer, composed by the route so the fee comes from the one
 * shared constant instead of the eleven hardcoded prompt sites in dialog.ts.
 * Kept well inside TurnDecisionSchema's 320-character reply cap.
 */
export function composeInspectionOffer(
  jobType: string | null | undefined,
  firstName: string | null | undefined,
  tenantTrades?: readonly string[],
): string {
  const first = (firstName ?? '').split(' ')[0] || ''
  const namePart = first ? ` ${first}` : ''
  const unknownJob = !jobType || jobType === 'unknown' || jobType === 'other'
  // `switchboard` is a prompt trigger word but is NOT in the job_type_guess
  // enum, so its escalation always arrives as 'unknown'. When the tenant does
  // only one of the two trades we can still name the right tradie; when they
  // do both, staying generic is the honest answer.
  const soleTrade = (() => {
    const t = (tenantTrades ?? []).filter((x) => x === 'electrical' || x === 'plumbing')
    return t.length === 1 ? t[0] : null
  })()
  const trade = unknownJob ? soleTrade : deriveTradeFromJobType(jobType)
  const who = !trade ? 'someone out' : trade === 'plumbing' ? 'a plumber' : 'a sparky'
  return `Thanks${namePart} - for that we'll need to send ${who} for a quick look. Want me to text you a $${INSPECTION_FEE_AUD} inspection booking? It's credited toward the job if you go ahead.`
}
