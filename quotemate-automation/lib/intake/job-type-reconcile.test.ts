import { describe, it, expect } from 'vitest'
import { reconcileJobType, clarifyQuestionFor } from './job-type-reconcile'

describe('reconcileJobType (R17)', () => {
  it('unanimous → use', () => {
    const r = reconcileJobType([
      { source: 'dialog', jobType: 'downlights' },
      { source: 'slots', jobType: 'downlights' },
      { source: 'structure', jobType: 'downlights' },
    ])
    expect(r).toMatchObject({ resolved: 'downlights', agreement: 'unanimous', action: 'use' })
  })

  it('single known source → use', () => {
    const r = reconcileJobType([
      { source: 'dialog', jobType: 'hot_water' },
      { source: 'slots', jobType: 'unknown' },
      { source: 'structure', jobType: null },
    ])
    expect(r).toMatchObject({ resolved: 'hot_water', agreement: 'single', action: 'use' })
  })

  it('clear majority (2 of 3) → use the majority', () => {
    const r = reconcileJobType([
      { source: 'dialog', jobType: 'power_points' },
      { source: 'slots', jobType: 'power_points' },
      { source: 'structure', jobType: 'downlights' },
    ])
    expect(r).toMatchObject({ resolved: 'power_points', agreement: 'majority', action: 'use' })
  })

  it('tie (1 vs 1) → conflict, never silently pick → clarify', () => {
    const r = reconcileJobType([
      { source: 'dialog', jobType: 'downlights' },
      { source: 'structure', jobType: 'power_points' },
    ])
    expect(r.resolved).toBeNull()
    expect(r.agreement).toBe('conflict')
    expect(r.action).toBe('clarify')
  })

  it('three-way disagreement (1/1/1) → conflict', () => {
    const r = reconcileJobType([
      { source: 'dialog', jobType: 'downlights' },
      { source: 'slots', jobType: 'power_points' },
      { source: 'structure', jobType: 'ceiling_fans' },
    ])
    expect(r.agreement).toBe('conflict')
    expect(r.resolved).toBeNull()
  })

  it('no source classified (all unknown/other/blank) → none → clarify', () => {
    const r = reconcileJobType([
      { source: 'dialog', jobType: 'unknown' },
      { source: 'slots', jobType: 'other' },
      { source: 'structure', jobType: '' },
    ])
    expect(r).toMatchObject({ resolved: null, agreement: 'none', action: 'clarify' })
  })

  it('unknown/other do not count as conflicting votes', () => {
    const r = reconcileJobType([
      { source: 'dialog', jobType: 'blocked_drain' },
      { source: 'slots', jobType: 'other' },
      { source: 'structure', jobType: 'blocked_drain' },
    ])
    expect(r).toMatchObject({ resolved: 'blocked_drain', agreement: 'unanimous', action: 'use' })
  })

  it('normalises case/whitespace', () => {
    const r = reconcileJobType([
      { source: 'a', jobType: ' Downlights ' },
      { source: 'b', jobType: 'downlights' },
    ])
    expect(r.resolved).toBe('downlights')
  })

  it('clarifyQuestionFor names the two leading candidates', () => {
    const r = reconcileJobType([
      { source: 'dialog', jobType: 'downlights' },
      { source: 'structure', jobType: 'power_points' },
    ])
    const q = clarifyQuestionFor(r)
    expect(q).toMatch(/downlights/)
    expect(q).toMatch(/power points/)
  })
})
