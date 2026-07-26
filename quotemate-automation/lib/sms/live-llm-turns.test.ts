// ════════════════════════════════════════════════════════════════════
// LIVE check of the REAL Sonnet 5 receptionist turn — no mocked decider.
//
// SKIPPED unless LIVE_LLM is set, because it spends real API calls. Every
// other test in this suite injects a fake model, which means the actual
// model id, the schema round-trip through the pinned provider and the
// system prompt are otherwise NEVER exercised. Running this for the first
// time found four defects the mocked tests could not: the prompt made the
// model call a tool named after a decision value (so a good turn was
// discarded), an address confirmed earlier failed its own grounding check,
// ~1 call in 9 returned empty, and a supplied address routed to a deflect.
//
// Run it after ANY change to the prompt, the schema or the model id:
//   LIVE_LLM=1 node --env-file=.env.local \
//     ./node_modules/vitest/vitest.mjs run lib/sms/live-llm-turns.test.ts \
//     --testTimeout=300000
// ════════════════════════════════════════════════════════════════════
import { describe, it } from 'vitest'
import { roofingTurnViaLlm, paintingTurnViaLlm, type TenantFacts } from '@/lib/sms/llm-receptionist'
import type { RoofingConversationState } from '@/lib/sms/roofing-receptionist'

const FACTS: TenantFacts = {
  business_name: 'QM Sparky',
  owner_first_name: 'Jeph',
  trades: ['electrical', 'plumbing', 'roofing', 'painting'],
  state: 'QLD',
}
const h = (...b: string[]) => b.map((body, i) => ({ direction: i % 2 === 0 ? 'inbound' : 'outbound', body }))

const AT_BOOKING: RoofingConversationState = {
  slots: { address: '670 London Rd, Chandler QLD 4155', address_confirmed: true, intent: 'unknown' },
  last_step: 'await_booking',
}
const MID_GATHER: RoofingConversationState = {
  slots: { address: '670 London Rd, Chandler QLD 4155', address_confirmed: true },
  last_step: 'intent',
}

describe.skipIf(!process.env.LIVE_LLM)('REAL Sonnet 5 — no mocked model', () => {
  it('drives the seven turns that matter', { timeout: 240_000 }, async () => {
    const show = (label: string, r: Awaited<ReturnType<typeof roofingTurnViaLlm>>) => {
      const d = r.decision as { action: string; step?: string; reply?: string; confirmed?: boolean }
      console.log(
        `\n${label}\n  source=${r.source} tool=${r.tool ?? '-'} action=${d.action}` +
        `${d.step ? ` step=${d.step}` : ''}${d.confirmed !== undefined ? ` confirmed=${d.confirmed}` : ''}` +
        `${r.carry.declined_trades ? ` declined=${r.carry.declined_trades}` : ''}` +
        `\n  reply=${JSON.stringify(d.reply ?? '')}`,
      )
    }

    show('1. greeting at await_booking (must NOT book)', await roofingTurnViaLlm({
      prev: AT_BOOKING, inbound: 'Hi there', history: h('Hi there'), facts: FACTS,
    }))

    show('2. refusal (must disengage + record)', await roofingTurnViaLlm({
      prev: MID_GATHER, inbound: 'No i dont want a roofer',
      history: h('No i dont want a roofer'), facts: FACTS,
    }))

    show('3. trade switch carrying BOTH trade words', await roofingTurnViaLlm({
      prev: MID_GATHER, inbound: 'Not roofer i want electrical work',
      history: h('Not roofer i want electrical work'), facts: FACTS,
    }))

    show('4. question about another trade', await roofingTurnViaLlm({
      prev: MID_GATHER, inbound: 'You do paint?', history: h('You do paint?'), facts: FACTS,
    }))

    show('5. address supplied (must route to verify_address)', await roofingTurnViaLlm({
      prev: { slots: {}, last_step: 'address' }, inbound: '12 Smith Street Bondi NSW 2026',
      history: h('quote my roof', "What's the property address?", '12 Smith Street Bondi NSW 2026'),
      facts: FACTS,
    }))

    show('6. complete brief (must route to measure)', await roofingTurnViaLlm({
      prev: { slots: { address: '670 London Rd, Chandler QLD 4155', address_confirmed: true, intent: 'full_reroof', material: 'colorbond_corrugated' }, last_step: 'pitch' },
      inbound: 'standard pitch', history: h('standard pitch'), facts: FACTS,
    }))

    const p = await paintingTurnViaLlm({
      prev: { slots: {}, last_step: null }, inbound: 'You do paint?',
      history: h('You do paint?'), facts: FACTS,
    })
    console.log(`\n7. painting "You do paint?"\n  source=${p.source} tool=${p.tool ?? '-'} action=${p.decision.action}` +
      `\n  reply=${JSON.stringify((p.decision as { reply?: string }).reply ?? '')}`)
  })
})
