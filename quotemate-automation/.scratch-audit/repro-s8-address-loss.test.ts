// ════════════════════════════════════════════════════════════════════
// Run-to-run VARIANCE of the AI path on the two scenarios the 2026-07-27
// parity run flagged.
//
// One parity run is a single sample of a non-deterministic agent. S8 ended
// at `inspection` with an empty address in that run, and at `measure` with
// the correct address on the very next isolated replay. Neither number
// means anything on its own — this repeats each scenario N times and
// reports how often the AI lands on the right outcome.
//
//   LIVE_LLM=1 node --env-file=.env.local \
//     ./node_modules/vitest/vitest.mjs run lib/sms/zz-repro-s8.test.ts \
//     --testTimeout=1800000
// ════════════════════════════════════════════════════════════════════

import { describe, it } from 'vitest'
import {
  nextRoofingConversationState,
  type RoofingConversationState,
  type RoofingTurnDecision,
} from '@/lib/sms/roofing-receptionist'
import { roofingTurnViaLlm, type TenantFacts } from '@/lib/sms/llm-receptionist'

const FACTS: TenantFacts = {
  business_name: 'QM Sparky',
  owner_first_name: 'Jeph',
  trades: ['electrical', 'plumbing', 'roofing', 'painting'],
  state: 'QLD',
}

const RUNS = Number(process.env.RUNS ?? 6)

const SCENARIOS = [
  {
    name: 'S8  question mid-gather',
    msgs: [
      'quote my roof',
      '12 Smith Street Bondi NSW 2026',
      'yes',
      'do you do painting too?',
      'full reroof',
      'colorbond corrugated',
      'standard',
    ],
    want: 'measure',
    wantAddr: '12 smith street bondi nsw 2026',
  },
  {
    name: 'S7  greeting mid-gather',
    msgs: [
      'quote my roof',
      '12 Smith Street Bondi NSW 2026',
      'yes',
      'Hi there mate!',
      'full reroof',
      'colorbond corrugated',
      'standard',
    ],
    want: 'measure',
    wantAddr: '12 smith street bondi nsw 2026',
  },
]

const TERMINAL = new Set(['measure', 'inspection', 'cancel'])
const norm = (a: unknown) => String(a ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function advance(
  prev: RoofingConversationState,
  d: RoofingTurnDecision,
  carry: Record<string, unknown>,
): RoofingConversationState {
  const base = nextRoofingConversationState(d)
  return {
    ...base,
    pending_quote_token: base.pending_quote_token ?? prev.pending_quote_token ?? null,
    pending_structure_count: base.pending_structure_count ?? prev.pending_structure_count ?? null,
    ...(prev.declined_trades ? { declined_trades: prev.declined_trades } : {}),
    ...carry,
  }
}

async function runOnce(msgs: string[]) {
  let state: RoofingConversationState = { slots: {}, last_step: null }
  const history: { direction: string; body: string }[] = []
  let last!: RoofingTurnDecision
  let fallbacks = 0
  for (const m of msgs) {
    history.push({ direction: 'inbound', body: m })
    const r = await roofingTurnViaLlm({ prev: state, inbound: m, history, facts: FACTS })
    last = r.decision
    if (r.source === 'fallback') fallbacks++
    if (last.action === 'ask') history.push({ direction: 'outbound', body: last.reply })
    state = advance(state, last, r.carry as Record<string, unknown>)
    if (TERMINAL.has(last.action)) break
  }
  return {
    action: last.action,
    addr: norm((last.slots as { address?: string }).address),
    reason: (last as { reason?: string }).reason ?? '',
    slots: last.slots as Record<string, unknown>,
    fallbacks,
  }
}

describe.skipIf(!process.env.LIVE_LLM)('AI path run-to-run variance', () => {
  it(`repeats each scenario ${RUNS}x`, { timeout: 1_800_000 }, async () => {
    for (const sc of SCENARIOS) {
      const out: string[] = []
      let ok = 0
      let fb = 0
      for (let i = 0; i < RUNS; i++) {
        const r = await runOnce(sc.msgs)
        const good = r.action === sc.want && r.addr === sc.wantAddr
        if (good) ok++
        fb += r.fallbacks
        out.push(
          `${good ? 'OK ' : 'BAD'} ${r.action}` +
            `${r.addr === sc.wantAddr ? '' : ` addr=${JSON.stringify(r.addr)}`}` +
            `${good ? '' : ` reason=${JSON.stringify(r.reason)} material=${r.slots.material ?? '-'} pitch=${r.slots.pitch ?? '-'} misses=${r.slots.misses ?? '-'}`}`,
        )
      }
      console.log(`\n${sc.name} — ${ok}/${RUNS} correct, ${fb} fallback turns`)
      out.forEach((l, i) => console.log(`   run${i + 1} ${l}`))
    }
  })
})
