import { describe, expect, it } from 'vitest'
import { runDeviceCount, runItemCount, runStatus } from './run-status'

describe('runStatus', () => {
  it('is draft when nothing beyond the extraction exists', () => {
    expect(runStatus({})).toBe('draft')
    expect(runStatus({ corrected_items: null, priced_at: null })).toBe('draft')
  })

  it('is verified once corrected counts are saved (even an empty array)', () => {
    expect(runStatus({ corrected_items: [] })).toBe('verified')
    expect(runStatus({ corrected_items: [{ type: 'GPO', count: 4 }] })).toBe('verified')
  })

  it('is priced when a persisted BOM exists, regardless of corrections', () => {
    expect(runStatus({ priced_at: '2026-06-11T04:00:00Z' })).toBe('priced')
    expect(runStatus({ corrected_items: [], priced_at: '2026-06-11T04:00:00Z' })).toBe('priced')
    // history route surfaces only priced_total (jsonb projection), not priced_at
    expect(runStatus({ priced_total: 1234.56 })).toBe('priced')
    expect(runStatus({ priced_total: 0 })).toBe('priced')
  })
})

describe('runItemCount', () => {
  it('prefers corrected items over the AI list', () => {
    expect(runItemCount({ items: [{}, {}, {}], corrected_items: [{}] })).toBe(1)
  })
  it('falls back to the AI list, then zero', () => {
    expect(runItemCount({ items: [{}, {}] })).toBe(2)
    expect(runItemCount({})).toBe(0)
  })
})

describe('runDeviceCount', () => {
  it('sums counts and ignores garbage', () => {
    expect(
      runDeviceCount({ items: [{ count: 43 }, { count: 12 }, { count: 'x' }, { count: -2 }] }),
    ).toBe(55)
  })
  it('uses corrected counts when present', () => {
    expect(runDeviceCount({ items: [{ count: 10 }], corrected_items: [{ count: 7 }] })).toBe(7)
  })
})
