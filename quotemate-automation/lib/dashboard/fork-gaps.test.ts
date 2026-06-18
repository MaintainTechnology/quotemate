// Unit tests for the fork-baseline catalogue-gap mapper (R38).

import { describe, it, expect } from 'vitest'
import {
  mapForkGaps,
  lineHasGap,
  categoryHasGap,
  forkGapSummary,
} from './fork-gaps'

describe('mapForkGaps (R38)', () => {
  it('maps category_gaps into line + category lookups, sorted by line', () => {
    const d = mapForkGaps({
      has_category_gaps: true,
      gap_detection_failed: false,
      category_gaps: [
        { material_category: 'CableTray', line: 3 },
        { material_category: 'conduit', line: 1 },
      ],
    })
    expect(d.hasGaps).toBe(true)
    expect(d.count).toBe(2)
    expect(d.gaps.map((g) => g.line)).toEqual([1, 3])
    expect([...d.gapLines]).toEqual(expect.arrayContaining([1, 3]))
    expect(categoryHasGap(d, 'conduit')).toBe(true)
    expect(categoryHasGap(d, 'CABLETRAY')).toBe(true) // normalised
    expect(lineHasGap(d, 1)).toBe(true)
    expect(lineHasGap(d, 2)).toBe(false)
  })

  it('reports no gaps for an empty list', () => {
    const d = mapForkGaps({ has_category_gaps: false, gap_detection_failed: false, category_gaps: [] })
    expect(d.hasGaps).toBe(false)
    expect(d.count).toBe(0)
    expect(forkGapSummary(d)).toBeNull()
  })

  it('surfaces detectionFailed and suppresses gap markers when the catalogue read errored', () => {
    const d = mapForkGaps({
      gap_detection_failed: true,
      // Even if the route somehow included entries, a failed detection means
      // "we don't know" — we must not render false gap markers.
      category_gaps: [{ material_category: 'conduit', line: 1 }],
    })
    expect(d.detectionFailed).toBe(true)
    expect(d.hasGaps).toBe(false)
    expect(d.count).toBe(0)
    expect(lineHasGap(d, 1)).toBe(false)
    expect(forkGapSummary(d)).toMatch(/couldn't check/i)
  })

  it('is defensive against null / missing response', () => {
    const d = mapForkGaps(null)
    expect(d.hasGaps).toBe(false)
    expect(d.detectionFailed).toBe(false)
    expect(d.count).toBe(0)
    expect(mapForkGaps(undefined).count).toBe(0)
  })

  it('drops malformed gap entries (bad line / blank category)', () => {
    const d = mapForkGaps({
      gap_detection_failed: false,
      category_gaps: [
        { material_category: '', line: 1 },
        // @ts-expect-error — intentionally malformed
        { material_category: 'conduit', line: 'x' },
        { material_category: 'gpo', line: 2 },
      ],
    })
    expect(d.count).toBe(1)
    expect(categoryHasGap(d, 'gpo')).toBe(true)
  })

  it('derives hasGaps from the list when has_category_gaps flag is absent', () => {
    const d = mapForkGaps({
      gap_detection_failed: false,
      category_gaps: [{ material_category: 'conduit', line: 1 }],
    })
    expect(d.hasGaps).toBe(true)
  })
})

describe('forkGapSummary copy', () => {
  it('singular vs plural', () => {
    const one = mapForkGaps({
      gap_detection_failed: false,
      category_gaps: [{ material_category: 'conduit', line: 1 }],
    })
    expect(forkGapSummary(one)).toMatch(/^1 line in this recipe has /)
    const two = mapForkGaps({
      gap_detection_failed: false,
      category_gaps: [
        { material_category: 'conduit', line: 1 },
        { material_category: 'gpo', line: 2 },
      ],
    })
    expect(forkGapSummary(two)).toMatch(/^2 lines in this recipe have /)
  })
})
