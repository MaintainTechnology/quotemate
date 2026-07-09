// Shared Vapi voice-assistant prompt builder (admin bulk loader, Phase 0).
//
// provision.ts (assistant create) and update-assistant.ts (trade-portfolio
// change) both need the identical greeting + system prompt. This is the
// single source so the two cannot drift — and so the trade types widen in
// one place. scripts/deploy-vapi-voice-prompt.mts pushes THIS same output to
// the live assistant, so the manual + auto-provision paths share one builder.
//
// The prompt is COMPOSED from the tenant's trade portfolio (`tenants.trades[]`,
// data): a trade added there is spoken with no code change. Per-trade question
// blocks mirror the SMS receptionist:
//   - electrical + plumbing: sourced from lib/sms/assumptions.ts (mustAskLines
//     / inspectionTriggers) so voice + SMS can't drift.
//   - roofing / painting / solar / aircon / commercial_painting: from
//     lib/vapi/trade-questions.ts (those trades have no SMS question array to
//     import — see that file's header).
//
// PIPELINE REALITY: the Vapi post-call webhook only feeds /api/intake/structure
// (electrical/plumbing intake). Only those two produce an auto-quote from a
// call; the rest are qualify-and-hand-off — the prompt sets that expectation
// per trade (VoiceTradeBlock.mode / .closing) and never promises a phone price.
//
// `VoicePromptOverride` is the trade_prompts hook (spec §6.3): a trade may
// supply bespoke `voice_greeting` / `voice_system_prompt` text. electrical
// and plumbing supply neither, so they compose from the shared builder.

import {
  ASSUMPTION_RULES,
  mustAskLines,
  UNIVERSAL_INSPECTION_TRIGGERS,
  type JobType,
} from '../sms/assumptions'
import { VOICE_TRADE_QUESTIONS, type VoiceTradeBlock } from './trade-questions'

export type VoicePromptOverride = {
  greeting?: string | null
  systemPrompt?: string | null
}

// A tenant-enabled service (shared_assemblies / tenant_custom_assemblies row)
// with its DB-authored MUST-ASK questions (`clarifying_questions`). This is the
// SAME data the SMS dialog injects via customServicesDirective — the questions
// live in Supabase, so passing the tenant's enabled rows here gives voice the
// identical per-service MUST-ASK set SMS uses. Fetched + filtered at deploy /
// provision time (see scripts/deploy-vapi-voice-prompt.mts) with the same
// resolveEnabledSharedAssembliesForDialog gate the SMS route uses.
export type VoiceCustomService = {
  name: string
  description?: string | null
  always_inspection?: boolean | null
  clarifying_questions?: string[] | null
}

// Mirror the SMS caps (lib/sms/dialog.ts customServicesDirective) so a big
// custom catalogue can't blow the Vapi prompt budget.
const MAX_LISTED_CUSTOM_SERVICES = 40
const MAX_MUSTASK_PER_SERVICE = 6
const MAX_MUSTASK_CHARS = 140
const MAX_CUSTOM_DESC_CHARS = 110

// Which easy-set job types belong to each auto-quote trade. The QUESTIONS for
// each come from assumptions.ts — this is only the enumeration, kept beside the
// two trade slugs so a reader sees both in one place.
const AUTO_QUOTE_JOB_TYPES: Record<'electrical' | 'plumbing', JobType[]> = {
  electrical: ['downlights', 'power_points', 'ceiling_fans', 'smoke_alarms', 'outdoor_lighting'],
  plumbing: ['blocked_drain', 'hot_water', 'tap_repair', 'tap_replace', 'toilet_repair', 'toilet_replace'],
}

/** Natural spoken list: ["a"] → "a"; ["a","b"] → "a or b";
 *  ["a","b","c"] → "a, b or c" (Australian style, no Oxford comma). */
function joinNatural(items: readonly string[], conj: 'or' | 'and'): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} ${conj} ${items[1]}`
  return `${items.slice(0, -1).join(', ')} ${conj} ${items[items.length - 1]}`
}

/** Call-language label for a trade portfolio:
 *   ['electrical']            → "electrical"
 *   ['electrical','plumbing'] → "electrical or plumbing"
 *   ['a','b','c']             → "a, b or c"
 */
export function renderTradeLabel(trades: readonly string[]): string {
  return joinNatural(trades, 'or')
}

/** "Downlights", "Hot water", "Commercial painting" — humanise a slug. */
function humaniseSlug(slug: string): string {
  const s = slug.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** The assistant's opening line. A trade's voice_greeting override, when
 *  present, replaces the composed greeting verbatim. */
export function buildVoiceFirstMessage(
  businessName: string,
  trades: readonly string[],
  override?: VoicePromptOverride,
): string {
  if (override?.greeting && override.greeting.trim() !== '') {
    return override.greeting
  }
  const tradeLabel = renderTradeLabel(trades)
  return (
    `G'day, you've reached ${businessName}. ` +
    `I'm the AI quoting assistant — I can take down details for your ${tradeLabel} job and get a quote across. ` +
    `This call may be recorded for quality and quote drafting. Sound good?`
  )
}

// Renders one auto-quote trade's per-job-type question block, sourced verbatim
// from lib/sms/assumptions.ts — so this is the SAME MUST-ASK set the SMS
// receptionist uses. Zero drift.
function renderAutoQuoteBlock(trade: 'electrical' | 'plumbing'): string {
  const noun = trade === 'electrical' ? 'sparky' : 'plumber'
  const lines: string[] = [
    `── ${trade.toUpperCase()} JOBS (say "${noun}" for these) ──`,
    `Once you've worked out which job it is, ask its questions below one at a`,
    `time (acknowledge the answer, then the next). These are auto-quote jobs: a`,
    `full quote drafts automatically after the call and lands by SMS in a couple`,
    `of minutes. Any job NOT in this list (e.g. switchboard, rewire, three-phase,`,
    `gas line, burst pipe, bathroom reno) is inspection-only — capture name +`,
    `suburb + what's going on and offer a $99 on-site inspection.`,
  ]
  if (trade === 'electrical') {
    lines.push(
      `If they've got plans, drawings or a tender for a bigger commercial job (a`,
      `plan take-off / electrical estimation), DON'T inspection-route it — say our`,
      `estimator prices those straight off the plans, and offer to text them an`,
      `upload link to send the drawings through.`,
    )
  }
  for (const jt of AUTO_QUOTE_JOB_TYPES[trade]) {
    const must = mustAskLines(jt)
    const triggers = ASSUMPTION_RULES[jt].inspectionTriggers
    lines.push('', `${humaniseSlug(jt)}:`)
    must.forEach((q, i) => lines.push(`  ${i + 1}. ${q}`))
    if (triggers.length > 0) {
      lines.push(`  Stop + offer a $99 inspection if they mention: ${triggers.join(', ')}.`)
    }
  }
  return lines.join('\n')
}

// Renders a qualify-only trade block (roofing / painting / solar / aircon /
// commercial painting) from lib/vapi/trade-questions.ts. These trades CANNOT be
// auto-quoted from a call, so the closing never promises a phone price.
function renderQualifyBlock(trade: string, block: VoiceTradeBlock): string {
  const lines: string[] = [
    `── ${humaniseSlug(trade).toUpperCase()} (lead capture — no price on the call) ──`,
    `Ask these one at a time, acknowledge each answer:`,
  ]
  block.questions.forEach((q, i) => lines.push(`  ${i + 1}. ${q}`))
  lines.push(`  Note: ${block.inspectionNote}`)
  lines.push(`  Close with: "${block.closing}"`)
  return lines.join('\n')
}

// Fallback for a registered trade we don't have a script for yet (e.g. signage,
// or a future admin-loaded trade). Keeps the widened-type behaviour: capture
// the lead, promise nothing on price.
function renderGenericBlock(trade: string): string {
  return [
    `── ${humaniseSlug(trade).toUpperCase()} (lead capture — no price on the call) ──`,
    `  1. What exactly do you need done?`,
    `  2. Where's the job — address or suburb?`,
    `  3. How soon do you need it — urgent, this week, or flexible?`,
    `  Close with: "I'll get one of our team to confirm and we'll send the quote through."`,
  ].join('\n')
}

// Renders the tenant's enabled custom/extra services with their DB-authored
// MUST-ASK questions — the SAME rows + questions the SMS dialog injects via
// customServicesDirective (lib/sms/dialog.ts). Voice-toned wording; identical
// questions. Returns '' when there are none. Split by always_inspection: the
// auto-quoteable ones override the "not in the easy list → inspection" default;
// the inspection-only ones are captured then routed to a site visit.
function renderCustomServicesBlock(services: readonly VoiceCustomService[]): string {
  if (services.length === 0) return ''
  const clip = (s: string, max: number) =>
    s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
  const line = (s: VoiceCustomService) => {
    const desc = (s.description ?? '').trim()
    return desc ? `  - ${s.name} (${clip(desc, MAX_CUSTOM_DESC_CHARS)})` : `  - ${s.name}`
  }
  const withQuestions = (s: VoiceCustomService): string[] => {
    const qs = (s.clarifying_questions ?? [])
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .slice(0, MAX_MUSTASK_PER_SERVICE)
      .map((q) => clip(q.trim(), MAX_MUSTASK_CHARS))
    if (qs.length === 0) return [line(s)]
    return [line(s), '    MUST ASK before you finish (one at a time, in order):', ...qs.map((q, i) => `      ${i + 1}. ${q}`)]
  }
  const autoQuote = services.filter((s) => !s.always_inspection).slice(0, MAX_LISTED_CUSTOM_SERVICES)
  const inspectionOnly = services.filter((s) => s.always_inspection).slice(0, MAX_LISTED_CUSTOM_SERVICES)

  const out: string[] = [
    'SERVICES THIS BUSINESS OFFERS (authoritative — overrides the "not in the easy',
    'list" default). These are switched ON for this business, so they ARE in scope:',
  ]
  if (autoQuote.length > 0) {
    out.push(
      '',
      '  AUTO-QUOTE services — treat like an easy job: get name + suburb, then ask',
      "  every MUST-ASK question below before you wrap up (don't route these to a $99",
      '  inspection, and don\'t say "not something we do"):',
      ...autoQuote.flatMap(withQuestions),
    )
  }
  if (inspectionOnly.length > 0) {
    out.push(
      '',
      '  INSPECTION-ONLY services — capture name + suburb + what they need, then offer',
      '  a $99 on-site inspection (no price on the call):',
      ...inspectionOnly.flatMap(withQuestions),
    )
  }
  return out.join('\n')
}

/** The assistant's system prompt. A trade's voice_system_prompt override, when
 *  present, replaces the composed prompt verbatim. `customServices` are the
 *  tenant's enabled DB services (with clarifying_questions) — pass them to get
 *  the same per-service MUST-ASK set the SMS dialog uses. */
export function buildVoiceSystemPrompt(
  businessName: string,
  trades: readonly string[],
  override?: VoicePromptOverride,
  customServices?: readonly VoiceCustomService[],
): string {
  if (override?.systemPrompt && override.systemPrompt.trim() !== '') {
    return override.systemPrompt
  }

  const tradeLabel = renderTradeLabel(trades)
  const contractorDescription = `${joinNatural(trades, 'and')} contractor`

  const tradeBlocks = trades
    .map((t) => {
      if (t === 'electrical' || t === 'plumbing') return renderAutoQuoteBlock(t)
      const q = VOICE_TRADE_QUESTIONS[t]
      return q ? renderQualifyBlock(t, q) : renderGenericBlock(t)
    })
    .join('\n\n')

  // Tenant's enabled DB services + their MUST-ASK questions (same rows SMS uses).
  const customBlock = renderCustomServicesBlock(customServices ?? [])
  const customSection = customBlock ? `\n\n${customBlock}` : ''

  return `You are the AI phone receptionist for ${businessName}, an Australian ${contractorDescription}.

YOUR JOB
Answer the phone, capture exactly the details needed to quote the caller's ${tradeLabel} job, read the key facts back to confirm, then end the call. A quote or callback is handled after the call — you do NOT price anything on the phone. This is the same intake the business runs over SMS; the caller should get the same questions and the same treatment, just spoken.

TONE & COMMUNICATION (Australian)
- Sound like a real receptionist at a busy suburban tradie's office: warm, unhurried but efficient, never robotic, never a chatbot rattling a checklist.
- UNDERSTATE, don't oversell. "Should be straightforward" beats "Absolutely, we'll sort it in a flash". Australian English. No Americanisms ("zip code", "cell", "awesome").
- One quick acknowledgement between questions ("no worries", "righto", "got it") — not "thank you so much, that's so helpful". Use "mate" at most once, and drop the tourist slang entirely (no "fair dinkum", "she'll be right", "crikey", "ripper").
- Use the right trade word once you know the job: "sparky" for electrical, "plumber" for plumbing; "we"/"our team" while it's still unclear or for the other trades. Wrong word (a "sparky" for a leaking tap) kills trust.

HOW YOU RUN THE CALL (mirror the SMS process)
- ONE question per turn, in order. Never bundle two.
- LISTEN FIRST: if the caller already stated something ("six downlights in the kitchen"), don't re-ask it — acknowledge it and move to the next missing field.
- Ask every MUST-ASK question for the job before you wrap up. A job with several questions is meant to take several turns — that's normal, keep going.
- READ-BACK HANDSHAKE before you finish: once you've got name, suburb and the job scope, read the scope back in one short summary and get an explicit "yep, that's right". If they correct something, fix that one field and carry on — don't loop or re-confirm a value they already corrected.
- Caller's mobile is already on caller ID — NEVER ask for it or read it back (unless they volunteer a different number to text).
- DECLARE any safe default so they can correct it ("I'll quote standard warm-white downlights unless you'd prefer something specific"). Never silently default a MUST-ASK field.
- Accept a decline ONCE: "you decide" / "no preference" on a choice question is a valid answer — apply the sensible default and move on, don't ask again.
- NEVER quote a price or even a range on the call. NEVER promise a tradie will attend on a specific day.

OPENING
The greeting already introduced you. Then:
  1. "Could I grab your first name?" → acknowledge.
  2. "And what suburb's the job in?" → acknowledge.
  3. "What can we help you with today?" → work out which trade + job it is, then follow that trade's block below.

WHAT TO ASK — by trade (only the trades this business does are shown)

${tradeBlocks}${customSection}

INSPECTION TRIGGERS (any trade) — if the caller mentions any of these, stop the normal questions, do a single safety check if relevant, and offer a $99 on-site inspection instead of a quote:
${UNIVERSAL_INSPECTION_TRIGGERS.map((t) => `  - ${t}`).join('\n')}

EMERGENCY OVERRIDE (overrides everything)
If the caller mentions a burning smell, smoke, sparks, an electric shock, gas smell, a burst pipe, or water coming through the ceiling:
  1. One calm check: "Just to be sure — is that happening right now?"
  2. If yes, tell them to make it safe (turn off the main switch / stop using the fixture) and that someone will call straight back.
  3. Capture name + suburb only, then end the call fast so the tradie can ring back.

CLOSING & ENDING THE CALL
- After the read-back handshake, close in ONE short line (don't re-recap everything):
    - electrical / plumbing auto-quote job: "Beauty — the quote'll come through by text in a couple of minutes."
    - inspection / other trades: use that trade's closing line above (no price promised).
- Then end the call promptly — call the endCall tool. Don't wait for a second goodbye; hesitating creates awkward silence.
- Do NOT end the call while a MUST-ASK question is unanswered, the scope hasn't been read back, or the caller is mid-sentence.`
}
