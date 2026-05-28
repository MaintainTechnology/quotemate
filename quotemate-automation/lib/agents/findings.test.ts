// Tests for the pure findings-shaping helpers.

import { describe, expect, it } from 'vitest'
import {
  describeCatalogueFinding,
  describeTradiePattern,
  groupCatalogueBySourceTable,
  isFindingStatus,
  relativeTime,
  sortCatalogueFindings,
  sortTradiePatterns,
  type CatalogueFindingRow,
  type TradieEditPatternRow,
} from './findings'

function cf(over: Partial<CatalogueFindingRow> = {}): CatalogueFindingRow {
  return {
    id: 'f1',
    source_table: 'shared_materials',
    source_row_id: 'r1',
    finding_type: 'price_drift',
    current_value: { unit_price_ex_gst: 1100 },
    suggested_value: { unit_price_ex_gst: 1265, drift_pct: 15 },
    confidence: 0.8,
    status: 'pending',
    created_at: '2026-05-27T10:00:00Z',
    reviewed_by: null,
    reviewed_at: null,
    ...over,
  }
}

function tp(over: Partial<TradieEditPatternRow> = {}): TradieEditPatternRow {
  return {
    id: 'p1',
    tenant_id: 't-1',
    trade: 'plumbing',
    job_type: 'hot_water',
    field: 'labour_hours',
    edit_direction: 'up',
    median_delta: 0.5,
    sample_count: 5,
    observed_period_start: '2026-05-20T00:00:00Z',
    observed_period_end: '2026-05-27T00:00:00Z',
    status: 'pending',
    created_at: '2026-05-27T10:00:00Z',
    reviewed_by: null,
    reviewed_at: null,
    ...over,
  }
}

describe('isFindingStatus', () => {
  it('accepts the four valid statuses', () => {
    expect(isFindingStatus('pending')).toBe(true)
    expect(isFindingStatus('approved')).toBe(true)
    expect(isFindingStatus('rejected')).toBe(true)
    expect(isFindingStatus('applied')).toBe(true)
  })
  it('rejects anything else', () => {
    expect(isFindingStatus('garbage')).toBe(false)
    expect(isFindingStatus(null)).toBe(false)
    expect(isFindingStatus(undefined)).toBe(false)
    expect(isFindingStatus('Pending')).toBe(false) // case sensitive
  })
})

describe('sortCatalogueFindings', () => {
  it('puts pending first, then approved, then rejected, then applied', () => {
    const rows = [
      cf({ id: '1', status: 'applied' }),
      cf({ id: '2', status: 'pending' }),
      cf({ id: '3', status: 'rejected' }),
      cf({ id: '4', status: 'approved' }),
    ]
    const sorted = sortCatalogueFindings(rows)
    expect(sorted.map((r) => r.id)).toEqual(['2', '4', '3', '1'])
  })

  it('sorts by created_at desc within the same status', () => {
    const rows = [
      cf({ id: 'old', status: 'pending', created_at: '2026-05-20T10:00:00Z' }),
      cf({ id: 'new', status: 'pending', created_at: '2026-05-27T10:00:00Z' }),
    ]
    expect(sortCatalogueFindings(rows).map((r) => r.id)).toEqual(['new', 'old'])
  })

  it('does not mutate the input array', () => {
    const rows = [cf({ id: '1', status: 'applied' }), cf({ id: '2', status: 'pending' })]
    const before = rows.map((r) => r.id)
    sortCatalogueFindings(rows)
    expect(rows.map((r) => r.id)).toEqual(before)
  })
})

describe('sortTradiePatterns', () => {
  it('puts pending first, ties broken by sample_count then created_at', () => {
    const rows = [
      tp({ id: 'small', sample_count: 3, created_at: '2026-05-27T10:00:00Z' }),
      tp({ id: 'big', sample_count: 10, created_at: '2026-05-26T10:00:00Z' }),
      tp({ id: 'mid-new', sample_count: 5, created_at: '2026-05-28T10:00:00Z' }),
    ]
    const sorted = sortTradiePatterns(rows)
    expect(sorted[0].id).toBe('big') // largest sample
    expect(sorted[1].id).toBe('mid-new')
    expect(sorted[2].id).toBe('small')
  })
})

describe('describeCatalogueFinding', () => {
  it('describes a price_drift with the delta percentage', () => {
    const label = describeCatalogueFinding(cf())
    expect(label).toMatch(/1100/)
    expect(label).toMatch(/1265/)
    expect(label).toMatch(/\+15%/)
  })

  it('handles a price reduction (negative drift) with a minus sign', () => {
    const label = describeCatalogueFinding(
      cf({
        current_value: { unit_price_ex_gst: 1200 },
        suggested_value: { unit_price_ex_gst: 1000, drift_pct: -16.7 },
      }),
    )
    expect(label).toMatch(/-16\.7%/)
  })

  it('describes a description_mismatch in plain English', () => {
    const label = describeCatalogueFinding(cf({ finding_type: 'description_mismatch' }))
    expect(label).toMatch(/Description/)
  })

  it('describes a category_mismatch with the suggested category', () => {
    const label = describeCatalogueFinding(
      cf({
        finding_type: 'category_mismatch',
        current_value: { category: 'gpo' },
        suggested_value: { category: 'downlight' },
      }),
    )
    expect(label).toBe('gpo → downlight')
  })

  it('handles missing values gracefully', () => {
    const label = describeCatalogueFinding(
      cf({
        finding_type: 'price_drift',
        current_value: {},
        suggested_value: {},
      }),
    )
    expect(label).toMatch(/Price drift/i)
  })
})

describe('describeTradiePattern', () => {
  it('describes "up" as bumped with a +delta', () => {
    expect(describeTradiePattern(tp())).toMatch(/bumped labour_hours by \+0\.5.*n=5/)
  })

  it('describes "down" as reduced', () => {
    const label = describeTradiePattern(
      tp({ edit_direction: 'down', median_delta: -0.5 }),
    )
    expect(label).toMatch(/reduced labour_hours by -0\.5/)
  })

  it('describes "swap" without a delta (non-numeric edit)', () => {
    const label = describeTradiePattern(
      tp({ edit_direction: 'swap', median_delta: 0, field: 'material' }),
    )
    expect(label).toMatch(/swapped material \(n=5\)/)
    expect(label).not.toMatch(/by \+0|by 0/)
  })
})

describe('groupCatalogueBySourceTable', () => {
  it('partitions rows by source_table', () => {
    const grouped = groupCatalogueBySourceTable([
      cf({ id: 'a', source_table: 'shared_materials' }),
      cf({ id: 'b', source_table: 'shared_assemblies' }),
      cf({ id: 'c', source_table: 'shared_materials' }),
    ])
    expect(grouped.shared_materials.map((r) => r.id)).toEqual(['a', 'c'])
    expect(grouped.shared_assemblies.map((r) => r.id)).toEqual(['b'])
  })

  it('returns an empty object for empty input', () => {
    expect(groupCatalogueBySourceTable([])).toEqual({})
  })
})

describe('relativeTime', () => {
  const NOW = new Date('2026-05-27T12:00:00Z')

  it('returns "just now" within 60 seconds', () => {
    expect(relativeTime('2026-05-27T11:59:30Z', NOW)).toBe('just now')
  })

  it('returns minutes when under an hour', () => {
    expect(relativeTime('2026-05-27T11:30:00Z', NOW)).toBe('30m ago')
  })

  it('returns hours when under a day', () => {
    expect(relativeTime('2026-05-27T08:00:00Z', NOW)).toBe('4h ago')
  })

  it('returns "yesterday" for ~24h ago', () => {
    expect(relativeTime('2026-05-26T12:00:00Z', NOW)).toBe('yesterday')
  })

  it('returns days when under 2 weeks', () => {
    expect(relativeTime('2026-05-20T12:00:00Z', NOW)).toBe('7d ago')
  })

  it('returns an ISO date when over 2 weeks', () => {
    expect(relativeTime('2026-05-01T12:00:00Z', NOW)).toBe('2026-05-01')
  })

  it('returns the raw string when input is unparseable', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('not-a-date')
  })
})
