import type { ConversationTurn } from './dialog'

export type CustomerPhase = 'single' | 'three'

/** Normalize values, not prose: a product name or an assumption is not a phase answer. */
export function normaliseCustomerPhase(value: unknown): CustomerPhase | null {
  const phase = String(value ?? '').normalize('NFKC').trim().toLowerCase()
    .replace(/[‐‑–—_]/g, '-').replace(/\s+/g, ' ')
  if (/^(?:three|3)(?:[- ]?phase|\s*[φϕ])?$/.test(phase)) return 'three'
  if (/^(?:single|one|1)(?:[- ]?phase|\s*[φϕ])?$/.test(phase)) return 'single'
  return null
}

const PHASE_WORDS = /\b(?:single|three|one|[13])[-\s]?phase\b|[13]\s*[φϕ]/i
const PROPERTY_PHASE_ASK = /\b(?:single|three|phase)\b/i
const PROPERTY_CONTEXT = /\b(?:property|house|home|supply|switchboard|board|mains)\b/i
const NEGATIVE_OR_UNCERTAIN = /\b(?:not|no|isn'?t|don'?t|unsure|unknown|maybe|perhaps|think|not sure)\b/i

/**
 * The latest customer's own property-supply answer wins. Slot aliases locate
 * the intended field; neither an assistant recap nor a remembered slot can
 * establish the evidence. In particular, "Sounds right" cannot endorse a
 * charger specification invented by the receptionist.
 */
export function customerPropertyPhase(args: {
  requestedSpecs?: Record<string, unknown> | null
  history: readonly ConversationTurn[]
}): CustomerPhase | null {
  const aliases = ['phase', 'supply_type', 'supply_phase', 'property_phase', 'electrical_phase']
  const slotAnswers = aliases.map((key) => normaliseCustomerPhase(args.requestedSpecs?.[key]))
    .filter((phase): phase is CustomerPhase => phase !== null)
  let answer: CustomerPhase | null = null
  let pendingPropertyQuestion = false
  for (const turn of args.history) {
    if (turn.direction === 'outbound') {
      // A recap that merely ends "Sound right?" is not a phase question.
      pendingPropertyQuestion = /\?/.test(turn.body) && PROPERTY_PHASE_ASK.test(turn.body) &&
        (PROPERTY_CONTEXT.test(turn.body) || /\b(?:single|three)[-\s]?phase\s+or\b/i.test(turn.body)) &&
        !/\b(?:we'll|we will|supply a|sounds? right)\b/i.test(turn.body)
      continue
    }
    const body = turn.body.trim()
    // Tolerate the incident's trailing SMS typo ("Three-phase,l"). The
    // accepted-delivery transcript may omit the preceding outbound, so an
    // otherwise standalone customer answer must still match its slot alias.
    const direct = normaliseCustomerPhase(body) ??
      (/^[a-z0-9\sφϕ-]+[,!.][a-z]?$/i.test(body)
        ? normaliseCustomerPhase(body.split(/[,!.]/)[0]) : null)
    const phaseMatch = body.match(PHASE_WORDS)
    const mention = phaseMatch?.[0]
    const specificProperty = PROPERTY_CONTEXT.test(body) &&
      !/\b(?:neighbou?r|friend|old house|previous|workshop|another property)\b/i.test(body)
    const phaseAndCapacityAnswer = phaseMatch?.index === 0 &&
      slotAnswers.includes(normaliseCustomerPhase(mention)!) && /\b(?:capacity|spare)\b/i.test(body) &&
      !/\b(?:charger|vehicle|workshop|neighbou?r)\b/i.test(body)
    const hasAnswerContext = pendingPropertyQuestion || specificProperty ||
      (direct !== null && slotAnswers.includes(direct)) || phaseAndCapacityAnswer
    if (!hasAnswerContext || (!direct && !mention)) continue
    // Negation of CAPACITY does not negate the property's phase. Inspect the
    // phase clause only: "three-phase, no spare capacity" still needs a visit.
    const phasePosition = phaseMatch?.index ?? 0
    const phasePrefix = body.slice(0, phasePosition).split(/[,;.!]|\b(?:but|and)\b/i).at(-1) ?? ''
    const phaseSuffix = body.slice(phasePosition + (mention?.length ?? body.length))
      .split(/[,;.!]|\b(?:but|and)\b/i)[0]
    if (NEGATIVE_OR_UNCERTAIN.test(`${phasePrefix} ${phaseSuffix}`) || /\?/.test(body)) {
      answer = null
      continue
    }
    answer = direct ?? normaliseCustomerPhase(mention)
    pendingPropertyQuestion = false
  }
  return answer
}
