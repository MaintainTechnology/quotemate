import { describe, it, expect } from 'vitest'
import {
  smokeTestServiceRow,
  type SmokeContext,
  type SmokeTradeContext,
} from './smoke'

// A representative electrical trade context. The candidate pool includes
// the service under test so its service-fee line grounds against its own
// (about-to-be-committed) row — exactly how it behaves once live.
function tradeCtx(
  candidateAssemblies: { name: string; price: number; category?: string }[],
): SmokeTradeContext {
  return {
    defaults: {
      hourly_rate: 110,
      apprentice_rate: 65,
      senior_rate: 160,
      call_out_minimum: 150,
      default_markup_pct: 28,
      min_labour_hours: 2,
    },
    candidateAssemblies,
    candidateMaterials: [],
  }
}

function ctxWith(
  candidateAssemblies: { name: string; price: number; category?: string }[],
): SmokeContext {
  return { byTrade: new Map([['electrical', tradeCtx(candidateAssemblies)]]) }
}

const okRow = {
  trade: 'electrical',
  name: 'Install LED downlight',
  default_unit: 'each',
  default_unit_price_ex_gst: 50,
  default_labour_hours: 1.5,
  category: 'downlight',
  clarifying_questions: ['How many downlights?'],
}

describe('smokeTestServiceRow', () => {
  it('passes a well-formed service that grounds against its own row', () => {
    const res = smokeTestServiceRow(okRow, ctxWith([{ name: okRow.name, price: 50 }]))
    expect(res.status).toBe('passed')
    expect(res.reason).toBeNull()
  })

  it('passes when clarifying questions are absent (zero is valid, §9 rule 5)', () => {
    const { clarifying_questions, ...noQuestions } = okRow
    void clarifying_questions
    const res = smokeTestServiceRow(noQuestions, ctxWith([{ name: okRow.name, price: 50 }]))
    expect(res.status).toBe('passed')
  })

  it('fails a service for a trade with no pricing defaults', () => {
    const res = smokeTestServiceRow(
      { ...okRow, trade: 'tiling' },
      ctxWith([{ name: okRow.name, price: 50 }]),
    )
    expect(res.status).toBe('failed')
    expect(res.reason).toMatch(/no pricing defaults/i)
  })

  it('fails a service whose fee is zero or negative', () => {
    const res = smokeTestServiceRow(
      { ...okRow, default_unit_price_ex_gst: 0 },
      ctxWith([{ name: okRow.name, price: 50 }]),
    )
    expect(res.status).toBe('failed')
    expect(res.reason).toMatch(/positive number/i)
  })

  it('fails a service with negative labour hours', () => {
    const res = smokeTestServiceRow(
      { ...okRow, default_labour_hours: -1 },
      ctxWith([{ name: okRow.name, price: 50 }]),
    )
    expect(res.status).toBe('failed')
    expect(res.reason).toMatch(/labour hours/i)
  })

  it('fails a service with a blank clarifying question', () => {
    const res = smokeTestServiceRow(
      { ...okRow, clarifying_questions: ['How many?', '   '] },
      ctxWith([{ name: okRow.name, price: 50 }]),
    )
    expect(res.status).toBe('failed')
    expect(res.reason).toMatch(/blank|not text/i)
  })

  it('fails a service with a non-list clarifying_questions payload', () => {
    const res = smokeTestServiceRow(
      { ...okRow, clarifying_questions: 'How many?' },
      ctxWith([{ name: okRow.name, price: 50 }]),
    )
    expect(res.status).toBe('failed')
    expect(res.reason).toMatch(/not a list/i)
  })

  it('fails when the sample quote cannot ground (no matching candidate)', () => {
    // Empty candidate pool — the service-fee line has nothing to ground to.
    const res = smokeTestServiceRow(okRow, ctxWith([]))
    expect(res.status).toBe('failed')
    expect(res.reason).toMatch(/would not ground/i)
  })

  it('grounds a brand-new-trade service via the general category fallback', () => {
    // A trade whose category vocabulary the validator regex does not know:
    // categorise() returns {general} for both the row and the quote line,
    // so the service still grounds.
    const tilingCtx: SmokeContext = {
      byTrade: new Map([
        [
          'tiling',
          {
            defaults: {
              hourly_rate: 95,
              apprentice_rate: 55,
              senior_rate: null,
              call_out_minimum: 120,
              default_markup_pct: 20,
              min_labour_hours: 2,
            },
            candidateAssemblies: [{ name: 'Lay floor tiles', price: 80 }],
            candidateMaterials: [],
          },
        ],
      ]),
    }
    const res = smokeTestServiceRow(
      {
        trade: 'tiling',
        name: 'Lay floor tiles',
        default_unit: 'each',
        default_unit_price_ex_gst: 80,
        default_labour_hours: 3,
        category: 'floor_tiling',
        clarifying_questions: ['Floor area in m2?'],
      },
      tilingCtx,
    )
    expect(res.status).toBe('passed')
  })
})
