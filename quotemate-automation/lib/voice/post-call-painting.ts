// PURE — what to do the moment a painting call ends. Twin of
// post-call-roofing.ts; the gates are the SMS machine's own
// (nextPaintingStep), so voice and SMS route identically.

import { nextPaintingStep, toPaintingRequest, type PaintingSlots, type PaintingStep } from '@/lib/sms/painting-intake'

export type PostCallPaintingAction =
  /** Run the estimate now — the first SMS is the machine's own outcome. */
  | { action: 'estimate'; slots: PaintingSlots }
  /** The brief itself forces a site visit — say why, park at await_booking. */
  | { action: 'inspection_reason'; slots: PaintingSlots; reason: string }
  /** Something's missing (or the address was never agreed) — ask THAT. */
  | { action: 'ask'; slots: PaintingSlots; step: PaintingStep; question: string }

export function decidePostCallPaintingAction(
  captured: PaintingSlots,
  addressConfirmedOnCall: boolean,
): PostCallPaintingAction {
  const slots: PaintingSlots = {
    ...captured,
    address_confirmed: Boolean(captured.address) && addressConfirmedOnCall,
  }

  const next = nextPaintingStep(slots)

  if (next.step === 'inspection') {
    return { action: 'inspection_reason', slots, reason: next.reason ?? 'we need a closer look' }
  }
  if (next.step === 'ready' && toPaintingRequest(slots)) {
    return { action: 'estimate', slots }
  }
  return { action: 'ask', slots, step: next.step, question: next.question ?? '' }
}
