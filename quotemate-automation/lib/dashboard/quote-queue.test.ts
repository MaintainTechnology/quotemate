// Unified Quotes-tab queue merge/filter helpers — one list for pipeline
// quotes AND measure-tool trade jobs, so the queue, its status counts and
// its trade chips agree with the Overview and the trade hubs.

import { describe, it, expect } from 'vitest'
import {
  jobQueueKey,
  jobTradeSlug,
  jobTradieCtaLabel,
  jobMatchesFilter,
  jobMatchesSearch,
  queueTradeOptions,
  compareQueueEntries,
  type QueueJob,
  type QueueEntry,
} from './quote-queue'
import { dateInRange } from './quote-filters'

const job = (over: Partial<QueueJob> = {}): QueueJob => ({
  id: 'j1',
  trade: 'roofing',
  address: '1 Smith St, Paddington',
  headline: '182 m²',
  status: 'draft',
  href: '/q/roof/tok',
  tradieHref: '/m/tok-m',
  createdAt: '2026-07-01T00:00:00Z',
  ...over,
})

describe('jobTradieCtaLabel', () => {
  it('names the tradie link by what it opens per trade', () => {
    expect(jobTradieCtaLabel(job())).toBe('Measurement results')
    expect(jobTradieCtaLabel(job({ trade: 'painting' }))).toBe('Estimate results')
    expect(jobTradieCtaLabel(job({ trade: 'solar' }))).toBe('Review & edit')
    expect(jobTradieCtaLabel(job({ trade: 'commercial-painting' }))).toBe('Review & edit')
  })
})

describe('jobQueueKey / jobTradeSlug', () => {
  it('namespaces job ids by trade', () => {
    expect(jobQueueKey(job())).toBe('job:roofing:j1')
  })

  it('maps hyphenated trades onto the quotes-table slug vocabulary', () => {
    expect(jobTradeSlug(job({ trade: 'commercial-painting' }))).toBe('commercial_painting')
    expect(jobTradeSlug(job({ trade: 'roofing' }))).toBe('roofing')
  })
})

describe('jobMatchesFilter', () => {
  it('draft jobs are awaiting the tradie → the In-review chip', () => {
    expect(jobMatchesFilter(job({ status: 'draft' }), 'review')).toBe(true)
    expect(jobMatchesFilter(job({ status: 'draft' }), 'inspect')).toBe(false)
  })

  it('inspection-routed jobs → the Inspection chip', () => {
    expect(jobMatchesFilter(job({ status: 'inspection' }), 'inspect')).toBe(true)
    expect(jobMatchesFilter(job({ status: 'inspection' }), 'review')).toBe(false)
  })

  it('confirmed jobs match only All — never the money filters', () => {
    const j = job({ status: 'confirmed' })
    expect(jobMatchesFilter(j, 'all')).toBe(true)
    expect(jobMatchesFilter(j, 'sent')).toBe(false)
    expect(jobMatchesFilter(j, 'paid')).toBe(false)
    expect(jobMatchesFilter(j, 'review')).toBe(false)
  })
})

describe('jobMatchesSearch', () => {
  it('ANDs terms across address / headline / trade label / status', () => {
    expect(jobMatchesSearch(job(), ['paddington', '182'])).toBe(true)
    expect(jobMatchesSearch(job(), ['roofing'])).toBe(true)
    expect(jobMatchesSearch(job({ trade: 'commercial-painting' }), ['commercial', 'paint'])).toBe(
      true,
    )
    expect(jobMatchesSearch(job(), ['paddington', 'nonexistent'])).toBe(false)
  })

  it('empty terms match everything', () => {
    expect(jobMatchesSearch(job({ address: null, headline: null }), [])).toBe(true)
  })
})

describe('queueTradeOptions', () => {
  it('unions quote trades with job trades, slug-normalised and sorted', () => {
    const opts = queueTradeOptions(
      ['electrical', 'roofing'],
      [job({ trade: 'commercial-painting' }), job({ trade: 'roofing' }), job({ trade: 'aircon' })],
    )
    expect(opts).toEqual(['aircon', 'commercial_painting', 'electrical', 'roofing'])
  })
})

describe('dateInRange (shared by quotes + jobs)', () => {
  it('is inclusive on both calendar-date bounds', () => {
    expect(dateInRange('2026-07-01T23:59:00Z', '2026-07-01', '2026-07-01')).toBe(true)
    expect(dateInRange('2026-07-02T00:00:00Z', '', '2026-07-01')).toBe(false)
    expect(dateInRange(null, '', '')).toBe(true)
    expect(dateInRange(null, '2026-07-01', '')).toBe(false)
  })
})

describe('compareQueueEntries', () => {
  const entry = (
    kind: 'quote' | 'job',
    at: string | null,
    value: number | null,
  ): QueueEntry<{ id: string }> =>
    kind === 'quote'
      ? { kind, key: `q-${at}-${value}`, at, value, quote: { id: 'q' } }
      : { kind, key: `j-${at}`, at, value: null, job: job() }

  it('newest first across both kinds', () => {
    const rows = [
      entry('quote', '2026-07-01T00:00:00Z', 500),
      entry('job', '2026-07-03T00:00:00Z', null),
      entry('quote', '2026-07-02T00:00:00Z', 900),
    ].sort((a, b) => compareQueueEntries(a, b, 'newest'))
    expect(rows.map((r) => r.at)).toEqual([
      '2026-07-03T00:00:00Z',
      '2026-07-02T00:00:00Z',
      '2026-07-01T00:00:00Z',
    ])
  })

  it('oldest first reverses', () => {
    const rows = [
      entry('job', '2026-07-03T00:00:00Z', null),
      entry('quote', '2026-07-01T00:00:00Z', 500),
    ].sort((a, b) => compareQueueEntries(a, b, 'oldest'))
    expect(rows[0].at).toBe('2026-07-01T00:00:00Z')
  })

  it('value sorts sink unpriced jobs below priced quotes', () => {
    const rows = [
      entry('job', '2026-07-03T00:00:00Z', null),
      entry('quote', '2026-07-01T00:00:00Z', 500),
      entry('quote', '2026-07-02T00:00:00Z', 900),
    ].sort((a, b) => compareQueueEntries(a, b, 'value_desc'))
    expect(rows.map((r) => r.value)).toEqual([900, 500, null])

    const asc = rows.slice().sort((a, b) => compareQueueEntries(a, b, 'value_asc'))
    expect(asc.map((r) => r.value)).toEqual([500, 900, null])
  })
})
