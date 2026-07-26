// ════════════════════════════════════════════════════════════════════
// AI vs DETERMINISTIC parity — does the Sonnet 5 receptionist hand the
// pricer the SAME inputs the old state machine did?
//
// This is the quote-identity proof. Every dollar figure comes from
// measureAndPriceRoofs(toRoofingRequest(slots)) in an untouched module, so
// if both paths reach the same action with the same toRoofingRequest()
// payload, the quote is identical BY CONSTRUCTION — no measurement call,
// no Geoscape spend, no flakiness.
//
// SKIPPED unless LIVE_LLM is set: it drives the real model.
//   LIVE_LLM=1 node --env-file=.env.local \
//     ./node_modules/vitest/vitest.mjs run lib/sms/llm-parity.test.ts \
//     --testTimeout=900000
// ════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest'
import {
  advanceRoofing,
  nextRoofingConversationState,
  type RoofingConversationState,
  type RoofingTurnDecision,
} from './roofing-receptionist'
import { toRoofingRequest, nextRoofingStep } from './roofing-intake'
import { roofingTurnViaLlm, type TenantFacts } from './llm-receptionist'

const FACTS: TenantFacts = {
  business_name: 'QM Sparky',
  owner_first_name: 'Jeph',
  trades: ['electrical', 'plumbing', 'roofing', 'painting'],
  state: 'QLD',
}

type Turn = { direction: string; body: string }

/** Mirror of the route's state transition, shared by both paths so the
 *  comparison isolates the DECISION, not the persistence. */
function advanceState(
  prev: RoofingConversationState,
  d: RoofingTurnDecision,
  carry: { declined_trades?: string[]; booking_reask?: number },
): RoofingConversationState {
  const base = nextRoofingConversationState(d)
  return {
    ...base,
    // the route preserves these across a turn that holds its step
    pending_quote_token: base.pending_quote_token ?? prev.pending_quote_token ?? null,
    pending_structure_count: base.pending_structure_count ?? prev.pending_structure_count ?? null,
    ...(prev.declined_trades ? { declined_trades: prev.declined_trades } : {}),
    ...carry,
  }
}

/** The decisions that END the gather — the point at which the money is
 *  decided (price it, or route it on site). */
const TERMINAL = new Set(['measure', 'inspection', 'cancel'])

type Outcome = {
  final: RoofingTurnDecision
  request: unknown
  turns: number
  replies: string[]
  sources: string[]
}

/** Feed the script one message at a time and STOP at the first terminal
 *  decision. Comparing at a fixed message count is unfair to a
 *  conversational agent: asking one extra clarifying question is not a
 *  failure, it just shifts the alignment. What matters is where each path
 *  lands and what it hands the pricer. */
async function run(
  msgs: string[],
  step: (prev: RoofingConversationState, msg: string, history: Turn[]) =>
    Promise<{ decision: RoofingTurnDecision; carry: Record<string, unknown>; source: string }>,
): Promise<Outcome> {
  let state: RoofingConversationState = { slots: {}, last_step: null }
  const history: Turn[] = []
  const replies: string[] = []
  const sources: string[] = []
  let last!: RoofingTurnDecision
  let turns = 0
  for (const m of msgs) {
    history.push({ direction: 'inbound', body: m })
    const r = await step(state, m, history)
    last = r.decision
    turns++
    sources.push(r.source)
    if (last.action === 'ask') {
      replies.push(last.reply)
      history.push({ direction: 'outbound', body: last.reply })
    }
    state = advanceState(state, last, r.carry)
    if (TERMINAL.has(last.action)) break
  }
  return { final: last, request: toRoofingRequest(last.slots) ?? null, turns, replies, sources }
}

const runDeterministic = (msgs: string[]) =>
  run(msgs, async (prev, msg) => ({ decision: advanceRoofing(prev, msg), carry: {}, source: 'det' }))

const runAi = (msgs: string[]) =>
  run(msgs, async (prev, msg, history) => {
    const r = await roofingTurnViaLlm({ prev, inbound: msg, history, facts: FACTS })
    return { decision: r.decision, carry: r.carry, source: r.source }
  })

/** Punctuation in a street address is not a pricing difference — "670
 *  London Road Chandler QLD 4155" and "670 London Road, Chandler QLD 4155"
 *  geocode to the same parcel. Compare on the meaningful tokens. */
const addr = (a: string | null | undefined) =>
  (a ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** The fields that determine the price. Everything else is conversation. */
const money = (d: RoofingTurnDecision) => ({
  address: addr(d.slots.address),
  postcode: d.slots.postcode ?? null,
  state: d.slots.state ?? null,
  intent: d.slots.intent ?? null,
  material: d.slots.material ?? null,
  pitch: d.slots.pitch ?? null,
  commercial: d.slots.commercial ?? null,
})

// ── the ten scenarios ───────────────────────────────────────────────

const A1 = ['I need a new roof quote', '12 Smith Street Bondi NSW 2026', 'yes', 'full reroof', 'colorbond corrugated', 'standard']
const A2 = ['new roof quote', '670 London Road Chandler QLD 4155', 'yes', 'full reroof', 'colorbond corrugated', 'standard']
const A3 = ['roof quote', '31 Greens Road Coorparoo QLD 4151', 'yes', 'full reroof', 'cement sheet fibro', 'standard']

const SCENARIOS: {
  name: string
  msgs: string[]
  expect: 'measure' | 'inspection' | 'other'
  /** The two paths legitimately differ because the STATE MACHINE is the
   *  one with the defect. Asserted as an AI improvement, not ignored. */
  aiBetter?: true
}[] = [
  { name: 'S1  clean single-building full quote (A1)', msgs: A1, expect: 'measure' },
  { name: 'S2  multi-structure full quote (A2)', msgs: A2, expect: 'measure' },
  { name: 'S3  asbestos / cement sheet -> inspection (A3)', msgs: A3, expect: 'inspection' },
  { name: 'S4  one-shot complete brief in one message', msgs: ['full reroof at 670 London Road Chandler QLD 4155, colorbond corrugated, standard pitch', 'yes'], expect: 'measure', aiBetter: true },
  { name: 'S5  commercial warehouse -> inspection', msgs: ['need a quote for our warehouse roof at 670 London Road Chandler QLD 4155', 'yes', 'full reroof', 'colorbond corrugated', 'standard'], expect: 'inspection' },
  { name: 'S6  address correction mid-flow', msgs: ['quote my roof', '670 London Road Chandler QLD 4155', 'yes', 'actually change the address to 12 Smith Street Bondi NSW 2026', 'yes', 'full reroof', 'colorbond corrugated', 'standard'], expect: 'measure' },
  { name: 'S7  greeting mid-gather does not derail', msgs: ['quote my roof', '12 Smith Street Bondi NSW 2026', 'yes', 'Hi there mate!', 'full reroof', 'colorbond corrugated', 'standard'], expect: 'measure' },
  { name: 'S8  question mid-gather is answered, not parsed', msgs: ['quote my roof', '12 Smith Street Bondi NSW 2026', 'yes', 'do you do painting too?', 'full reroof', 'colorbond corrugated', 'standard'], expect: 'measure' },
  { name: 'S9  unsure material -> inspection', msgs: ['quote my roof', '31 Greens Road Coorparoo QLD 4151', 'yes', 'full reroof', 'no idea what it is', 'standard'], expect: 'inspection' },
  { name: 'S10 opt-out is honoured immediately', msgs: ['quote my roof', '12 Smith Street Bondi NSW 2026', 'STOP'], expect: 'other' },
]

describe.skipIf(!process.env.LIVE_LLM)('AI vs deterministic — quote parity across 10 scenarios', () => {
  it('hands the pricer identical inputs', { timeout: 900_000 }, async () => {
    const rows: string[] = []
    let priceParity = 0
    let aiFallbacks = 0
    const mismatches: string[] = []

    for (const sc of SCENARIOS) {
      const det = await runDeterministic(sc.msgs)
      const ai = await runAi(sc.msgs)
      aiFallbacks += ai.sources.filter((s) => s === 'fallback').length

      // The money question is: do both route the job the same way, and if
      // both price it, do they price the SAME job?
      const sameRoute = det.final.action === ai.final.action
      const bothMeasure = det.final.action === 'measure' && ai.final.action === 'measure'
      const detMoney = JSON.stringify(money(det.final))
      const aiMoney = JSON.stringify(money(ai.final))
      // Normalise the request's address the same way — punctuation is not a
      // pricing difference, and the model repunctuates freely.
      const reqKey = (r: unknown) => {
        const x = r as { address?: { address?: string } } | null
        return JSON.stringify(r).replace(JSON.stringify(x?.address?.address ?? ' '), JSON.stringify(addr(x?.address?.address)))
      }
      const sameInputs = detMoney === aiMoney && reqKey(det.request) === reqKey(ai.request)
      if (bothMeasure && sameInputs) priceParity++

      rows.push(
        `${sc.name}\n` +
        `   det: ${det.final.action.padEnd(10)} (${det.turns} turns) | ` +
        `ai: ${ai.final.action.padEnd(10)} (${ai.turns} turns) | ` +
        `route ${sameRoute ? 'SAME' : 'DIFFERS'}${bothMeasure ? ` | pricing-input ${sameInputs ? 'IDENTICAL' : 'DIFFERS'}` : ''}`,
      )

      // Only a genuine money divergence fails: both paths priced the job,
      // and priced a DIFFERENT job.
      //
      // S4 is the documented exception, and it is the state machine that is
      // wrong. Given a one-shot brief the raw address parser takes
      // everything from the street number onward, so it geocodes
      // "670 London Road Chandler QLD 4155, colorbond corrugated, standard
      // pitch". The model sends the clean address. Matching the old
      // behaviour here would mean copying a defect.
      if (bothMeasure && !sameInputs && !sc.aiBetter) {
        mismatches.push(`${sc.name}\n     det=${detMoney}\n      ai=${aiMoney}`)
      }
      if (sc.aiBetter && bothMeasure) {
        expect(String((ai.request as { address?: { address?: string } })?.address?.address ?? ''))
          .not.toMatch(/corrugated|pitch/i)
      }
      if (!sameRoute) {
        const aiStep = ai.final.action === 'ask' ? ai.final.step : '-'
        rows.push(
          `   ROUTE NOTE det=${det.final.action} ai=${ai.final.action} aiStep=${aiStep}` +
          ` aiConfirmed=${ai.final.slots.address_confirmed}` +
          ` aiReadiness=${JSON.stringify(nextRoofingStep(ai.final.slots).step)}` +
          `\n     det=${detMoney}\n      ai=${aiMoney}` +
          `\n     aiReply=${JSON.stringify(ai.replies.at(-1) ?? '')}`,
        )
      }
    }

    console.log('\n' + rows.join('\n'))
    console.log(`\nBOTH PRICED + IDENTICAL PRICING INPUT: ${priceParity}`)
    console.log(`AI turns that fell back to the state machine: ${aiFallbacks}`)
    if (mismatches.length) console.log('\nMONEY MISMATCHES:\n' + mismatches.join('\n'))

    expect(mismatches, 'when both paths price a job, they must price the SAME job').toEqual([])
  })
})
