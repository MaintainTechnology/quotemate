import { describe, it, expect } from 'vitest'
import { jobMethod, hasJobMethod, METHOD_DISCLAIMER } from './job-method'

// Every job_type the customer quote page can label (JOB_TYPE_LABEL in
// app/q/[token]/page.tsx). A new job type must not silently lose its method.
const ELECTRICAL_JOBS = [
  'downlights', 'power_points', 'ceiling_fans', 'smoke_alarms', 'outdoor_lighting',
  'switchboard', 'oven_cooktop', 'ev_charger', 'fault_finding', 'renovation',
]
const PLUMBING_JOBS = [
  'blocked_drain', 'hot_water', 'tap_repair', 'tap_replace', 'toilet_repair',
  'toilet_replace', 'gas_fitting', 'burst_pipe', 'bathroom_renovation',
  'cctv_inspection', 'prv_install',
]

describe('jobMethod', () => {
  it('returns a method for every electrical job type the page can label', () => {
    for (const j of ELECTRICAL_JOBS) {
      const m = jobMethod('electrical', j)
      expect(m, j).not.toBeNull()
      expect(m!.steps.length, j).toBeGreaterThanOrEqual(5)
      expect(m!.tools.length, j).toBeGreaterThanOrEqual(5)
      expect(m!.compliance.length, j).toBeGreaterThanOrEqual(2)
    }
  })

  it('returns a method for every plumbing job type the page can label', () => {
    for (const j of PLUMBING_JOBS) {
      const m = jobMethod('plumbing', j)
      expect(m, j).not.toBeNull()
      expect(m!.steps.length, j).toBeGreaterThanOrEqual(4)
      expect(m!.tools.length, j).toBeGreaterThanOrEqual(5)
    }
  })

  it('always opens with isolate-and-prove-dead for electrical — the safety step', () => {
    for (const j of [...ELECTRICAL_JOBS, 'other', null, undefined]) {
      const m = jobMethod('electrical', j)!
      expect(m.steps.some((s) => /prove dead/i.test(s)), String(j)).toBe(true)
    }
  })

  it('always closes with testing before re-energising, and a compliance certificate', () => {
    for (const j of [...ELECTRICAL_JOBS, 'other']) {
      const m = jobMethod('electrical', j)!
      const tail = m.steps.slice(-3).join(' ')
      expect(tail, j).toMatch(/insulation resistance/i)
      expect(tail, j).toMatch(/certificate of compliance/i)
      // Test comes BEFORE energise — order is the point of a method.
      const testAt = m.steps.findIndex((s) => /insulation resistance/i.test(s))
      const liveAt = m.steps.findIndex((s) => /^Energise/i.test(s))
      expect(testAt, j).toBeLessThan(liveAt)
    }
  })

  it('cites the governing standard for each trade', () => {
    expect(jobMethod('electrical', 'downlights')!.compliance.join(' ')).toMatch(/AS\/NZS 3000/)
    expect(jobMethod('plumbing', 'hot_water')!.compliance.join(' ')).toMatch(/AS\/NZS 3500/)
  })

  it('falls back to a safe generic middle for an unknown or missing job type', () => {
    for (const j of ['other', 'something_new', '', null, undefined]) {
      const m = jobMethod('electrical', j)
      expect(m, String(j)).not.toBeNull()
      expect(m!.steps.length).toBeGreaterThanOrEqual(5)
    }
  })

  it('returns null for a trade with no authored method — never a wrong list', () => {
    for (const t of ['roofing', 'solar', 'painting', 'commercial_painting', 'aircon', 'signage', '', null, undefined]) {
      expect(jobMethod(t, 'downlights'), String(t)).toBeNull()
      expect(hasJobMethod(t), String(t)).toBe(false)
    }
    expect(hasJobMethod('electrical')).toBe(true)
    expect(hasJobMethod('plumbing')).toBe(true)
  })

  it('is case- and whitespace-insensitive on both arguments', () => {
    expect(jobMethod('  Electrical ', ' DOWNLIGHTS ')).toEqual(jobMethod('electrical', 'downlights'))
  })

  it('never repeats a step or a tool', () => {
    for (const j of ELECTRICAL_JOBS.concat(PLUMBING_JOBS)) {
      const m = jobMethod(ELECTRICAL_JOBS.includes(j) ? 'electrical' : 'plumbing', j)!
      expect(new Set(m.steps).size, j).toBe(m.steps.length)
      expect(new Set(m.tools).size, j).toBe(m.tools.length)
    }
  })

  it('is deterministic — the same inputs give the identical object every call', () => {
    expect(jobMethod('electrical', 'ev_charger')).toEqual(jobMethod('electrical', 'ev_charger'))
  })

  it('carries a disclaimer so the method never reads as a bespoke promise', () => {
    expect(METHOD_DISCLAIMER).toMatch(/confirms the final method/i)
  })

  it('steps read as sentences, not fragments', () => {
    const m = jobMethod('electrical', 'switchboard')!
    for (const s of m.steps) {
      expect(s[0]).toBe(s[0].toUpperCase())
      expect(s.endsWith('.'), s).toBe(true)
    }
  })
})
