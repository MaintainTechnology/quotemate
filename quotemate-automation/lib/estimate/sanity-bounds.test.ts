import { describe, it, expect } from 'vitest'
import { checkSanityBounds, boundForJob, type JobTypeBound } from './sanity-bounds'

const BOUNDS: JobTypeBound[] = [
  { trade: 'electrical', job_type: 'downlights', max_labour_hours: 11, min_total_ex_gst: 300, max_total_ex_gst: 4000, per_unit_labour_hours: 1.0 },
  { trade: 'plumbing', job_type: 'hot_water', max_labour_hours: 6, min_total_ex_gst: 800, max_total_ex_gst: 6000, per_unit_labour_hours: null },
]

describe('boundForJob', () => {
  it('matches on trade + job_type', () => {
    expect(boundForJob(BOUNDS, 'electrical', 'downlights')?.max_labour_hours).toBe(11)
    expect(boundForJob(BOUNDS, 'plumbing', 'downlights')).toBeUndefined()
  })
})

describe('checkSanityBounds (R9)', () => {
  it('passes (ok) when no bound is defined for the job-type (opt-in)', () => {
    expect(checkSanityBounds({ jobType: 'fault_finding', trade: 'electrical', totalLabourHours: 99, totalExGst: 99999 }, undefined)).toEqual({ ok: true })
  })

  it('passes a realistic 6-downlight job (9h, $2100)', () => {
    const v = checkSanityBounds(
      { jobType: 'downlights', trade: 'electrical', quantity: 6, totalLabourHours: 9, totalExGst: 2100 },
      boundForJob(BOUNDS, 'electrical', 'downlights'),
    )
    expect(v.ok).toBe(true)
  })

  it('FAILS the canonical 6-downlight 17.5h defect (the audit case)', () => {
    const v = checkSanityBounds(
      { jobType: 'downlights', trade: 'electrical', quantity: 6, totalLabourHours: 17.5, totalExGst: 2600 },
      boundForJob(BOUNDS, 'electrical', 'downlights'),
    )
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.failures.join(' ')).toMatch(/labour 17.5h > max 11h/)
  })

  it('catches a per-unit blowout even under the absolute cap', () => {
    // 4 downlights, 8h total, $1500 — under the 11h absolute cap, but 2.0h/unit > 1.0×1.75
    const v = checkSanityBounds(
      { jobType: 'downlights', trade: 'electrical', quantity: 4, totalLabourHours: 8, totalExGst: 1500 },
      boundForJob(BOUNDS, 'electrical', 'downlights'),
    )
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.failures.join(' ')).toMatch(/per-unit/)
  })

  it('flags an implausibly low total (under-quote)', () => {
    const v = checkSanityBounds(
      { jobType: 'hot_water', trade: 'plumbing', totalLabourHours: 3, totalExGst: 120 },
      boundForJob(BOUNDS, 'plumbing', 'hot_water'),
    )
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.failures.join(' ')).toMatch(/< min/)
  })

  it('flags an implausibly high total (over-quote)', () => {
    const v = checkSanityBounds(
      { jobType: 'hot_water', trade: 'plumbing', totalLabourHours: 4, totalExGst: 9000 },
      boundForJob(BOUNDS, 'plumbing', 'hot_water'),
    )
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.failures.join(' ')).toMatch(/> max/)
  })
})
