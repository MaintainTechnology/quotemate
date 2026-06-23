import { describe, it, expect } from 'vitest'
import { aggregateByJobType, hintFor } from './analytics'
import type { AnalyticsInputRow } from './types'

const rows: AnalyticsInputRow[] = [
  { job_type: 'downlights', trade: 'electrical', price_inc_gst: 110, price_ex_gst: 100, quoted_at: '2026-01-10', status: 'confirmed' },
  { job_type: 'downlights', trade: 'electrical', price_inc_gst: 220, price_ex_gst: 200, quoted_at: '2026-03-15', status: 'confirmed' },
  { job_type: 'downlights', trade: 'electrical', price_inc_gst: 330, price_ex_gst: 300, quoted_at: '2026-02-01', status: 'confirmed' },
  // pending → ignored
  { job_type: 'downlights', trade: 'electrical', price_inc_gst: 9999, price_ex_gst: 9090, quoted_at: '2026-04-01', status: 'pending_review' },
  // rejected → ignored
  { job_type: 'hot_water', trade: 'plumbing', price_inc_gst: 5000, price_ex_gst: 4545, quoted_at: '2026-01-01', status: 'rejected' },
  // confirmed but no price → ignored
  { job_type: 'power_points', trade: 'electrical', price_inc_gst: null, price_ex_gst: null, quoted_at: null, status: 'confirmed' },
]

describe('aggregateByJobType', () => {
  it('averages only confirmed, priced rows', () => {
    const out = aggregateByJobType(rows)
    expect(out).toHaveLength(1)
    const d = out[0]
    expect(d.job_type).toBe('downlights')
    expect(d.count).toBe(3)
    expect(d.avg_price_inc_gst).toBe(220) // (110+220+330)/3
    expect(d.avg_price_ex_gst).toBe(200) // (100+200+300)/3
    expect(d.min_price_inc_gst).toBe(110)
    expect(d.max_price_inc_gst).toBe(330)
    expect(d.most_recent_quoted_at).toBe('2026-03-15')
    expect(d.trade).toBe('electrical')
  })

  it('omits job types with no usable rows', () => {
    const out = aggregateByJobType(rows)
    expect(out.find((s) => s.job_type === 'hot_water')).toBeUndefined() // rejected
    expect(out.find((s) => s.job_type === 'power_points')).toBeUndefined() // no price
  })
})

describe('hintFor', () => {
  it('returns count:0 cleanly when there is no confirmed history', () => {
    const h = hintFor(rows, 'gas_fitting')
    expect(h.count).toBe(0)
    expect(h.job_type).toBe('gas_fitting')
  })

  it('returns the aggregate for a job type that has history', () => {
    const h = hintFor(rows, 'downlights')
    expect(h.count).toBe(3)
    if ('avg_price_inc_gst' in h) expect(h.avg_price_inc_gst).toBe(220)
  })
})
