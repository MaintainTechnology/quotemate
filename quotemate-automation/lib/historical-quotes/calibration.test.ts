import { describe, it, expect } from 'vitest'
import { buildCalibrationProposals, MIN_SAMPLES } from './calibration'
import type { JobTypeStats } from './types'

function stat(job_type: string, count: number, avgEx: number, trade: string | null): JobTypeStats {
  return {
    job_type,
    trade,
    count,
    avg_price_inc_gst: avgEx * 1.1,
    avg_price_ex_gst: avgEx,
    min_price_inc_gst: 0,
    max_price_inc_gst: 0,
    most_recent_quoted_at: null,
  }
}

describe('buildCalibrationProposals', () => {
  it('skips job types below MIN_SAMPLES', () => {
    const out = buildCalibrationProposals([stat('downlights', MIN_SAMPLES - 1, 100, 'electrical')], new Map())
    expect(out).toHaveLength(0)
  })

  it('proposes a new assembly at the ex-GST average', () => {
    const out = buildCalibrationProposals([stat('downlights', 5, 120, 'electrical')], new Map())
    expect(out).toHaveLength(1)
    expect(out[0].is_new).toBe(true)
    expect(out[0].proposed_unit_price_ex_gst).toBe(120)
    expect(out[0].trade).toBe('electrical')
    expect(out[0].name).toMatch(/downlight/i)
  })

  it('marks an existing assembly with its current price', () => {
    const existing = new Map([['led downlight — supply & install', 90]])
    const out = buildCalibrationProposals([stat('downlights', 5, 120, 'electrical')], existing)
    expect(out[0].is_new).toBe(false)
    expect(out[0].existing_price_ex_gst).toBe(90)
  })

  it('skips "other" (no assembly mapping)', () => {
    const out = buildCalibrationProposals([stat('other', 10, 100, null)], new Map())
    expect(out).toHaveLength(0)
  })
})
