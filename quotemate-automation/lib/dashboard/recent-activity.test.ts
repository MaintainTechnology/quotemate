// Overview recent-activity helpers — spec: specs/dashboard-overview-quotes-sync.md
//
// Locks the contract that the Overview's "Recent quotes" feed merges the
// quotes-table rows with the measure-tool trade jobs (roofing / solar /
// painting / commercial painting) newest-first, that the attention rail
// falls back to a draft trade job, that widget fetch failures are never
// presented as "empty", and that the refresh throttle suppresses rapid
// refetches.

import { describe, it, expect } from 'vitest'
import {
  mergeRecentActivity,
  jobRowView,
  attentionCandidate,
  widgetState,
  shouldRefresh,
  type TradeJobSummary,
} from './recent-activity'

function job(over: Partial<TradeJobSummary> = {}): TradeJobSummary {
  return {
    id: 'j1',
    trade: 'roofing',
    address: '12 Test St, Chandler',
    headline: '182 m²',
    status: 'draft',
    href: '/q/roof/tok1',
    createdAt: '2026-07-01T00:00:00Z',
    ...over,
  }
}

function quote(over: Record<string, unknown> = {}) {
  return { id: 'q1', status: 'draft', created_at: '2026-07-02T00:00:00Z', ...over }
}

describe('mergeRecentActivity', () => {
  it('interleaves quotes and trade jobs strictly newest-first', () => {
    const quotes = [
      quote({ id: 'q-new', created_at: '2026-07-08T00:00:00Z' }),
      quote({ id: 'q-old', created_at: '2026-07-01T00:00:00Z' }),
    ]
    const jobs = [
      job({ id: 'j-mid', createdAt: '2026-07-05T00:00:00Z' }),
      job({ id: 'j-older', createdAt: '2026-06-20T00:00:00Z' }),
    ]
    const rows = mergeRecentActivity(quotes, jobs)
    expect(rows.map((r) => (r.kind === 'quote' ? r.quote.id : r.job.id))).toEqual([
      'q-new',
      'j-mid',
      'q-old',
      'j-older',
    ])
  })

  it('slices to 5 rows by default', () => {
    const quotes = Array.from({ length: 4 }, (_, i) =>
      quote({ id: `q${i}`, created_at: `2026-07-0${8 - i}T00:00:00Z` }),
    )
    const jobs = Array.from({ length: 4 }, (_, i) =>
      job({ id: `j${i}`, createdAt: `2026-07-0${4 - i}T00:00:00Z` }),
    )
    expect(mergeRecentActivity(quotes, jobs)).toHaveLength(5)
  })

  it('reproduces the quotes-only feed when there are no trade jobs', () => {
    const quotes = [
      quote({ id: 'q1', created_at: '2026-07-08T00:00:00Z' }),
      quote({ id: 'q2', created_at: '2026-07-07T00:00:00Z' }),
    ]
    const rows = mergeRecentActivity(quotes, [])
    expect(rows.every((r) => r.kind === 'quote')).toBe(true)
    expect(rows.map((r) => (r.kind === 'quote' ? r.quote.id : ''))).toEqual(['q1', 'q2'])
  })

  it('tolerates a null createdAt on a job (sinks to the bottom)', () => {
    const rows = mergeRecentActivity(
      [quote({ id: 'q1', created_at: '2026-07-08T00:00:00Z' })],
      [job({ id: 'j-null', createdAt: null })],
    )
    expect(rows.map((r) => (r.kind === 'quote' ? r.quote.id : r.job.id))).toEqual([
      'q1',
      'j-null',
    ])
  })
})

describe('jobRowView', () => {
  it('maps a draft roofing job to label / tone / value / href', () => {
    const v = jobRowView(job())
    expect(v.label).toBe('12 Test St, Chandler')
    expect(v.value).toBe('182 m²')
    expect(v.href).toBe('/q/roof/tok1')
    expect(v.tradeLabel).toBe('Roofing')
    expect(v.pill).toEqual({
      label: 'Awaiting you',
      tone: 'warn',
      pulse: true,
    })
  })

  it('falls back to headline then a generic label when address is missing', () => {
    expect(jobRowView(job({ address: null })).label).toBe('182 m²')
    expect(jobRowView(job({ address: null, headline: null })).label).toBe('Saved job')
  })

  it('maps confirmed → Accepted tone and inspection → Site visit tone', () => {
    expect(jobRowView(job({ status: 'confirmed' })).pill).toEqual({
      label: 'Accepted',
      tone: 'success',
      pulse: false,
    })
    expect(jobRowView(job({ status: 'inspection' })).pill).toEqual({
      label: 'Site visit',
      tone: 'dim',
      pulse: false,
    })
  })

  it('labels aircon jobs and falls back readably for unknown trades', () => {
    // 'Air-con' matches quoteTradeLabel (lib/dashboard/quote-filters.ts) so the
    // Quotes tab's chips and job rows share one vocabulary.
    expect(jobRowView(job({ trade: 'aircon' })).tradeLabel).toBe('Air-con')
    expect(jobRowView(job({ trade: 'fencing' })).tradeLabel).toBe('Fencing')
  })
})

describe('attentionCandidate', () => {
  it('prefers the first in-review quotes-table row', () => {
    const q = quote({ id: 'q-review', status: 'draft' })
    const got = attentionCandidate([quote({ id: 'q-sent', status: 'sent' }), q], [job()])
    expect(got).toEqual({ kind: 'quote', quote: q })
  })

  it('falls back to the newest draft trade job when no quote qualifies', () => {
    const newest = job({ id: 'j-new', createdAt: '2026-07-07T00:00:00Z' })
    const got = attentionCandidate(
      [quote({ status: 'sent' })],
      [job({ id: 'j-old', createdAt: '2026-07-01T00:00:00Z' }), newest, job({ id: 'j-done', status: 'confirmed', createdAt: '2026-07-08T00:00:00Z' })],
    )
    expect(got).toEqual({ kind: 'job', job: newest })
  })

  it('returns null when nothing needs attention', () => {
    expect(
      attentionCandidate([quote({ status: 'sent' })], [job({ status: 'confirmed' })]),
    ).toBeNull()
  })
})

describe('widgetState', () => {
  it('distinguishes loading / error / empty / list', () => {
    expect(widgetState(true, false, 0)).toBe('loading')
    expect(widgetState(false, false, 0)).toBe('empty')
    expect(widgetState(false, false, 3)).toBe('list')
  })

  it('never reports a failed fetch as empty', () => {
    expect(widgetState(false, true, 0)).toBe('error')
  })
})

describe('shouldRefresh', () => {
  it('suppresses a second refresh inside the 15s window', () => {
    expect(shouldRefresh(1_000_000, 1_000_000 + 14_999)).toBe(false)
  })

  it('allows a refresh after 15s and when never fetched', () => {
    expect(shouldRefresh(1_000_000, 1_000_000 + 15_000)).toBe(true)
    expect(shouldRefresh(null, 5)).toBe(true)
  })
})

// savedJobsMode / savedJobTradeKey (spec A5) are owned by
// app/dashboard/_components/saved-jobs-mode.ts and tested in its sibling
// saved-jobs-mode.test.ts — the Quotes tab consumes that module directly.
