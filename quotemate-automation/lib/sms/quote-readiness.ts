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
const HOT_WATER_SIZE_RE = /\b(\d{2,4}\s*l|litre|liter|not sure|don't know|unsure)\b/i
const TAP_SYMPTOM_RE = /\b(dripping|leaking|leak|stuck|won't turn|wont turn|washer|body|spout)\b/i
const TOILET_SYMPTOM_RE = /\b(running|leaking|leak|flush|won't flush|wont flush|cistern|base)\b/i
const TOILET_STYLE_RE = /\b(close[-\s]?coupled|wall[-\s]?faced|back[-\s]?to[-\s]?wall|in[-\s]?wall|standard|premium|not sure|unsure)\b/i

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
    fact('count', 'How many smoke alarms are we doing?', 'smoke alarm count changes material and labour'),
    fact('replace_or_new', 'Are these replacing existing alarms, or is this a first installation?', 'replacement vs new install changes labour'),
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
  const missing: MissingQuoteFact[] = []

  for (const item of required) {
    if (item.code === 'count' && Number(s.count) > 0) continue
    if (item.code === 'room' && (hasValue(s.room) || hasRoomInText(text))) continue
    if (item.code === 'ceiling_type' && hasValue(s.ceiling_type)) continue
    if (item.code === 'replace_or_new' && hasValue(s.replace_or_new)) continue
    if (item.code === 'colour' && hasValue(s.colour)) continue
    if (item.code === 'supplied_by' && hasValue(s.supplied_by)) continue
    if (item.code === 'sensor' && SENSOR_RE.test(text)) continue
    if (item.code === 'blockage_severity' && BLOCKAGE_SEVERITY_RE.test(text)) continue
    if (item.code === 'energy_source' && (hasSpec(input, 'energy_source') || HOT_WATER_ENERGY_RE.test(text))) continue
    if (item.code === 'litres' && (hasSpec(input, 'litres') || HOT_WATER_SIZE_RE.test(text))) continue
    if (item.code === 'tap_symptom' && TAP_SYMPTOM_RE.test(text)) continue
    if (item.code === 'toilet_symptom' && TOILET_SYMPTOM_RE.test(text)) continue
    if (item.code === 'toilet_style' && TOILET_STYLE_RE.test(text)) continue
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
  ) {
    missing.push(fact(
      'wet_area_clearance',
      'Because it is a wet area, is the GPO at least 600mm from any basin, sink, shower or bath?',
      'wet-area clearance decides quote vs inspection',
    ))
  }

  return missing
}

function hasRoomInText(text: string): boolean {
  return /\b(kitchen|bathroom|ensuite|laundry|garage|bedroom|lounge|living|deck|eaves|garden|outside|outdoor|hallway|toilet|main|second bathroom)\b/i.test(text)
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

function questionWasAnswered(history: ConversationTurn[], question: string): boolean {
  const qWords = serviceKeywords(question)
  if (qWords.length === 0) return false
  for (let i = 0; i < history.length; i++) {
    const turn = history[i]
    if (turn.direction !== 'outbound') continue
    const lower = turn.body.toLowerCase()
    const overlap = qWords.filter((w) => lower.includes(w)).length
    if (overlap === 0) continue
    const laterInbound = history.slice(i + 1).find((t) => t.direction === 'inbound')
    if (laterInbound && !isBareAffirmation(laterInbound.body)) return true
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
