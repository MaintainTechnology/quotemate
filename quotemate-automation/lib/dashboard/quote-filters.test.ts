import { describe, it, expect } from 'vitest'
import {
  parseSearchTerms,
  quoteMatchesSearch,
  quoteInDateRange,
  quoteMatchesTrade,
  tradeOptionsFromQuotes,
  quoteTradeLabel,
  type FilterableQuote,
} from './quote-filters'

function makeQuote(overrides: Partial<FilterableQuote> = {}): FilterableQuote {
  return {
    created_at: '2026-06-01T09:30:00.000Z',
    trade: 'electrical',
    status: 'draft',
    customer_full_name: 'Jane Smith',
    customer_first_name: 'Jane',
    suburb: 'Paddington',
    job_type: 'downlights',
    scope_of_works: 'Replace 6 downlights in the kitchen',
    share_token: 'QM-ABC123',
    ...overrides,
  }
}

describe('parseSearchTerms', () => {
  it('lower-cases, trims, and splits on whitespace', () => {
    expect(parseSearchTerms('  Downlight   Paddington ')).toEqual(['downlight', 'paddington'])
  })
  it('returns an empty array for a blank query', () => {
    expect(parseSearchTerms('   ')).toEqual([])
    expect(parseSearchTerms('')).toEqual([])
  })
})

describe('quoteMatchesSearch', () => {
  it('matches everything when there are no terms', () => {
    expect(quoteMatchesSearch(makeQuote(), [])).toBe(true)
  })

  it('matches across customer, suburb, job, trade and scope fields', () => {
    const q = makeQuote()
    expect(quoteMatchesSearch(q, ['jane'])).toBe(true)
    expect(quoteMatchesSearch(q, ['paddington'])).toBe(true)
    expect(quoteMatchesSearch(q, ['downlights'])).toBe(true)
    expect(quoteMatchesSearch(q, ['electrical'])).toBe(true)
    expect(quoteMatchesSearch(q, ['kitchen'])).toBe(true)
  })

  it('matches the share code (case-insensitive)', () => {
    expect(quoteMatchesSearch(makeQuote(), ['qm-abc123'])).toBe(true)
  })

  it('ANDs multiple terms — every term must appear', () => {
    const q = makeQuote()
    expect(quoteMatchesSearch(q, ['jane', 'paddington'])).toBe(true)
    expect(quoteMatchesSearch(q, ['jane', 'nonexistent'])).toBe(false)
  })

  it('tolerates null fields without throwing', () => {
    const q = makeQuote({
      customer_full_name: null,
      customer_first_name: null,
      suburb: null,
      job_type: null,
      scope_of_works: null,
      share_token: null,
      trade: null,
      status: null,
    })
    expect(quoteMatchesSearch(q, ['anything'])).toBe(false)
    expect(quoteMatchesSearch(q, [])).toBe(true)
  })
})

describe('quoteInDateRange', () => {
  const q = makeQuote({ created_at: '2026-06-15T12:00:00.000Z' })

  it('matches when both bounds are empty', () => {
    expect(quoteInDateRange(q, '', '')).toBe(true)
  })

  it('respects an open-ended lower bound (from only)', () => {
    expect(quoteInDateRange(q, '2026-06-01', '')).toBe(true)
    expect(quoteInDateRange(q, '2026-07-01', '')).toBe(false)
  })

  it('respects an open-ended upper bound (to only)', () => {
    expect(quoteInDateRange(q, '', '2026-06-30')).toBe(true)
    expect(quoteInDateRange(q, '', '2026-06-01')).toBe(false)
  })

  it('is inclusive on both boundary dates', () => {
    expect(quoteInDateRange(q, '2026-06-15', '2026-06-15')).toBe(true)
  })

  it('excludes quotes outside a closed range', () => {
    expect(quoteInDateRange(q, '2026-06-16', '2026-06-30')).toBe(false)
    expect(quoteInDateRange(q, '2026-05-01', '2026-06-14')).toBe(false)
  })

  it('excludes a quote with no created_at once a bound is set', () => {
    const noDate = makeQuote({ created_at: null })
    expect(quoteInDateRange(noDate, '2026-06-01', '')).toBe(false)
    expect(quoteInDateRange(noDate, '', '')).toBe(true)
  })
})

describe('quoteMatchesTrade', () => {
  it('matches everything for "all"', () => {
    expect(quoteMatchesTrade(makeQuote({ trade: 'plumbing' }), 'all')).toBe(true)
  })
  it('matches an exact trade (case-insensitive)', () => {
    expect(quoteMatchesTrade(makeQuote({ trade: 'Electrical' }), 'electrical')).toBe(true)
    expect(quoteMatchesTrade(makeQuote({ trade: 'plumbing' }), 'electrical')).toBe(false)
  })
  it('never matches a specific trade when the quote trade is null', () => {
    expect(quoteMatchesTrade(makeQuote({ trade: null }), 'electrical')).toBe(false)
    expect(quoteMatchesTrade(makeQuote({ trade: null }), 'all')).toBe(true)
  })
})

describe('tradeOptionsFromQuotes', () => {
  it('returns distinct, sorted, lower-cased trade slugs', () => {
    const quotes = [
      makeQuote({ trade: 'plumbing' }),
      makeQuote({ trade: 'Electrical' }),
      makeQuote({ trade: 'electrical' }),
      makeQuote({ trade: 'roofing' }),
    ]
    expect(tradeOptionsFromQuotes(quotes)).toEqual(['electrical', 'plumbing', 'roofing'])
  })
  it('ignores null / empty trades', () => {
    const quotes = [makeQuote({ trade: null }), makeQuote({ trade: '' }), makeQuote({ trade: 'solar' })]
    expect(tradeOptionsFromQuotes(quotes)).toEqual(['solar'])
  })
  it('returns an empty array for no quotes', () => {
    expect(tradeOptionsFromQuotes([])).toEqual([])
  })
})

describe('quoteTradeLabel', () => {
  it('uses curated labels for known trades', () => {
    expect(quoteTradeLabel('electrical')).toBe('Electrical')
    expect(quoteTradeLabel('commercial_painting')).toBe('Commercial paint')
    expect(quoteTradeLabel('aircon')).toBe('Air-con')
  })
  it('title-cases and de-underscores unknown slugs', () => {
    expect(quoteTradeLabel('carpentry')).toBe('Carpentry')
    expect(quoteTradeLabel('metal_fabrication')).toBe('Metal fabrication')
  })
  it('returns an empty string unchanged', () => {
    expect(quoteTradeLabel('')).toBe('')
  })
})

describe('integration — combined filter pipeline', () => {
  const quotes = [
    makeQuote({ trade: 'electrical', suburb: 'Paddington', created_at: '2026-06-01T00:00:00Z', share_token: 'QM-E1' }),
    makeQuote({ trade: 'plumbing', suburb: 'Newtown', created_at: '2026-06-10T00:00:00Z', share_token: 'QM-P1' }),
    makeQuote({ trade: 'plumbing', suburb: 'Paddington', created_at: '2026-06-20T00:00:00Z', share_token: 'QM-P2' }),
  ]

  function run(tradeSel: string, from: string, to: string, terms: string[]) {
    return quotes
      .filter((q) => quoteMatchesTrade(q, tradeSel))
      .filter((q) => quoteInDateRange(q, from, to))
      .filter((q) => quoteMatchesSearch(q, terms))
  }

  it('applies trade + date + search together (AND)', () => {
    const result = run('plumbing', '2026-06-15', '', parseSearchTerms('paddington'))
    expect(result.map((q) => q.share_token)).toEqual(['QM-P2'])
  })

  it('returns all quotes when nothing is constrained', () => {
    expect(run('all', '', '', []).length).toBe(3)
  })

  it('can yield zero matches', () => {
    expect(run('electrical', '2026-06-15', '', []).length).toBe(0)
  })
})
