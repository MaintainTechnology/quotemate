// Unit tests for the per-structure aerial image refs (spec
// specs/roofing-pdf-multi-structure-images.md R8).

import { describe, it, expect } from 'vitest'
import { structureImageRefs, structureStaticMapPath } from './structure-images'
import type { RoofStructurePrice } from './types'

const mk = (buildingId: string | null, label: string): RoofStructurePrice =>
  ({ buildingId, label, role: 'secondary', metrics: {}, inputs: {}, price: {} } as unknown as RoofStructurePrice)

const main = mk('bld-1', 'Main dwelling')
const shed = mk('bld-2', 'Shed')
const garage = mk('bld-3', 'Garage')
const full = [main, shed, garage]

describe('structureStaticMapPath', () => {
  it('builds a 1-based ?b= path', () => {
    expect(structureStaticMapPath('tok', 2)).toBe('/api/roofing/q/tok/static-map?b=2')
  })
})

describe('structureImageRefs', () => {
  it('maps every rendered structure to its full-quote index, in detection order', () => {
    const refs = structureImageRefs(full, [main, shed, garage])
    expect(refs).toEqual([
      { index1Based: 1, label: 'Main dwelling' },
      { index1Based: 2, label: 'Shed' },
      { index1Based: 3, label: 'Garage' },
    ])
  })

  it('maps a single rendered structure to its full-quote index (not position 1)', () => {
    const refs = structureImageRefs(full, [shed])
    expect(refs).toEqual([{ index1Based: 2, label: 'Shed' }])
  })

  it('omits excluded structures (absent from the rendered set)', () => {
    // Tradie kept only the main dwelling; shed + garage excluded.
    const refs = structureImageRefs(full, [main])
    expect(refs).toEqual([{ index1Based: 1, label: 'Main dwelling' }])
  })

  it('keeps inspection-but-included structures (they are in the rendered set)', () => {
    // The shed is inspection-routed but the customer included it — it is part
    // of the rendered set, so it still gets an image.
    const refs = structureImageRefs(full, [main, shed])
    expect(refs).toEqual([
      { index1Based: 1, label: 'Main dwelling' },
      { index1Based: 2, label: 'Shed' },
    ])
  })

  it('resolves cross-instance objects by buildingId (not reference equality)', () => {
    // The rendered structures come from a separate DB read, so they are NOT
    // the same object instances as the full quote.
    const renderedCopy = [
      mk('bld-3', 'Garage'),
      mk('bld-1', 'Main dwelling'),
    ]
    const refs = structureImageRefs(full, renderedCopy)
    expect(refs).toEqual([
      { index1Based: 1, label: 'Main dwelling' },
      { index1Based: 3, label: 'Garage' },
    ])
  })

  it('falls back to label when buildingId is absent', () => {
    const noId = [mk(null, 'Main dwelling'), mk(null, 'Shed'), mk(null, 'Garage')]
    const refs = structureImageRefs(noId, [mk(null, 'Shed')])
    expect(refs).toEqual([{ index1Based: 2, label: 'Shed' }])
  })

  it('returns [] for empty inputs', () => {
    expect(structureImageRefs([], [main])).toEqual([])
    expect(structureImageRefs(full, [])).toEqual([])
    expect(structureImageRefs(null, null)).toEqual([])
  })
})
