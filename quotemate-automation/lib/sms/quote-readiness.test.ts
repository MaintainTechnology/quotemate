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
