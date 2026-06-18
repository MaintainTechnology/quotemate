import { ASSUMPTION_RULES, type JobType } from './assumptions'
import type { ConversationState } from './extract-slots'
import type { ConversationTurn } from './dialog'
import { categoryForJobType } from './product-options'

export type QuoteReadinessService = {
  name: string
  description?: string | null
  always_inspection?: boolean
  clarifying_questions?: string[] | null
  category?: string | null
}

export type MissingQuoteFact = {
  code: string
  question: string
  reason: string
}

export type QuoteReadinessResult = {
  ready: boolean
  missing: MissingQuoteFact[]
  reply: string | null
}

export type QuoteReadinessInput = {
  action: 'ask' | 'finish' | 'escalate_inspection' | 'end_conversation'
  jobTypeGuess?: string | null
  conversationState?: ConversationState
  knownFirstName?: string | null
  knownSuburb?: string | null
  history?: ConversationTurn[]
  services?: ReadonlyArray<QuoteReadinessService>
}

const WET_ROOM_RE = /\b(bathroom|ensuite|laundry|kitchen|powder room|wet area)\b/i
const WET_CLEARANCE_RE = /\b(600\s*mm|60\s*cm|basin|sink|shower|bath|wet-area|wet area|outside wet zone|away from)\b/i
const SENSOR_RE = /\b(sensor|motion|always[-\s]?on|switched|switch|timer|manual)\b/i
const BLOCKAGE_SEVERITY_RE = /\b(slow|completely|fully|totally|blocked|not going down|backing up|gurgling)\b/i
const HOT_WATER_ENERGY_RE = /\b(electric|gas|lpg|natural gas|heat pump|solar)\b/i
// R26/E8 — the customer doesn't KNOW the HWS fuel. HOT_WATER_ENERGY_RE only
// matches a KNOWN fuel, so a "not sure" answer used to loop the energy_source
// question forever and the downstream structure.ts E8 backstop (which
// escalates an unknown-fuel hot_water job to inspection) never got a chance to
// fire. Recognising an explicit not-knowing here lets finish proceed → E8
// escalates (capture-or-escalate). Mirrors how HOT_WATER_SIZE_RE already
// accepts "not sure" for the capacity question.
const HOT_WATER_FUEL_UNKNOWN_RE = /\b(not sure|don'?t know|dunno|unsure|no idea|not certain)\b/i
const HOT_WATER_SIZE_RE = /\b(\d{2,4}\s*l|litre|liter|not sure|don't know|unsure)\b/i
// R29 — an explicit natural-language DECLINE / "you decide" for a slot-backed
// MUST-ASK field (colour, supplied_by, replace_or_new). The slot extractor
// doesn't always map these to a slot value, so without this the deterministic
// finish-gate re-asks the same field every turn even though the customer has
// clearly handed the choice to us (safe default then applies). Mirrors the
// R29 prompt rule: ask first, but if the customer declines, apply the default
// and proceed. Bare topic-less phrasing ("whatever", "you decide") counts —
// the field is the one currently being asked, so context is unambiguous.
const DECLINE_RE = /\b(don'?t (care|mind|know)|whatever|you (decide|choose|reckon|pick)|your call|no preference|up to you|either(\s|$)|surprise me|you'?re the expert|just (pick|choose))\b/i
const TAP_SYMPTOM_RE = /\b(dripping|leaking|leak|stuck|won't turn|wont turn|washer|body|spout)\b/i
const TOILET_SYMPTOM_RE = /\b(running|leaking|leak|flush|won't flush|wont flush|cistern|base)\b/i
const TOILET_STYLE_RE = /\b(close[-\s]?coupled|wall[-\s]?faced|back[-\s]?to[-\s]?wall|in[-\s]?wall|standard|premium|not sure|unsure)\b/i
// R25 — smoke-alarm classifier evidence in the transcript. Either branch of
// the swap-vs-compliance classification satisfies "the classifier was
// answered": a like-for-like swap of existing alarms, OR a whole-property
// compliance hardwire (count driven by bedrooms). Kept deliberately broad
// on the answer side so a customer who phrases it naturally
// ("just swapping the old ones", "full house, 4 bedrooms") is recognised.
//
// R25 (fix) — a BARE "bedrooms" mention (e.g. "they're in the bedrooms") is a
// LOCATION, not a swap-vs-compliance classification, so it must NOT satisfy
// the classifier on its own. "bedrooms" only counts as compliance evidence
// when paired with a count ("4 bedrooms") — the way a full-property compliance
// install is actually scoped. The standalone compliance/hardwire/whole-house
// language below still satisfies it directly.
const SMOKE_CLASS_RE = /\b(like[-\s]?for[-\s]?like|swap(ping)?( out)?|replac(e|ing)|existing (alarm|one|smokie)|compliance|hardwire[d]?|whole[-\s]?(house|property)|full (house|property|compliance)|\d+\s*bedrooms?|first (install|installation)|brand[-\s]?new|no (existing |hardwired )?alarms?)\b/i

const REQUIRED_BY_JOB: Partial<Record<JobType, MissingQuoteFact[]>> = {
  downlights: [
    fact('count', 'Quick one before I quote it - how many downlights are we doing?', 'downlight count changes material and labour'),
    fact('room', 'Which room or area are the downlights for?', 'room/area anchors the scope'),
    fact('ceiling_type', 'What ceiling type is it - flat plaster, raked, cathedral, sheet metal, or not sure?', 'ceiling type changes labour difficulty'),
    fact('replace_or_new', 'Are these replacing existing downlights, or new installs where there are no fittings now?', 'replacement vs new install changes labour'),
    fact('colour', 'Any colour or feature preference - warm white, cool white, tri-colour, dimmable, smart, or standard?', 'product preference affects material choice'),
  ],
  power_points: [
    fact('count', 'Quick one before I quote it - how many GPOs or power points?', 'GPO count changes material and labour'),
    fact('room', 'Which room or area are the power points for?', 'room/area anchors the scope'),
    fact('replace_or_new', 'Are these replacing existing GPOs, adding near existing power, or a new run from the switchboard?', 'replacement vs new run changes labour'),
  ],
  ceiling_fans: [
    fact('count', 'How many fans are we doing?', 'fan count changes material and labour'),
    fact('room', 'Which room or rooms are the fans for?', 'room/area anchors the scope'),
    fact('supplied_by', 'Do you already have the fan, or would you like us to supply it?', 'supply mode changes materials'),
  ],
  smoke_alarms: [
    // R25 — CLASSIFIER FIRST. A like-for-like swap vs a full-property
    // compliance hardwire are materially different scopes, so the
    // classification must be settled before we quote.
    fact('smoke_class', 'Quick one before I quote it - is this a like-for-like swap of existing alarms, or a full-property compliance hardwire (all bedrooms + hallways)?', 'smoke alarm scope (swap vs compliance) changes count and labour'),
    fact('count', 'How many alarms are we doing (or how many bedrooms if it is a full compliance install)?', 'smoke alarm count changes material and labour'),
  ],
  outdoor_lighting: [
    fact('count', 'How many outdoor light fittings are we doing?', 'outdoor light count changes material and labour'),
    fact('room', 'Where are the outdoor lights going - eaves, deck, garden path, or another spot?', 'location affects material and install scope'),
    fact('sensor', 'Do you want them on a sensor, or always-on/switched?', 'sensor choice changes material and wiring'),
  ],
  blocked_drain: [
    fact('room', 'Which drain is blocked - kitchen sink, bathroom basin, shower, toilet, or external?', 'blocked drain location changes scope'),
    fact('blockage_severity', 'Is it slow draining, or completely blocked?', 'blockage severity changes scope'),
  ],
  hot_water: [
    fact('energy_source', 'What type of hot water system is it - electric, gas, heat pump, or not sure?', 'system type changes materials and compliance'),
    fact('litres', 'Roughly what size is the unit - for example 250L, 315L, or not sure?', 'capacity changes material selection'),
    fact('room', 'Where is the hot water unit located - laundry, outside wall, garage, roof, or somewhere else?', 'location changes install scope'),
  ],
  tap_repair: [
    fact('room', 'Which tap is it - kitchen, basin, laundry, or outdoor?', 'tap location changes parts and labour'),
    fact('tap_symptom', 'Is it dripping, leaking from the body, or stuck?', 'symptom changes repair parts'),
  ],
  tap_replace: [
    fact('room', 'Which tap are we replacing - kitchen mixer, basin, laundry, or outdoor?', 'tap location changes parts and labour'),
    fact('supplied_by', 'Are you supplying the tap, or would you like the plumber to supply it?', 'supply mode changes materials'),
  ],
  toilet_repair: [
    fact('room', 'Which toilet is it - main, ensuite, or second bathroom?', 'fixture location anchors the scope'),
    fact('toilet_symptom', "What's happening - constantly running, leaking, or won't flush?", 'symptom changes repair parts'),
  ],
  toilet_replace: [
    fact('room', 'Which toilet are we replacing - main or ensuite?', 'fixture location anchors the scope'),
    fact('toilet_style', 'Any style preference - standard close-coupled, wall-faced, in-wall cistern, or not sure?', 'style changes material selection'),
    fact('supplied_by', 'Are you supplying the toilet suite, or would you like the plumber to supply it?', 'supply mode changes materials'),
  ],
}

function fact(code: string, question: string, reason: string): MissingQuoteFact {
  return { code, question, reason }
}

function hasValue(v: unknown): boolean {
  return v !== null && v !== undefined && String(v).trim() !== ''
}

function slots(input: QuoteReadinessInput): Record<string, unknown> {
  return input.conversationState?.slots ?? {}
}

function transcript(input: QuoteReadinessInput): string {
  return (input.history ?? [])
    .filter((t) => t.direction === 'inbound')
    .map((t) => t.body)
    .join('\n')
}

function latestInbound(input: QuoteReadinessInput): string {
  const inbound = (input.history ?? []).filter((t) => t.direction === 'inbound')
  return inbound.length > 0 ? inbound[inbound.length - 1].body : ''
}

// R29 decline-escape — true when the customer's LATEST inbound is an explicit
// natural-language decline / "you decide". Used ONLY for slot-backed MUST-ASK
// fields (colour, supplied_by, replace_or_new): the field is the one currently
// being asked, so a decline on the latest turn unambiguously hands the choice
// to us and the safe default applies. Scoped to the latest inbound (not the
// whole transcript) so a stray earlier "whatever" about something else can't
// retroactively waive a later, still-genuinely-unanswered field.
function declinedLatest(input: QuoteReadinessInput): boolean {
  return DECLINE_RE.test(latestInbound(input))
}

function hasSpec(input: QuoteReadinessInput, key: string): boolean {
  const requested = slots(input).requested_specs
  return !!requested
    && typeof requested === 'object'
    && !Array.isArray(requested)
    && hasValue((requested as Record<string, unknown>)[key])
}

function jobType(input: QuoteReadinessInput): string {
  return String(slots(input).job_type ?? input.jobTypeGuess ?? '').trim()
}

function isJobType(value: string): value is JobType {
  return Object.prototype.hasOwnProperty.call(ASSUMPTION_RULES, value)
}

function missingRequiredJobFacts(input: QuoteReadinessInput): MissingQuoteFact[] {
  const jt = jobType(input)
  if (!isJobType(jt)) return []
  const required = REQUIRED_BY_JOB[jt] ?? []
  const s = slots(input)
  const text = transcript(input)
  // R29 — a decline on the customer's LATEST inbound waives the slot-backed
  // MUST-ASK field currently being asked (safe default applies). Computed once.
  const declined = declinedLatest(input)
  const missing: MissingQuoteFact[] = []

  for (const item of required) {
    if (item.code === 'count' && (Number(s.count) > 0 || hasCountInText(text))) continue
    if (item.code === 'room' && (hasValue(s.room) || hasRoomInText(text))) continue
    if (item.code === 'ceiling_type' && hasValue(s.ceiling_type)) continue
    // R29 — colour / supplied_by / replace_or_new are slot-backed but the slot
    // extractor doesn't map a natural-language decline ("whatever you reckon",
    // "you decide", "up to you"). When the latest inbound declines, treat the
    // field as satisfied so finish proceeds and the safe default applies. A
    // field the customer has NOT addressed at all (slot empty AND no decline)
    // still blocks — the hard guarantee is intact.
    if (item.code === 'replace_or_new' && (hasValue(s.replace_or_new) || declined)) continue
    if (item.code === 'colour' && (hasValue(s.colour) || declined)) continue
    if (item.code === 'supplied_by' && (hasValue(s.supplied_by) || declined)) continue
    if (item.code === 'sensor' && SENSOR_RE.test(text)) continue
    if (item.code === 'blockage_severity' && BLOCKAGE_SEVERITY_RE.test(text)) continue
    // R26/E8 — a stated fuel satisfies normally; "not sure" / "don't know"
    // STOPS the re-ask (so finish proceeds and structure.ts E8 escalates to
    // inspection rather than looping); a totally-missing fuel still blocks.
    if (
      item.code === 'energy_source'
      && (hasSpec(input, 'energy_source') || HOT_WATER_ENERGY_RE.test(text) || HOT_WATER_FUEL_UNKNOWN_RE.test(text))
    ) continue
    if (item.code === 'litres' && (hasSpec(input, 'litres') || HOT_WATER_SIZE_RE.test(text))) continue
    if (item.code === 'tap_symptom' && TAP_SYMPTOM_RE.test(text)) continue
    if (item.code === 'toilet_symptom' && TOILET_SYMPTOM_RE.test(text)) continue
    if (item.code === 'toilet_style' && TOILET_STYLE_RE.test(text)) continue
    // R25 — smoke classifier: satisfied by the replace_or_new slot
    // (replace = swap, new = first install / compliance) OR clear
    // classification language in the transcript. Asked FIRST (it is the
    // first entry in REQUIRED_BY_JOB.smoke_alarms), so finish stays blocked
    // until the swap-vs-compliance question has a real answer.
    if (item.code === 'smoke_class' && (hasValue(s.replace_or_new) || SMOKE_CLASS_RE.test(text))) continue
    missing.push(item)
  }

  if (
    jt === 'power_points'
    && String(s.replace_or_new ?? '').toLowerCase() === 'new'
    && !hasValue(s.distance_to_existing_power)
  ) {
    missing.push(fact(
      'distance_to_existing_power',
      'For the new GPO, roughly how far is the nearest existing power point - under 5m, 5-10m, or more?',
      'distance to existing power drives the cable/labour price band',
    ))
  }

  if (
    jt === 'power_points'
    && WET_ROOM_RE.test(String(s.room ?? text))
    && !WET_CLEARANCE_RE.test(text)
    // R25 (fix) — also satisfied when WE asked the clearance question and the
    // customer affirmed it, even if the affirmation lacks the narrow keyword
    // set ("yeah it's well clear", "yep nowhere near water"). Gated on the
    // question actually having been asked in an outbound, so a bare "yes" to
    // an unrelated message can never waive the clearance check.
    && !wetClearanceConfirmed(input)
  ) {
    missing.push(fact(
      'wet_area_clearance',
      'Because it is a wet area, is the GPO at least 600mm from any basin, sink, shower or bath?',
      'wet-area clearance decides quote vs inspection',
    ))
  }

  return missing
}

// R25 (fix) — true when an outbound turn ASKED the wet-area clearance question
// (mentions 600mm / clearance / basin / wet area / "away from") and a later
// inbound substantively affirms it. Breaks the re-ask loop for natural
// affirmatives that miss WET_CLEARANCE_RE's narrow keyword set, without
// letting a bare reply to an unrelated message through (the ask must precede
// the affirmation).
const WET_CLEARANCE_ASK_RE = /\b(600\s*mm|60\s*cm|clearance|wet[-\s]?area|basin|sink|shower|bath|away from)\b/i
function wetClearanceConfirmed(input: QuoteReadinessInput): boolean {
  const history = input.history ?? []
  for (let i = 0; i < history.length; i++) {
    const turn = history[i]
    if (turn.direction !== 'outbound') continue
    if (!WET_CLEARANCE_ASK_RE.test(turn.body)) continue
    const laterInbound = history.slice(i + 1).find((t) => t.direction === 'inbound')
    if (laterInbound && !isBareNegativeOrUnclear(laterInbound.body)) return true
  }
  return false
}

// A reply that does NOT count as confirming clearance: a flat "no" (the GPO is
// NOT clear → genuinely inspection-bound, must keep blocking) or an unclear /
// don't-know answer. Everything else after the clearance ask is treated as an
// affirmative ("yes", "yeah well clear", "it's about a metre away").
function isBareNegativeOrUnclear(body: string): boolean {
  const t = body.trim()
  if (/^(n|no|nope|nah)[\s.!]*$/i.test(t)) return true
  return HOT_WATER_FUEL_UNKNOWN_RE.test(t)
}

function hasRoomInText(text: string): boolean {
  return /\b(kitchen|bathroom|ensuite|laundry|garage|bedroom|lounge|living|deck|eaves|garden|outside|outdoor|hallway|toilet|main|second bathroom)\b/i.test(text)
}

// R24 — robustness fallback for the `count` MUST-ASK field. The slot
// extractor usually fills s.count, but when it lags a turn (it runs in
// parallel with the dialog), the customer's stated quantity is still in
// the transcript. Recognising it here prevents the brittle false-"missing"
// loop the review flagged: a customer who clearly said "6 downlights"
// being re-asked "how many?" because the slot hadn't been written yet.
// Matches digit counts ("6", "2 GPOs") and the common word-quantities the
// slot extractor itself understands ("a couple", "a few", "half a dozen",
// "one"/"two"/.../"twelve"). Deliberately NOT matched: prices ("$99") and
// street numbers — those are already excluded by requiring a unit-ish or
// word context, and the dialog's own count slot logic is the primary path.
const WORD_COUNT_RE = /\b(a couple|a few|half a dozen|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i
// A small digit (1-3 figures) ATTACHED to a job noun or an explicit-quantity
// marker. The noun/marker is REQUIRED (no trailing `?`) so a bare digit — a
// postcode figure, a distance, a price — is never mistaken for a quantity.
const DIGIT_COUNT_RE = /\b[1-9]\d{0,2}\s*(?:x\b|downlights?|down lights?|gpos?|power ?points?|outlets?|fans?|alarms?|lights?|fittings?|taps?|toilets?|of them)/i
function hasCountInText(text: string): boolean {
  if (WORD_COUNT_RE.test(text)) return true
  // A bare digit alone is ambiguous (postcode figure, distance, price) — only
  // treat it as a quantity when it's attached to a job noun / quantity marker.
  return DIGIT_COUNT_RE.test(text)
}

function missingServiceQuestion(
  input: QuoteReadinessInput,
  service: QuoteReadinessService | null,
): MissingQuoteFact | null {
  const questions = (service?.clarifying_questions ?? []).filter((q): q is string => hasValue(q))
  if (!service || questions.length === 0) return null
  for (const question of questions) {
    if (!questionWasAnswered(input.history ?? [], question)) {
      return fact('service_question', question, `required service question for ${service.name}`)
    }
  }
  return null
}

function findMatchedService(input: QuoteReadinessInput): QuoteReadinessService | null {
  const services = (input.services ?? []).filter((s) => !s.always_inspection)
  if (services.length === 0) return null

  const category = categoryForJobType(jobType(input))
  if (category) {
    const byCategory = services.find(
      (s) => String(s.category ?? '').trim().toLowerCase() === category,
    )
    if (byCategory) return byCategory
  }

  const text = transcript(input).toLowerCase()
  let best: { service: QuoteReadinessService; score: number } | null = null
  for (const service of services) {
    const words = serviceKeywords(service.name)
    if (words.length === 0) continue
    const hits = words.filter((w) => text.includes(w)).length
    const score = hits / words.length
    if (hits > 0 && score >= 0.5 && (!best || score > best.score)) {
      best = { service, score }
    }
  }
  return best?.service ?? null
}

function serviceKeywords(name: string): string[] {
  const stop = new Set(['install', 'replace', 'repair', 'supply', 'and', 'the', 'new', 'single'])
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !stop.has(w))
}

// R24 — robust answered-detection for mandated (custom-service) questions.
//
// The original logic only fired when an OUTBOUND turn echoed the stored
// question's keywords AND a substantive inbound followed. That is brittle:
// the dialog frequently REPHRASES the stored clarifying_question, so the
// outbound carries none of the stored question's ≥4-char keywords, overlap
// is 0, and the question is reported "missing" forever — the false-missing
// loop the review flagged. We add two additive, conservative paths:
//
//   Path A (original): outbound echoed the question's keywords, then a
//           later non-bare-affirmation inbound. Reliable when the dialog
//           used the stored wording.
//   Path B (new): the customer's own inbound text contains the question's
//           topic keyword(s). If the customer directly spoke to the topic
//           (e.g. question "...isolation valve...?" and an inbound mentions
//           "isolation valve" / "valve"), it has been addressed regardless
//           of how the dialog phrased the ask. Bare affirmations alone do
//           NOT count (they carry no topic word).
//
// Either path answering keeps the hard guarantee intact: a question whose
// topic the customer NEVER addressed (no echo path, no inbound topic word)
// still reports missing, so finish stays blocked on a genuinely unanswered
// mandatory field.
function questionWasAnswered(history: ConversationTurn[], question: string): boolean {
  const qWords = serviceKeywords(question)
  if (qWords.length === 0) return false

  // Path A — outbound echo of the stored question + substantive reply.
  for (let i = 0; i < history.length; i++) {
    const turn = history[i]
    if (turn.direction !== 'outbound') continue
    const lower = turn.body.toLowerCase()
    const overlap = qWords.filter((w) => lower.includes(w)).length
    if (overlap === 0) continue
    const laterInbound = history.slice(i + 1).find((t) => t.direction === 'inbound')
    if (laterInbound && !isBareAffirmation(laterInbound.body)) return true
  }

  // Path B — the customer addressed the topic directly in any inbound turn.
  for (const turn of history) {
    if (turn.direction !== 'inbound') continue
    if (isBareAffirmation(turn.body)) continue
    const lower = turn.body.toLowerCase()
    if (qWords.some((w) => lower.includes(w))) return true
  }

  return false
}

function isBareAffirmation(body: string): boolean {
  return /^(y|yes|yep|yeah|correct|right|all good|sounds good|ok|okay|sure|perfect)[\s.!]*$/i.test(body.trim())
}

function universalMissing(
  input: QuoteReadinessInput,
  matchedService: QuoteReadinessService | null,
): MissingQuoteFact[] {
  const s = slots(input)
  const missing: MissingQuoteFact[] = []
  if (!hasValue(s.first_name) && !hasValue(input.knownFirstName)) {
    missing.push(fact('first_name', "No worries - quick one, what's your first name?", 'customer first name is required before quoting'))
  }
  if (!hasValue(s.suburb) && !hasValue(input.knownSuburb)) {
    missing.push(fact('suburb', "Cheers - and what suburb's the job in?", 'job suburb is required before quoting'))
  }
  const jt = jobType(input)
  if ((!jt || jt === 'unknown' || jt === 'out_of_scope') && !matchedService) {
    missing.push(fact('job_type', 'What work do you need quoted?', 'job type is required before quoting'))
  }
  return missing
}

export function evaluateQuoteReadiness(input: QuoteReadinessInput): QuoteReadinessResult {
  if (input.action !== 'finish') {
    return { ready: true, missing: [], reply: null }
  }

  const matchedService = findMatchedService(input)
  const missing = [
    ...universalMissing(input, matchedService),
    ...missingRequiredJobFacts(input),
  ]
  const serviceMissing = missingServiceQuestion(input, matchedService)
  if (serviceMissing) missing.push(serviceMissing)

  if (missing.length === 0) return { ready: true, missing: [], reply: null }
  return {
    ready: false,
    missing,
    reply: missing[0].question,
  }
}
