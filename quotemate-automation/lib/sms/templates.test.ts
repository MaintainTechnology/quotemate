import { describe, it, expect } from 'vitest'
import { buildTradieWebLeadAlert, buildIntakeRecoverySms } from './templates'

describe('buildTradieWebLeadAlert', () => {
  it('includes tradie name, customer first name, suburb and a trimmed description', () => {
    const body = buildTradieWebLeadAlert({
      tradieFirstName: 'Jon',
      customerName: 'Jeph Daligdig',
      suburb: 'Bondi',
      description: 'I need 6 downlights installed in the lounge',
    })
    expect(body).toContain('Jon')
    expect(body).toContain('Jeph')
    expect(body).toContain('Bondi')
    expect(body).toContain('downlights')
    expect(body).toContain('texting them now')
    expect(body.length).toBeLessThanOrEqual(320)
  })

  it('handles a missing tradie first name and clamps a very long description', () => {
    const body = buildTradieWebLeadAlert({
      tradieFirstName: null,
      customerName: 'Sam',
      suburb: 'Newtown',
      description: 'x'.repeat(400),
    })
    expect(body.length).toBeLessThanOrEqual(320)
    expect(body).toContain('Sam')
    expect(body).toContain('Newtown')
    expect(body.startsWith('Hi')).toBe(false) // no greeting when first name absent
  })
})

// ──────────────────────────────────────────────────────────────────────
// R28 FIX 3a — recovery SMS for a missing per-job STRUCTURED field (count).
//
// The ask-loop being fixed: quality.ts downgrades a downlights intake to
// 'empty' purely because no count was captured. The route folds 'count'
// into missing[]; this template must ask the EXACT count question
// ("how many downlights…?") and NEVER fall through to the generic
// "give me a quick description of the work" wording — which made the
// customer re-describe the job they already described, looping.
//
// Each test runs the picker many times so the random variant choice can't
// produce a flaky pass/fail.
describe('buildIntakeRecoverySms — R28 count branch (FIX 3a)', () => {
  const GENERIC = 'quick description of the work'

  it('LOOP BROKEN: count-only gap asks for the count using the jobtype noun, never the generic describe-work line', () => {
    for (let i = 0; i < 50; i++) {
      const body = buildIntakeRecoverySms({
        firstName: 'James',
        missing: ['count'],
        trade: 'electrical',
        jobType: 'downlights',
      })
      // Every variant names the job's noun…
      expect(body).toMatch(/downlights/i)
      // …and asks for the quantity ("how many" or "the number of").
      expect(body).toMatch(/how many|number of/i)
      // The whole point of the fix: it must NOT degrade to the generic
      // "describe the work" wording that caused the re-describe loop.
      expect(body).not.toContain(GENERIC)
    }
  })

  it('uses the human job-type label as the noun (power_points -> "power points")', () => {
    for (let i = 0; i < 50; i++) {
      const body = buildIntakeRecoverySms({
        firstName: 'James',
        missing: ['count'],
        trade: 'electrical',
        jobType: 'power_points',
      })
      expect(body).toMatch(/power points/i)
      expect(body).not.toContain('power_points')
      expect(body).not.toContain(GENERIC)
    }
  })

  it('falls back to a trade-aware noun (not the generic line) when jobType is unknown/absent', () => {
    for (let i = 0; i < 50; i++) {
      const elec = buildIntakeRecoverySms({ firstName: 'James', missing: ['count'], trade: 'electrical' })
      expect(elec).toMatch(/how many fittings|number of fittings/i)
      expect(elec).not.toContain(GENERIC)

      const plumb = buildIntakeRecoverySms({ firstName: 'James', missing: ['count'], trade: 'plumbing' })
      expect(plumb).toMatch(/how many items|number of items/i)
      expect(plumb).not.toContain(GENERIC)
    }
  })

  it('GENUINE-GAP NEGATIVE: a missing name still asks for the name, not the count', () => {
    // A name gap is more fundamental than a count gap — it must win, so a
    // genuinely-unanswered mandatory field is never skipped by the count
    // branch. (missing is ordered name-first by the route.)
    for (let i = 0; i < 50; i++) {
      const body = buildIntakeRecoverySms({
        firstName: '',
        missing: ['name', 'count'],
        trade: 'electrical',
        jobType: 'downlights',
      })
      expect(body).toMatch(/first name/i)
      expect(body).not.toMatch(/how many/i)
    }
  })

  it('GENUINE-GAP NEGATIVE: a missing scope still asks for the description, not the count', () => {
    for (let i = 0; i < 50; i++) {
      const body = buildIntakeRecoverySms({
        firstName: 'James',
        missing: ['scope', 'count'],
        trade: 'electrical',
        jobType: 'downlights',
      })
      // scope branch asks for a rundown/description of the work…
      expect(body.toLowerCase()).toMatch(/rundown|describe|description/)
      // …and must NOT short-circuit to the count question.
      expect(body).not.toMatch(/how many/i)
    }
  })

  it('still asks the generic line only when missing[] is truly empty (no known field)', () => {
    // Defensive: an empty missing[] (no detectable gap) keeps the generic
    // fallback — we must not accidentally route that to a count question.
    for (let i = 0; i < 20; i++) {
      const body = buildIntakeRecoverySms({ firstName: 'James', missing: [], trade: 'electrical' })
      expect(body).toContain(GENERIC)
      expect(body).not.toMatch(/how many/i)
    }
  })

  it('GSM-7 safe (ASCII only) for the count branch', () => {
    const body = buildIntakeRecoverySms({
      firstName: 'James',
      missing: ['count'],
      trade: 'electrical',
      jobType: 'downlights',
    })
    // No characters outside the printable-ASCII + newline range.
    expect(/^[\x20-\x7E\n]*$/.test(body)).toBe(true)
  })
})
