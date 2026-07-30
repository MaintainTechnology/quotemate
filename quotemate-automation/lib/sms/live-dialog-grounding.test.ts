// Phase 1b live verification — does REAL Sonnet 5 output on the ELECTRICAL
// dialog path survive the grounding guard?
//
// The existing live tests (live-llm-turns.test.ts, llm-parity.test.ts) only
// drive roofingTurnViaLlm. Nothing exercised decideNextTurn against the real
// model, so the false-positive risk in Phase 1b — a correct reply discarded
// and replaced with the snag fallback — was unprovable by unit test alone.
// Hand-written corpus strings cannot cover this: the whole question is what
// the model actually writes, not what we imagine it writes.
//
// SKIPPED unless LIVE_LLM is set: it drives the real model and costs tokens.
//   LIVE_LLM=1 node --env-file=.env.local \
//     ./node_modules/vitest/vitest.mjs run lib/sms/live-dialog-grounding.test.ts \
//     --testTimeout=300000
//
// Sends no SMS. Calls Anthropic and the pure guard only.

import { describe, it, expect } from 'vitest'
import { decideNextTurn } from './dialog'
import { enforceDialogGrounding, composeInspectionOffer } from './dialog-grounding'
import { buildTenantFacts } from './llm-receptionist'
import { rulesAsText } from './assumptions'
import { EMPTY_STATE } from './extract-slots'

const TENANT = {
  business_name: 'QM Sparky',
  owner_first_name: 'Jeph',
  trades: ['electrical', 'plumbing'],
  state: 'QLD',
}

const FALLBACK = "Thanks - we'll be right back to confirm details, just a quick snag on our end."

function authoritativeFor(slots: Record<string, unknown>, jobType: string | null): string[] {
  return [
    JSON.stringify(slots),
    JSON.stringify(buildTenantFacts(TENANT)),
    ...(jobType ? [safeRules(jobType)] : []),
  ].filter((s) => s.length > 0)
}

function safeRules(jobType: string): string {
  try {
    return rulesAsText(jobType as Parameters<typeof rulesAsText>[0]) ?? ''
  } catch {
    return ''
  }
}

type Scenario = {
  label: string
  inbound: string[]
  slots: Record<string, unknown>
  jobType: string | null
}

// Ordinary electrical turns. Every one of these must come back grounded —
// a bail here is a customer getting "snag on our end" instead of an answer.
const SCENARIOS: Scenario[] = [
  {
    label: 'first contact, downlights',
    inbound: ['gday need some downlights put in'],
    slots: { job_type: 'downlights' },
    jobType: 'downlights',
  },
  {
    label: 'mid-gather, count + name known',
    inbound: ['need downlights', "I'm Sam, 6 of them please"],
    slots: { job_type: 'downlights', first_name: 'Sam', count: 6 },
    jobType: 'downlights',
  },
  {
    label: 'customer asks the price directly (model must not answer with one)',
    inbound: ['6 downlights in Chandler', 'how much will it be?'],
    slots: { job_type: 'downlights', first_name: 'Sam', suburb: 'Chandler', count: 6 },
    jobType: 'downlights',
  },
  {
    label: 'double GPO replacement',
    inbound: ['can you replace two power points in the kitchen'],
    slots: { job_type: 'power_points', count: 2 },
    jobType: 'power_points',
  },
]

describe.skipIf(!process.env.LIVE_LLM)('REAL Sonnet 5 — electrical dialog vs the Phase 1b guard', () => {
  it('never bails an ordinary electrical turn', { timeout: 240_000 }, async () => {
    const bails: string[] = []

    for (const s of SCENARIOS) {
      const history = s.inbound.map((body) => ({ direction: 'inbound' as const, body }))
      const decision = await decideNextTurn({
        history,
        inboundCount: s.inbound.length,
        conversationState: { ...EMPTY_STATE, slots: s.slots },
        tenantTrades: TENANT.trades,
      })

      const out = enforceDialogGrounding({
        decision,
        authoritative: authoritativeFor(s.slots, s.jobType),
        conversational: s.inbound,
        fallbackReply: FALLBACK,
        modelAuthored: true,
      })

      console.log(`\n${s.label}`)
      console.log(`  action=${decision.action} grounded=${out.grounded}`)
      console.log(`  reply="${decision.reply_to_send}"`)
      if (!out.grounded) {
        console.log(`  BAILED: ${out.reason}`)
        bails.push(`${s.label}: ${out.reason} — "${decision.reply_to_send}"`)
      }
    }

    // A single false positive means a real customer gets the holding line
    // instead of their answer, so this is a hard assertion, not a ratio.
    expect(bails, `guard false-positived on real model output:\n${bails.join('\n')}`).toEqual([])
  })

  it('the composed inspection offer is what ships on an escalation', { timeout: 120_000 }, async () => {
    const inbound = ['need my switchboard upgraded']
    const decision = await decideNextTurn({
      history: inbound.map((body) => ({ direction: 'inbound' as const, body })),
      inboundCount: 1,
      conversationState: EMPTY_STATE,
      tenantTrades: TENANT.trades,
    })

    console.log(`\nswitchboard: action=${decision.action}`)
    console.log(`  model reply="${decision.reply_to_send}"`)

    // Whatever the model wrote, the route composes the fee line for an
    // escalation. Assert the model did NOT smuggle a figure of its own.
    expect(decision.reply_to_send).not.toMatch(/\$\s?\d/)

    if (decision.action === 'escalate_inspection') {
      const composed = composeInspectionOffer(decision.job_type_guess ?? null, null, TENANT.trades)
      console.log(`  composed  ="${composed}"`)
      expect(composed).toMatch(/\$\d+/)
      expect(composed.length).toBeLessThanOrEqual(320)
    }
  })
})
