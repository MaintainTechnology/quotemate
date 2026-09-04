// EV charger readiness: the progress fix, the photo gate, the decline escape
// and the no-enabled-service floor.
// Spec specs/ev-charger-location-photo.md R4, R6, R9, R10 / R20.

import { describe, it, expect } from 'vitest'
import {
  evaluateQuoteReadiness,
  photoDeclined,
  EV_CHARGER_FALLBACK_QUESTIONS,
  type QuoteReadinessInput,
  type QuoteReadinessService,
} from './quote-readiness'
import type { ConversationTurn } from './dialog'
import { normaliseState } from './extract-slots'
import { shouldSendPhotoRequest } from './photo-request-trigger'

const EV_SERVICE: QuoteReadinessService = {
  name: 'Install EV charger',
  category: 'ev_charger',
  always_inspection: false,
  clarifying_questions: [...EV_CHARGER_FALLBACK_QUESTIONS],
}

function turn(direction: 'inbound' | 'outbound', body: string): ConversationTurn {
  return { direction, body } as ConversationTurn
}

/** A conversation that has satisfied the universal facts (name + suburb), so
 *  only the EV-specific gates are under test. */
function base(over: Partial<QuoteReadinessInput> = {}): QuoteReadinessInput {
  return {
    action: 'finish',
    jobTypeGuess: 'ev_charger',
    knownFirstName: 'Jon',
    knownSuburb: 'Chandler',
    services: [EV_SERVICE],
    history: [],
    ...over,
  }
}

/** Inbound answers that address each of the five questions by topic word. */
const ANSWERS = [
  'l have a Tesla',
  'I already have the charger unit here',
  'it is going on the garage wall',
  'the switchboard is about 8 metres away',
  'single phase, and there is spare capacity on the switchboard',
]

function answeredThrough(n: number): ConversationTurn[] {
  const history: ConversationTurn[] = []
  for (let i = 0; i < n; i++) {
    history.push(turn('outbound', EV_CHARGER_FALLBACK_QUESTIONS[i]))
    history.push(turn('inbound', ANSWERS[i]))
  }
  return history
}

describe('R4 — the outstanding question is identifiable, so progress is visible', () => {
  it('names WHICH question is missing, not a shared code', () => {
    const r = evaluateQuoteReadiness(base())
    expect(r.ready).toBe(false)
    expect(r.missing.map((m) => m.code)).toContain('service_question:0')
  })

  it('changes the missing code as each question is answered', () => {
    // This is the whole bug: the codes used to be identical on every blocked
    // turn, so the route's set comparison saw no progress and marched a
    // cooperative customer to the clarify cap and a $99 inspection.
    const seen: string[] = []
    for (let n = 0; n < 5; n++) {
      const r = evaluateQuoteReadiness(base({ history: answeredThrough(n) }))
      const code = r.missing.find((m) => m.code.startsWith('service_question'))?.code
      expect(code, `question ${n} outstanding`).toBe(`service_question:${n}`)
      seen.push(code!)
    }
    expect(new Set(seen).size).toBe(5)
  })
})

describe('R6 — the photo is the sixth required step', () => {
  it('is NOT asked while text questions are still outstanding', () => {
    const r = evaluateQuoteReadiness(base({ history: answeredThrough(2) }))
    expect(r.missing.map((m) => m.code)).not.toContain('ev_photo')
  })

  it('blocks the finish once all five are answered and no photo exists', () => {
    const r = evaluateQuoteReadiness(base({ history: answeredThrough(5) }))
    expect(r.ready).toBe(false)
    expect(r.missing.map((m) => m.code)).toContain('ev_photo')
  })

  it('passes when the conversation has a photo', () => {
    const r = evaluateQuoteReadiness(base({ history: answeredThrough(5), hasPhoto: true }))
    expect(r.ready).toBe(true)
    expect(r.missing).toEqual([])
  })

  it('never gates a non-EV job on a photo', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'downlights',
      knownFirstName: 'Jon',
      knownSuburb: 'Chandler',
      services: [],
      history: [],
    })
    expect(r.missing.map((m) => m.code)).not.toContain('ev_photo')
  })
})

describe('R9 — a customer who cannot send a photo still gets a quote', () => {
  it('accepts a decline after the photo was asked for', () => {
    const history = [
      ...answeredThrough(5),
      turn('outbound', 'send a photo of the spot where the charger will go'),
      turn('inbound', "I can't, I'm not at the property today"),
    ]
    const r = evaluateQuoteReadiness(base({ history }))
    expect(r.ready).toBe(true)
  })

  it('recognises the common ways of declining', () => {
    for (const reply of [
      "can't sorry",
      'I cannot right now',
      'no camera on this phone',
      'not at the property',
      "I don't have one",
    ]) {
      const history = [turn('outbound', 'send us a photo'), turn('inbound', reply)]
      expect(photoDeclined(history), reply).toBe(true)
    }
  })

  it('does not treat an unrelated negative as a photo decline', () => {
    // "no" to "is it three phase" must not silently satisfy the photo gate.
    const history = [turn('outbound', 'is the property three phase?'), turn('inbound', 'no')]
    expect(photoDeclined(history)).toBe(false)
  })

  it('does not read an answer to ANOTHER EV question as a photo decline', () => {
    // The regression this guards: "don't have" and "can't" used to match free
    // of any photo noun, and the scan anchored to ANY outbound containing the
    // word "photo" — so these literal answers to questions 2 and 5 silently
    // waived the required photo and returned EV to 5 intakes, 0 photos.
    for (const reply of [
      "I don't have the charger yet, can you supply one",
      "we don't have three phase here",
      "the switchboard is about 8 metres away but I can't be exact",
    ]) {
      const history = [
        turn('outbound', 'Send us a photo of the spot where the charger will go'),
        turn('inbound', reply),
      ]
      expect(photoDeclined(history), reply).toBe(false)
    }
  })

  it('only counts a decline that follows the photo ASK, not any mention of photos', () => {
    // Sonnet's Rule 10 heads-up puts "photo" in outbounds while other questions
    // are still being asked.
    const history = [
      turn('outbound', 'I can send you a photo link once we are done - how far is the switchboard?'),
      turn('inbound', "I can't be precise, maybe 8 metres"),
    ]
    expect(photoDeclined(history)).toBe(false)
  })

  it('ignores a decline sent BEFORE the photo was ever asked for', () => {
    const history = [turn('inbound', "I can't do that"), turn('outbound', 'send us a photo')]
    expect(photoDeclined(history)).toBe(false)
  })
})

describe('R4/M1 — asking one question must not answer its neighbours, and a rephrase must not deadlock', () => {
  it('asking question 1 leaves questions 2-5 outstanding', () => {
    // All five questions contain the word "charger". A single-shared-word rule
    // marked 2, 3 and 4 answered the moment the customer replied to 1; a
    // coverage THRESHOLD instead deadlocked on rephrased asks. Best-match
    // attribution fixes both.
    const history = [
      turn('outbound', EV_CHARGER_FALLBACK_QUESTIONS[0]),
      turn('inbound', 'l have a Tesla'),
    ]
    const r = evaluateQuoteReadiness(base({ history }))
    expect(r.missing.map((m) => m.code)).toContain('service_question:1')
  })

  it('walks the five in order, one per turn', () => {
    for (let n = 0; n < 5; n++) {
      const r = evaluateQuoteReadiness(base({ history: answeredThrough(n) }))
      const code = r.missing.find((m) => m.code.startsWith('service_question'))?.code
      expect(code, `after ${n} answers`).toBe(`service_question:${n}`)
    }
  })

  it('a rephrased ask still credits the question the customer answered', () => {
    // The LLM receptionist writes asks in its own words. A threshold scored
    // those at zero, so the question stayed missing forever and the clarify cap
    // escalated a cooperative customer to a $99 inspection.
    const history = [
      turn('outbound', 'Whereabouts is it going, garage or carport?'),
      turn('inbound', 'in the carport out the back'),
    ]
    const r = evaluateQuoteReadiness(base({ history }))
    expect(r.missing.map((m) => m.code)).not.toContain('service_question:2')
  })
})

describe('B2 — the clarify counter must survive a round trip through normaliseState', () => {
  it('carries clarify_gate_count and clarify_missing through', () => {
    // normaliseState returns a fresh literal, so any key it does not name is
    // dropped. It was dropping BOTH of these, and every read of
    // conversation_state goes through it — so the route persisted a counter and
    // a missing set, then read back 0 and [] on the very next turn. The
    // progress check could never see progress, and the R24 clarify cap could
    // never reach its limit, so the safety valve had never once fired.
    const round = normaliseState({
      slots: { job_type: 'ev_charger' },
      sources: {},
      last_extracted_at: null,
      clarify_gate_count: 3,
      clarify_missing: ['service_question:2'],
    })
    expect(round.clarify_gate_count).toBe(3)
    expect(round.clarify_missing).toEqual(['service_question:2'])
  })

  it('leaves a state that never had them untouched', () => {
    const round = normaliseState({ slots: {}, sources: {}, last_extracted_at: null })
    expect(round.clarify_gate_count).toBeUndefined()
    expect(round.clarify_missing).toBeUndefined()
  })

  it('ignores junk rather than trusting it', () => {
    const round = normaliseState({
      slots: {},
      sources: {},
      last_extracted_at: null,
      clarify_gate_count: 'many',
      clarify_missing: 'nope',
    })
    expect(round.clarify_gate_count).toBeUndefined()
    expect(round.clarify_missing).toBeUndefined()
  })
})

describe('B4/R9 — the photo link is never sent once the requirement is met', () => {
  const satisfied = (over: Record<string, unknown> = {}) =>
    shouldSendPhotoRequest({
      photoRequestToken: 'tok',
      photoRequestAlreadySent: false,
      freshIntakeId: null,
      inflightContinuation: false,
      decisionAction: 'finish',
      sonnetRequestedPhoto: false,
      offerProductChoice: false,
      jobTypeIsEasy5: true,
      ...over,
    })

  it('suppresses the finish-fallback when the photo is already in hand', () => {
    // Without this the customer who has just SENT a photo, or just told us they
    // cannot, is immediately texted an upload link.
    const out = satisfied({ photoRequirementSatisfied: true })
    expect(out.fire).toBe(false)
    expect(out.reason).toBe('photo_requirement_satisfied')
  })

  it('beats every positive trigger, including an explicit Sonnet request', () => {
    expect(satisfied({ photoRequirementSatisfied: true, sonnetRequestedPhoto: true }).fire).toBe(
      false,
    )
    expect(satisfied({ photoRequirementSatisfied: true, offerProductChoice: true }).fire).toBe(false)
  })

  it('leaves every other job type exactly as it was', () => {
    // The flag is optional and only EV sets it.
    const out = satisfied()
    expect(out.fire).toBe(true)
    expect(out.reason).toBe('finish_fallback')
  })
})

describe('R10 — EV is gated on every tenant, not just the one that enabled it', () => {
  it('still requires all five questions when no service is enabled', () => {
    // Production: the Install EV charger row is default_enabled=false and
    // exactly ONE of eight tenants has switched it on. Without this floor an EV
    // finish sails through with zero job facts on the other seven.
    const r = evaluateQuoteReadiness(base({ services: [] }))
    expect(r.ready).toBe(false)
    expect(r.missing.map((m) => m.code)).toContain('service_question:0')
    expect(r.reply).toBe(EV_CHARGER_FALLBACK_QUESTIONS[0])
  })

  it('reaches the photo gate through the fallback too', () => {
    const r = evaluateQuoteReadiness(base({ services: [], history: answeredThrough(5) }))
    expect(r.missing.map((m) => m.code)).toContain('ev_photo')
  })

  it('prefers the tenant-enabled row when there is one', () => {
    const tailored: QuoteReadinessService = {
      name: 'Install EV charger',
      category: 'ev_charger',
      always_inspection: false,
      clarifying_questions: ['Which level of the building is the carpark on?'],
    }
    const r = evaluateQuoteReadiness(base({ services: [tailored] }))
    expect(r.reply).toBe('Which level of the building is the carpark on?')
  })
})
