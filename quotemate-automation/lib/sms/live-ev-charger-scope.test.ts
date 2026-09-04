// ═══════════════════════════════════════════════════════════════════════
// LIVE check that an ENABLED catalogue service is not declined on turn 1.
//
// Replays the real 2026-09-04 failure against the REAL Sonnet 5 receptionist
// (no mocked decider), because the bug was never in the plumbing of the
// prompt — every fact the model needed was already in it. "Install EV
// charger" was ENABLED for both Sparky and Electrical3, rendered inside the
// TENANT SERVICES block, and covered by Rule 6's carve-out. The model still
// declined, because the trade-scope block ALSO named EV chargers as
// out-of-scope electrical work and nothing said the easy-5 list was a
// vocabulary rather than the tradie's full catalogue.
//
// A unit test can only prove the prompt STRING changed. Only a live turn
// proves the model's ANSWER changed, which is the thing that was broken.
//
// SKIPPED unless LIVE_LLM is set — it spends real API calls:
//   LIVE_LLM=1 node --env-file=.env.local \
//     ./node_modules/vitest/vitest.mjs run lib/sms/live-ev-charger-scope.test.ts \
//     --testTimeout=300000
// ═══════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest'
import { decideNextTurn, type CustomServiceScope } from './dialog'

/** The live shared_assemblies row, verbatim: category 'ev_charger',
 *  default_enabled false but switched ON per-tenant, three clarifying
 *  questions. */
const EV_CHARGER: CustomServiceScope = {
  name: 'Install EV charger',
  description: null,
  always_inspection: false,
  category: 'ev_charger',
  clarifying_questions: [
    'Is the charger on-site, and which model is it?',
    'Roughly how far is the parking spot from the switchboard?',
    'Single or three-phase supply, and any idea of spare switchboard capacity?',
  ],
}

/** A few other enabled extras, so EV charger is not the only row in the
 *  block — the live tenants carry 23 and 48 of them respectively. */
const OTHER_ENABLED: CustomServiceScope[] = [
  { name: 'Install dishwasher', description: null, always_inspection: false, category: null, clarifying_questions: null },
  { name: 'Install security camera', description: null, always_inspection: false, category: 'security_camera', clarifying_questions: null },
  { name: 'Install LED strip lighting', description: null, always_inspection: false, category: 'strip_light', clarifying_questions: null },
]

const DECLINE_RE =
  /aren'?t something we take on|not something we (?:take on|do)|we do ?n'?t do|we don'?t take|can'?t help with|outside what we do|don'?t offer/i

type Turn = { direction: 'inbound' | 'outbound'; body: string }

/** The exact live transcript, up to the message that was refused. */
const HISTORY: Turn[] = [
  { direction: 'inbound', body: 'Hey Mate' },
  {
    direction: 'outbound',
    body: 'Welcome back Jeff, what can I help you with this time? We do downlights, GPOs (power points), ceiling fans, smoke alarms, and outdoor lights.',
  },
  { direction: 'inbound', body: 'I was looking at getting an EVA charger installed' },
]

describe.skipIf(!process.env.LIVE_LLM)('REAL Sonnet 5 — enabled EV charger is not declined', () => {
  // The fleet hard-scopes every tenant to one trade (service-dialog.ts ->
  // scopeTenantTrades), so a multi-trade tenant like Sparky renders the
  // ELECTRICAL-ONLY branch. That is the branch that shipped the bug, so it
  // is the branch worth spending a live call on.
  it('asks an EV MUST-ASK question instead of refusing', { timeout: 120_000 }, async () => {
    const r = await decideNextTurn({
      history: HISTORY,
      inboundCount: 2,
      tenantTrades: ['electrical'],
      customAssemblies: [...OTHER_ENABLED, EV_CHARGER],
      declinedServices: ['Hardwire oven', 'Install doorbell / intercom'],
    })

    console.log(`\n  action=${r.action}\n  reply =${r.reply_to_send}\n`)

    expect(r.action, 'must not hang up on an enabled service').not.toBe('end_conversation')
    expect(r.reply_to_send, 'must not decline an ENABLED service').not.toMatch(DECLINE_RE)
    // The row carries MUST-ASK questions, so the correct turn is to ask the
    // first one — not to finish, and not to sell a $99 inspection.
    expect(r.action).toBe('ask')
    expect(r.reply_to_send.toLowerCase()).toMatch(/charger|model|on.?site|switchboard|phase/)
  })

  // The same enquiry must survive the customer using the correct spelling
  // and a blunter phrasing — the live Electrical3 thread refused this exact
  // wording twice before self-correcting.
  it('handles the blunt "do you do ev chargers" form', { timeout: 120_000 }, async () => {
    const r = await decideNextTurn({
      history: [{ direction: 'inbound', body: 'Do you do ev chargers' }],
      inboundCount: 1,
      tenantTrades: ['electrical'],
      customAssemblies: [...OTHER_ENABLED, EV_CHARGER],
    })

    console.log(`\n  action=${r.action}\n  reply =${r.reply_to_send}\n`)

    expect(r.action).not.toBe('end_conversation')
    expect(r.reply_to_send, 'must not decline an ENABLED service').not.toMatch(DECLINE_RE)
  })
})
