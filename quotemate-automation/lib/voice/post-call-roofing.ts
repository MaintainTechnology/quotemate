// PURE — what to do the moment a roofing call ends.
//
// The caller has already given the address, the roof type and the job on the
// phone, and the receptionist read the address back for a yes. So the SMS
// thread must NOT open by asking any of that again (v1 did, and it read as
// the AI forgetting the call). It opens with the same buildings/confirm-roof
// message the SMS receptionist sends after ITS measure.
//
// The gates are the SMS machine's own (nextRoofingStep): asbestos-suspect or
// unknown material, steep/unknown pitch and unclear intent all route to an
// on-site inspection exactly as they do over SMS — no voice-only rules.

import { nextRoofingStep, toRoofingRequest, type RoofingSlots, type RoofingStep } from '@/lib/sms/roofing-intake'

export type PostCallRoofingAction =
  /** Run the measure now; the first SMS is the confirm-roof/buildings message. */
  | { action: 'measure'; slots: RoofingSlots; isInspection: boolean; reason?: string }
  /** The brief itself forces a site visit — say why, park at await_booking. */
  | { action: 'inspection_reason'; slots: RoofingSlots; reason: string }
  /** Something's missing (or the address was never agreed) — ask THAT question. */
  | { action: 'ask'; slots: RoofingSlots; step: RoofingStep; question: string }

export function decidePostCallRoofingAction(
  captured: RoofingSlots,
  addressConfirmedOnCall: boolean,
): PostCallRoofingAction {
  // The read-back handshake happened on the call, so treat the address as
  // confirmed and let nextRoofingStep move on to the real gaps. Without a
  // spoken confirmation we fall back to the SMS read-back.
  const slots: RoofingSlots = {
    ...captured,
    address_confirmed: Boolean(captured.address) && addressConfirmedOnCall,
  }

  const next = nextRoofingStep(slots)

  if (next.step === 'inspection') {
    // Same split the SMS route makes: a brief complete enough to measure is
    // still measured (the saved job carries the inspection routing so the
    // page and the message show the site-visit path); an incomplete one has
    // nothing to measure, so we just say why.
    return toRoofingRequest(slots)
      ? { action: 'measure', slots, isInspection: true, reason: next.reason }
      : { action: 'inspection_reason', slots, reason: next.reason ?? 'we need a closer look' }
  }

  if (next.step === 'ready') {
    return { action: 'measure', slots, isInspection: false }
  }

  return { action: 'ask', slots, step: next.step, question: next.question ?? '' }
}
