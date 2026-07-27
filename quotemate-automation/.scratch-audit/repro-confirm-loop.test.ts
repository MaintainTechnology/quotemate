import { describe, it } from 'vitest'
import { roofingTurnViaLlm, type TenantFacts } from '@/lib/sms/llm-receptionist'
import { screenConfirmAddress } from '@/lib/sms/verify-address'
import type { RoofingConversationState } from '@/lib/sms/roofing-receptionist'

const FACTS: TenantFacts = {
  business_name: 'QM Sparky', owner_first_name: 'Jeph',
  trades: ['electrical', 'plumbing', 'roofing', 'painting'], state: 'QLD',
}

// The live thread had already quoted 670 London Rd and been parked, THEN
// the customer opened a new job. That accumulated state is the only thing
// the fresh-state replay was missing.
const PRIOR: RoofingConversationState = {
  slots: {
    address: '670 London Rd, Chandler QLD 4155',
    postcode: '4155',
    state: 'QLD',
    address_confirmed: true,
    addr_verified: '670 London Rd, Chandler QLD 4155',
    intent: 'full_reroof',
    material: 'colorbond_corrugated',
    pitch: 'standard',
  },
  last_step: 'await_booking',
  pending_quote_token: '7360a315d1ef73196da16da4a37e33de',
  pending_structure_count: 3,
}

describe('repro: address confirm loop (with the live prior state)', () => {
  it('replays the real sequence', { timeout: 600_000 }, async () => {
    let state: RoofingConversationState = { ...PRIOR }
    const history: { direction: string; body: string }[] = []

    for (const msg of [
      'I wanna do a roofing for 31 Greens Rd, Chandler QLD',
      'Hi there matey mate!',
      '670 London Rd, Corparoo 4155',
      '670 London Rd, Chandler 4155',
      'yes',
      'yes',
    ]) {
      history.push({ direction: 'inbound', body: msg })
      const r = await roofingTurnViaLlm({ prev: state, inbound: msg, history, facts: FACTS })
      const d = r.decision as { action: string; step?: string; reply?: string; slots: Record<string, unknown> }

      let askSlots = d.slots
      let askStep = d.step
      let askReply = d.reply
      if (d.action === 'ask' && d.step === 'confirm_address' && (!r.tool || r.tool === 'verify_address')) {
        const screened = await screenConfirmAddress(d.slots)
        askSlots = screened.slots
        if (screened.step) askStep = screened.step
        if (screened.reply) askReply = screened.reply
      }

      console.log(
        `\nCUST | ${msg}\n  tool=${r.tool ?? '-'} src=${r.source} action=${d.action} step=${askStep}` +
        ` prevStep=${state.last_step}` +
        `\n  confirmed=${askSlots.address_confirmed} misses=${askSlots.addr_verify_misses} addr=${JSON.stringify(askSlots.address)}` +
        `\n  BOT  | ${String(askReply ?? '').slice(0, 110)}`,
      )

      state = d.action === 'ask'
        ? { ...state, slots: askSlots, last_step: askStep as never, ...r.carry }
        : { ...state, slots: d.slots, ...r.carry }
    }
  })
})
