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

  it('ignores a decline sent BEFORE the photo was ever asked for', () => {
    const history = [turn('inbound', "I can't do that"), turn('outbound', 'send us a photo')]
    expect(photoDeclined(history)).toBe(false)
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
