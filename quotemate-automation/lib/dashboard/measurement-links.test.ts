// Promoted-measurement → Measurement Results link.
//
// When a tradie promotes a roofing measurement via /api/roofing/save-as-quote,
// the measurement is deliberately dropped from /api/tenant/trade-jobs
// (`.is('quote_share_token', null)`) so the job doesn't double-render — the
// surviving `quotes` row is the single source of truth.
//
// But `quotes` has NO column pointing back at roofing_measurements, and
// /api/tenant/me never reads that table — so the promoted row lost its
// /m/[measure_token] link entirely. The reverse key already exists and is
// populated: roofing_measurements.quote_share_token = quotes.share_token
// (migration 168, written by save-as-quote).

import { describe, expect, it } from 'vitest'
import { measurementHrefByShareToken } from './measurement-links'

describe('measurementHrefByShareToken', () => {
  it('links a promoted measurement to its Measurement Results page', () => {
    const map = measurementHrefByShareToken([
      { quote_share_token: 'share-abc', measure_token: 'meas-xyz' },
    ])
    expect(map['share-abc']).toBe('/m/meas-xyz')
  })

  it('skips unpromoted measurements — they still have their own queue row', () => {
    const map = measurementHrefByShareToken([
      { quote_share_token: null, measure_token: 'meas-xyz' },
    ])
    expect(map).toEqual({})
  })

  it('skips a promoted row with no measure_token rather than emitting /m/null', () => {
    const map = measurementHrefByShareToken([
      { quote_share_token: 'share-abc', measure_token: null },
    ])
    expect(map).toEqual({})
  })

  it('indexes several promoted measurements independently', () => {
    const map = measurementHrefByShareToken([
      { quote_share_token: 'share-1', measure_token: 'm1' },
      { quote_share_token: 'share-2', measure_token: 'm2' },
      { quote_share_token: null, measure_token: 'm3' },
    ])
    expect(map).toEqual({ 'share-1': '/m/m1', 'share-2': '/m/m2' })
  })

  it('returns an empty index for no rows', () => {
    expect(measurementHrefByShareToken([])).toEqual({})
  })
})
