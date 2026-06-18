import { describe, expect, it } from 'vitest'
import { evaluateQuoteReadiness } from './quote-readiness'
import type { ConversationState } from './extract-slots'

function state(slots: ConversationState['slots']): ConversationState {
  return { slots, sources: {}, last_extracted_at: null }
}

describe('evaluateQuoteReadiness', () => {
  it('does nothing unless the dialog is trying to finish', () => {
    const r = evaluateQuoteReadiness({
      action: 'ask',
      jobTypeGuess: 'downlights',
      conversationState: state({}),
    })
    expect(r.ready).toBe(true)
  })

  it('blocks a downlight quote when price-critical slots are missing', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'downlights',
      conversationState: state({
        first_name: 'Sam',
        suburb: 'Bondi',
        job_type: 'downlights',
        count: 6,
        room: 'kitchen',
      }),
    })
    expect(r.ready).toBe(false)
    expect(r.missing.map((m) => m.code)).toContain('ceiling_type')
    expect(r.reply).toMatch(/ceiling type/i)
  })

  it('allows a complete downlight quote to finish', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'downlights',
      conversationState: state({
        first_name: 'Sam',
        suburb: 'Bondi',
        job_type: 'downlights',
        count: 6,
        room: 'kitchen',
        ceiling_type: 'flat_plaster',
        replace_or_new: 'replace',
        colour: 'warm white',
      }),
    })
    expect(r.ready).toBe(true)
    expect(r.missing).toEqual([])
  })

  it('requires GPO wet-area clearance before quoting', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'power_points',
      conversationState: state({
        first_name: 'Mia',
        suburb: 'Newtown',
        job_type: 'power_points',
        count: 1,
        room: 'laundry',
        replace_or_new: 'replace',
      }),
      history: [
        { direction: 'inbound', body: 'I need one power point in the laundry' },
        { direction: 'inbound', body: 'Replacing existing' },
      ],
    })
    expect(r.ready).toBe(false)
    expect(r.missing.map((m) => m.code)).toContain('wet_area_clearance')
  })

  it('requires distance to existing power for a new GPO run', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'power_points',
      conversationState: state({
        first_name: 'Mia',
        suburb: 'Newtown',
        job_type: 'power_points',
        count: 1,
        room: 'garage',
        replace_or_new: 'new',
      }),
      history: [{ direction: 'inbound', body: 'new GPO in garage' }],
    })
    expect(r.ready).toBe(false)
    expect(r.missing.map((m) => m.code)).toContain('distance_to_existing_power')
  })

  it('blocks a matched custom service until its required question is answered', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'unknown',
      conversationState: state({
        first_name: 'Jon',
        suburb: 'Chandler',
        job_type: 'unknown',
      }),
      services: [
        {
          name: 'Install dishwasher',
          description: null,
          always_inspection: false,
          clarifying_questions: ['Is there an existing isolation valve under the sink?'],
        },
      ],
      history: [{ direction: 'inbound', body: 'Need a dishwasher installed in Chandler' }],
    })
    expect(r.ready).toBe(false)
    expect(r.reply).toMatch(/isolation valve/i)
  })

  it('allows a matched custom service once its required question has an answer', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'unknown',
      conversationState: state({
        first_name: 'Jon',
        suburb: 'Chandler',
        job_type: 'unknown',
      }),
      services: [
        {
          name: 'Install dishwasher',
          description: null,
          always_inspection: false,
          clarifying_questions: ['Is there an existing isolation valve under the sink?'],
        },
      ],
      history: [
        { direction: 'inbound', body: 'Need a dishwasher installed in Chandler' },
        { direction: 'outbound', body: 'Is there an existing isolation valve under the sink?' },
        { direction: 'inbound', body: 'Yes there is one under the sink' },
      ],
    })
    expect(r.ready).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════
// R24 — every easy-set job type's MUST-ASK fields must be answered before
// the deterministic gate lets a finish through. One representative
// "missing" + "complete" pair per job type, exercised through the same
// public evaluateQuoteReadiness entry point the route uses.
// ════════════════════════════════════════════════════════════════════
describe('R24 — finish blocked until every per-job MUST-ASK is answered', () => {
  const base = { first_name: 'Sam', suburb: 'Bondi' }

  it('ceiling_fans: blocks without supply mode, allows once stated', () => {
    const blocked = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'ceiling_fans',
      conversationState: state({ ...base, job_type: 'ceiling_fans', count: 2, room: 'bedroom' }),
    })
    expect(blocked.ready).toBe(false)
    expect(blocked.missing.map((m) => m.code)).toContain('supplied_by')

    const ok = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'ceiling_fans',
      conversationState: state({
        ...base, job_type: 'ceiling_fans', count: 2, room: 'bedroom', supplied_by: 'tradie',
      }),
    })
    expect(ok.ready).toBe(true)
  })

  it('outdoor_lighting: blocks without sensor choice, allows once stated in transcript', () => {
    const blocked = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'outdoor_lighting',
      conversationState: state({ ...base, job_type: 'outdoor_lighting', count: 3, room: 'eaves' }),
      history: [{ direction: 'inbound', body: '3 lights under the eaves' }],
    })
    expect(blocked.ready).toBe(false)
    expect(blocked.missing.map((m) => m.code)).toContain('sensor')

    const ok = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'outdoor_lighting',
      conversationState: state({ ...base, job_type: 'outdoor_lighting', count: 3, room: 'eaves' }),
      history: [
        { direction: 'inbound', body: '3 lights under the eaves' },
        { direction: 'inbound', body: 'on a motion sensor please' },
      ],
    })
    expect(ok.ready).toBe(true)
  })

  it('blocked_drain: blocks without severity, allows once stated', () => {
    const blocked = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'blocked_drain',
      // Room stated, but the customer never said how severe — no severity
      // word in the transcript, so blockage_severity is still missing.
      conversationState: state({ ...base, job_type: 'blocked_drain', room: 'kitchen' }),
      history: [{ direction: 'inbound', body: 'the kitchen sink drain is playing up' }],
    })
    expect(blocked.ready).toBe(false)
    expect(blocked.missing.map((m) => m.code)).toContain('blockage_severity')

    const ok = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'blocked_drain',
      conversationState: state({ ...base, job_type: 'blocked_drain', room: 'kitchen' }),
      history: [{ direction: 'inbound', body: 'kitchen sink, completely blocked, water not going down' }],
    })
    expect(ok.ready).toBe(true)
  })

  it('hot_water: blocks until energy source + size + location are present', () => {
    const blocked = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'hot_water',
      conversationState: state({ ...base, job_type: 'hot_water' }),
      history: [{ direction: 'inbound', body: 'my hot water died' }],
    })
    expect(blocked.ready).toBe(false)
    const codes = blocked.missing.map((m) => m.code)
    expect(codes).toContain('energy_source')

    const ok = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'hot_water',
      conversationState: state({ ...base, job_type: 'hot_water', room: 'laundry' }),
      history: [{ direction: 'inbound', body: '250L electric hot water in the laundry' }],
    })
    expect(ok.ready).toBe(true)
  })

  it('tap_replace: blocks without supply mode, allows once stated', () => {
    const blocked = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'tap_replace',
      conversationState: state({ ...base, job_type: 'tap_replace', room: 'kitchen' }),
      history: [{ direction: 'inbound', body: 'replace the kitchen mixer' }],
    })
    expect(blocked.ready).toBe(false)
    expect(blocked.missing.map((m) => m.code)).toContain('supplied_by')

    const ok = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'tap_replace',
      conversationState: state({
        ...base, job_type: 'tap_replace', room: 'kitchen', supplied_by: 'tradie',
      }),
      history: [{ direction: 'inbound', body: 'replace the kitchen mixer' }],
    })
    expect(ok.ready).toBe(true)
  })

  it('does not block when the dialog is only asking (gate is finish-only)', () => {
    const r = evaluateQuoteReadiness({
      action: 'ask',
      jobTypeGuess: 'downlights',
      conversationState: state({ ...base, job_type: 'downlights' }),
    })
    expect(r.ready).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════
// R25 — conditional + classifier questions.
// ════════════════════════════════════════════════════════════════════
describe('R25 — power_points 600mm wet-area question is conditional on room', () => {
  const base = { first_name: 'Mia', suburb: 'Newtown', job_type: 'power_points' as const, replace_or_new: 'replace' as const }

  it('FIRES the wet-area clearance question in a wet room (kitchen)', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'power_points',
      conversationState: state({ ...base, count: 1, room: 'kitchen' }),
      history: [{ direction: 'inbound', body: 'one GPO replaced in the kitchen' }],
    })
    expect(r.ready).toBe(false)
    expect(r.missing.map((m) => m.code)).toContain('wet_area_clearance')
  })

  it.each(['bathroom', 'ensuite', 'laundry', 'kitchen'])(
    'FIRES the wet-area clearance question in wet room: %s',
    (room) => {
      const r = evaluateQuoteReadiness({
        action: 'finish',
        jobTypeGuess: 'power_points',
        conversationState: state({ ...base, count: 1, room }),
        history: [{ direction: 'inbound', body: `one GPO replaced in the ${room}` }],
      })
      expect(r.missing.map((m) => m.code)).toContain('wet_area_clearance')
    },
  )

  it('does NOT fire the wet-area clearance question in a dry room (garage)', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'power_points',
      conversationState: state({ ...base, count: 1, room: 'garage' }),
      history: [{ direction: 'inbound', body: 'one GPO replaced in the garage' }],
    })
    expect(r.ready).toBe(true)
    expect(r.missing.map((m) => m.code)).not.toContain('wet_area_clearance')
  })

  it('does NOT fire again once the clearance is confirmed in the transcript', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'power_points',
      conversationState: state({ ...base, count: 1, room: 'bathroom' }),
      history: [
        { direction: 'inbound', body: 'one GPO in the bathroom' },
        { direction: 'inbound', body: "yeah it's more than 600mm away from the basin" },
      ],
    })
    expect(r.ready).toBe(true)
    expect(r.missing.map((m) => m.code)).not.toContain('wet_area_clearance')
  })
})

describe('R25 — smoke_alarms classifier (swap vs compliance) asked before finish', () => {
  const base = { first_name: 'Kim', suburb: 'Marrickville', job_type: 'smoke_alarms' as const }

  it('blocks finish and asks the classifier first when nothing classifies the scope', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'smoke_alarms',
      conversationState: state({ ...base }),
      history: [{ direction: 'inbound', body: 'need smoke alarms done' }],
    })
    expect(r.ready).toBe(false)
    // smoke_class is the FIRST required fact → it is the question surfaced.
    expect(r.missing[0].code).toBe('smoke_class')
    expect(r.reply).toMatch(/like-for-like swap|compliance hardwire/i)
  })

  it('classifier satisfied by the replace_or_new slot (like-for-like swap)', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'smoke_alarms',
      conversationState: state({ ...base, replace_or_new: 'replace', count: 3 }),
      history: [{ direction: 'inbound', body: 'swapping the 3 old ones' }],
    })
    expect(r.ready).toBe(true)
    expect(r.missing.map((m) => m.code)).not.toContain('smoke_class')
  })

  it('classifier satisfied by compliance language in the transcript', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'smoke_alarms',
      conversationState: state({ ...base, count: 4 }),
      history: [
        { direction: 'inbound', body: 'need smoke alarms' },
        { direction: 'inbound', body: 'full property compliance hardwire, 4 bedrooms' },
      ],
    })
    expect(r.ready).toBe(true)
    expect(r.missing.map((m) => m.code)).not.toContain('smoke_class')
  })

  it('still blocks on count even after the classifier is answered', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'smoke_alarms',
      conversationState: state({ ...base, replace_or_new: 'replace' }),
      history: [{ direction: 'inbound', body: 'just a like-for-like swap' }],
    })
    expect(r.ready).toBe(false)
    expect(r.missing.map((m) => m.code)).toContain('count')
  })
})

// ════════════════════════════════════════════════════════════════════
// R24 — robust answered-detection (no brittle false-"missing" loops),
// while never letting a finish through with a mandatory field unanswered.
// ════════════════════════════════════════════════════════════════════
describe('R24 — robust answered-detection', () => {
  it('count satisfied from the transcript when the slot lags (digit + noun)', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'downlights',
      conversationState: state({
        first_name: 'Sam', suburb: 'Bondi', job_type: 'downlights',
        room: 'kitchen', ceiling_type: 'flat_plaster', replace_or_new: 'replace', colour: 'warm white',
        // count slot NOT set — must be recovered from the transcript.
      }),
      history: [{ direction: 'inbound', body: 'need 6 downlights in the kitchen' }],
    })
    expect(r.ready).toBe(true)
    expect(r.missing.map((m) => m.code)).not.toContain('count')
  })

  it('count satisfied from a word-quantity in the transcript ("half a dozen")', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'downlights',
      conversationState: state({
        first_name: 'Sam', suburb: 'Bondi', job_type: 'downlights',
        room: 'kitchen', ceiling_type: 'flat_plaster', replace_or_new: 'replace', colour: 'warm white',
      }),
      history: [{ direction: 'inbound', body: 'half a dozen downlights please' }],
    })
    expect(r.missing.map((m) => m.code)).not.toContain('count')
  })

  it('count STILL reported missing when no quantity was ever stated (hard guarantee)', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'downlights',
      conversationState: state({
        first_name: 'Sam', suburb: 'Bondi', job_type: 'downlights',
        room: 'kitchen', ceiling_type: 'flat_plaster', replace_or_new: 'replace', colour: 'warm white',
      }),
      history: [{ direction: 'inbound', body: 'some downlights in the kitchen' }],
    })
    expect(r.ready).toBe(false)
    expect(r.missing.map((m) => m.code)).toContain('count')
  })

  it('custom-service question counts as answered when the customer addressed the topic despite a rephrased ask (no loop)', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'unknown',
      conversationState: state({ first_name: 'Jon', suburb: 'Chandler', job_type: 'unknown' }),
      services: [{
        name: 'Install dishwasher',
        description: null,
        always_inspection: false,
        clarifying_questions: ['Is there an existing isolation valve under the sink?'],
      }],
      history: [
        { direction: 'inbound', body: 'Need a dishwasher installed in Chandler' },
        // The dialog REPHRASED — no stored-question keywords in the outbound.
        { direction: 'outbound', body: "Quick one - can the water be shut off easily under there?" },
        // Customer addresses the topic directly.
        { direction: 'inbound', body: 'there is an isolation valve already' },
      ],
    })
    expect(r.ready).toBe(true)
  })

  it('custom-service question STILL reported missing when never addressed (hard guarantee)', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'unknown',
      conversationState: state({ first_name: 'Jon', suburb: 'Chandler', job_type: 'unknown' }),
      services: [{
        name: 'Install dishwasher',
        description: null,
        always_inspection: false,
        clarifying_questions: ['Is there an existing isolation valve under the sink?'],
      }],
      history: [
        { direction: 'inbound', body: 'Need a dishwasher installed in Chandler' },
        { direction: 'inbound', body: 'as soon as possible thanks' },
      ],
    })
    expect(r.ready).toBe(false)
    expect(r.reply).toMatch(/isolation valve/i)
  })
})

// ════════════════════════════════════════════════════════════════════
// FIX 1 (R29) — decline-escape for slot-backed MUST-ASK fields.
// A natural-language decline ("whatever you reckon", "you decide",
// "don't care", "up to you") on the LATEST inbound waives colour /
// supplied_by / replace_or_new so finish proceeds (safe default applies).
// A field the customer NEVER addressed (slot empty, no decline) still
// blocks — the over-block is gone, the hard guarantee is intact.
// ════════════════════════════════════════════════════════════════════
describe('FIX 1 (R29) — decline-escape on slot-backed MUST-ASK fields', () => {
  const base = { first_name: 'Sam', suburb: 'Bondi' }

  it('downlights: a "whatever you reckon" decline lets finish through (colour waived)', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'downlights',
      conversationState: state({
        ...base, job_type: 'downlights', count: 6, room: 'kitchen',
        ceiling_type: 'flat_plaster', replace_or_new: 'replace',
        // colour slot intentionally unset — decline must waive it.
      }),
      history: [
        { direction: 'inbound', body: 'need 6 downlights in the kitchen' },
        { direction: 'outbound', body: 'Any colour preference - warm white, cool white, or no preference?' },
        { direction: 'inbound', body: 'whatever you reckon mate' },
      ],
    })
    expect(r.ready).toBe(true)
    expect(r.missing.map((m) => m.code)).not.toContain('colour')
  })

  it.each(["you decide", "don't care", 'up to you', 'no preference', 'either is fine'])(
    'downlights: decline phrasing "%s" waives the colour MUST-ASK',
    (phrase) => {
      const r = evaluateQuoteReadiness({
        action: 'finish',
        jobTypeGuess: 'downlights',
        conversationState: state({
          ...base, job_type: 'downlights', count: 6, room: 'kitchen',
          ceiling_type: 'flat_plaster', replace_or_new: 'replace',
        }),
        history: [
          { direction: 'inbound', body: '6 downlights in the kitchen' },
          { direction: 'outbound', body: 'Any colour preference?' },
          { direction: 'inbound', body: phrase },
        ],
      })
      expect(r.missing.map((m) => m.code)).not.toContain('colour')
    },
  )

  it('ceiling_fans: a decline waives supplied_by so finish proceeds', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'ceiling_fans',
      conversationState: state({ ...base, job_type: 'ceiling_fans', count: 2, room: 'bedroom' }),
      history: [
        { direction: 'inbound', body: '2 fans in the bedroom' },
        { direction: 'outbound', body: 'Do you have the fan or shall we supply it?' },
        { direction: 'inbound', body: 'up to you, you pick' },
      ],
    })
    expect(r.ready).toBe(true)
    expect(r.missing.map((m) => m.code)).not.toContain('supplied_by')
  })

  it('NEGATIVE: silence / irrelevant latest reply still blocks the unanswered field', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'downlights',
      conversationState: state({
        ...base, job_type: 'downlights', count: 6, room: 'kitchen',
        ceiling_type: 'flat_plaster', replace_or_new: 'replace',
      }),
      history: [
        { direction: 'inbound', body: '6 downlights in the kitchen' },
        { direction: 'outbound', body: 'Any colour preference?' },
        // Irrelevant reply — no decline, no colour stated.
        { direction: 'inbound', body: 'how soon can you come out?' },
      ],
    })
    expect(r.ready).toBe(false)
    expect(r.missing.map((m) => m.code)).toContain('colour')
  })

  it('NEGATIVE: a stale earlier decline does NOT waive a later, still-unanswered field', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'downlights',
      conversationState: state({
        ...base, job_type: 'downlights', count: 6, room: 'kitchen',
        ceiling_type: 'flat_plaster', replace_or_new: 'replace',
      }),
      history: [
        { direction: 'inbound', body: 'whatever you reckon on the colour' },
        { direction: 'outbound', body: 'No worries. Anything else?' },
        // Latest inbound is NOT a decline — earlier decline must not carry over.
        { direction: 'inbound', body: 'actually can you do it next week?' },
      ],
    })
    // Decline was scoped to the latest inbound only, which is not a decline,
    // so colour (slot empty) is genuinely unanswered again → still blocks.
    expect(r.ready).toBe(false)
    expect(r.missing.map((m) => m.code)).toContain('colour')
  })
})

// ════════════════════════════════════════════════════════════════════
// FIX 2 (R26/E8) — hot_water unknown-fuel no longer loops.
// "not sure" / "don't know" on the fuel STOPS the energy_source re-ask so
// finish proceeds and the downstream structure.ts E8 backstop escalates to
// inspection. A stated fuel still satisfies; a totally-missing fuel still
// blocks.
// ════════════════════════════════════════════════════════════════════
describe('FIX 2 (R26/E8) — hot_water unknown-fuel stops the energy_source loop', () => {
  const base = { first_name: 'Pat', suburb: 'Coorparoo' }

  it.each(['not sure', "don't know", 'dunno', 'no idea', 'not certain', 'unsure'])(
    'unknown-fuel reply "%s" no longer blocks finish on energy_source',
    (phrase) => {
      const r = evaluateQuoteReadiness({
        action: 'finish',
        jobTypeGuess: 'hot_water',
        conversationState: state({ ...base, job_type: 'hot_water', room: 'laundry' }),
        history: [
          { direction: 'inbound', body: 'my hot water unit died, 250L in the laundry' },
          { direction: 'outbound', body: 'What type is it - electric, gas, heat pump, or not sure?' },
          { direction: 'inbound', body: phrase },
        ],
      })
      expect(r.missing.map((m) => m.code)).not.toContain('energy_source')
      expect(r.ready).toBe(true)
    },
  )

  it('a stated fuel still satisfies energy_source normally', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'hot_water',
      conversationState: state({ ...base, job_type: 'hot_water', room: 'laundry' }),
      history: [{ direction: 'inbound', body: '250L electric hot water in the laundry' }],
    })
    expect(r.ready).toBe(true)
    expect(r.missing.map((m) => m.code)).not.toContain('energy_source')
  })

  it('NEGATIVE: a totally-missing fuel (no mention at all) still blocks finish', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'hot_water',
      conversationState: state({ ...base, job_type: 'hot_water', room: 'laundry' }),
      // Size + location present, but fuel never raised and not declined.
      history: [{ direction: 'inbound', body: '250L unit in the laundry, needs replacing' }],
    })
    expect(r.ready).toBe(false)
    expect(r.missing.map((m) => m.code)).toContain('energy_source')
  })
})

// ════════════════════════════════════════════════════════════════════
// FIX 3 (R25) — wet-area clearance affirmation + smoke bare-bedrooms.
// ════════════════════════════════════════════════════════════════════
describe('FIX 3 (R25) — wet-area clearance affirmative breaks the re-ask loop', () => {
  const base = { first_name: 'Mia', suburb: 'Newtown', job_type: 'power_points' as const, replace_or_new: 'replace' as const }

  it('an affirmative to the asked clearance question (no keywords) satisfies it', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'power_points',
      conversationState: state({ ...base, count: 1, room: 'bathroom' }),
      history: [
        { direction: 'inbound', body: 'one GPO in the bathroom' },
        { direction: 'outbound', body: 'Because it is a wet area, is the GPO at least 600mm from any basin, sink, shower or bath?' },
        // Affirmation that lacks WET_CLEARANCE_RE's narrow keyword set.
        { direction: 'inbound', body: "yeah it's well clear of all that" },
      ],
    })
    expect(r.ready).toBe(true)
    expect(r.missing.map((m) => m.code)).not.toContain('wet_area_clearance')
  })

  it('NEGATIVE: a flat "no" to the clearance question keeps blocking (genuinely inspection-bound)', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'power_points',
      conversationState: state({ ...base, count: 1, room: 'bathroom' }),
      history: [
        { direction: 'inbound', body: 'one GPO in the bathroom' },
        { direction: 'outbound', body: 'Because it is a wet area, is the GPO at least 600mm from any basin, sink, shower or bath?' },
        { direction: 'inbound', body: 'no' },
      ],
    })
    expect(r.ready).toBe(false)
    expect(r.missing.map((m) => m.code)).toContain('wet_area_clearance')
  })

  it('NEGATIVE: a bare "yes" with NO prior clearance ask does not waive the check', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'power_points',
      conversationState: state({ ...base, count: 1, room: 'bathroom' }),
      history: [
        { direction: 'inbound', body: 'one GPO in the bathroom' },
        // An unrelated outbound, then a bare yes — the clearance was never asked.
        { direction: 'outbound', body: 'Great, and is this replacing an existing point?' },
        { direction: 'inbound', body: 'yes' },
      ],
    })
    expect(r.ready).toBe(false)
    expect(r.missing.map((m) => m.code)).toContain('wet_area_clearance')
  })
})

describe('FIX 3 (R25) — smoke classifier ignores a bare bedrooms (location) mention', () => {
  const base = { first_name: 'Kim', suburb: 'Marrickville', job_type: 'smoke_alarms' as const }

  it('NEGATIVE: a bare "in the bedrooms" location does NOT satisfy the classifier', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'smoke_alarms',
      conversationState: state({ ...base, count: 3 }),
      history: [
        { direction: 'inbound', body: 'need smoke alarms done' },
        { direction: 'inbound', body: "they're in the bedrooms" },
      ],
    })
    expect(r.ready).toBe(false)
    expect(r.missing.map((m) => m.code)).toContain('smoke_class')
  })

  it('a counted "4 bedrooms" still satisfies the compliance classifier', () => {
    const r = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'smoke_alarms',
      conversationState: state({ ...base, count: 4 }),
      history: [
        { direction: 'inbound', body: 'need smoke alarms' },
        { direction: 'inbound', body: 'full house, 4 bedrooms' },
      ],
    })
    expect(r.ready).toBe(true)
    expect(r.missing.map((m) => m.code)).not.toContain('smoke_class')
  })
})
