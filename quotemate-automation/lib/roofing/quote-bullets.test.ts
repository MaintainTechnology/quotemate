import { describe, expect, it } from 'vitest'
import { jobDetailBullets, structureMeasurementBullet } from './quote-bullets'
import type { MultiRoofQuote, RoofStructurePrice } from './types'

// Loose fixture overrides: the real types carry fixed-length tier tuples and
// dozens of pricing fields none of these pure text builders read.
function structure(over: Record<string, unknown> = {}): RoofStructurePrice {
  return {
    label: 'Main dwelling',
    metrics: { sloped_area_m2: 586, pitch_degrees: 28, storeys: 2 },
    inputs: { material: 'colorbond_corrugated' },
    ...over,
  } as unknown as RoofStructurePrice
}

function quote(over: Record<string, unknown> = {}): MultiRoofQuote {
  return {
    combined: { area_m2: 586, tiers: [] },
    structures: [structure()],
    ...over,
  } as unknown as MultiRoofQuote
}

describe('jobDetailBullets', () => {
  it('leads with the scope inclusions, then the measured detail', () => {
    const b = jobDetailBullets(quote(), 'better')
    expect(b).toHaveLength(8 + 1 + 1) // 8 inclusions + summary + 1 structure
    expect(b[0]).toMatch(/^Install temporary safety rail/)
    expect(b).toContain(
      'Approx. ~586 m² of sloped roof measured across 1 structure from aerial imagery.',
    )
    expect(b[b.length - 1]).toBe(
      'Main dwelling: ~586 m² sloped area, ~28° pitch, 2-storey, COLORBOND corrugated',
    )
  })

  it('pluralises and lists every included structure', () => {
    const b = jobDetailBullets(
      quote({
        combined: { area_m2: 245, tiers: [] },
        structures: [structure(), structure({ label: 'Secondary structure 1' })],
      }),
      'better',
    )
    expect(b).toContain(
      'Approx. ~245 m² of sloped roof measured across 2 structures from aerial imagery.',
    )
    expect(b.filter((x) => x.startsWith('Secondary structure 1:'))).toHaveLength(1)
  })

  // A patch job must not promise "Remove existing roof areas" / "new roof sheets".
  it('drops the re-roof inclusions for a patch/repair tier', () => {
    const b = jobDetailBullets(quote(), 'good')
    expect(b).toHaveLength(2)
    expect(b.some((x) => x.includes('Remove existing roof areas'))).toBe(false)
  })

  it('returns nothing when there is no linked measurement', () => {
    expect(jobDetailBullets(null, 'better')).toEqual([])
    expect(jobDetailBullets(quote({ structures: [] }), 'better')).toEqual([])
  })

  it('never prints a ~0 m² summary for an all-inspection job', () => {
    const b = jobDetailBullets(quote({ combined: { area_m2: 0, tiers: [] } }), 'better')
    expect(b.some((x) => x.includes('~0 m²'))).toBe(false)
  })
})

describe('structureMeasurementBullet', () => {
  it('degrades per-field instead of printing undefined', () => {
    expect(structureMeasurementBullet(structure({ metrics: {}, inputs: {} }))).toBe(
      'Main dwelling: measured from aerial imagery',
    )
    expect(
      structureMeasurementBullet(
        structure({ metrics: { sloped_area_m2: 586 }, inputs: {} }),
      ),
    ).toBe('Main dwelling: ~586 m² sloped area')
  })

  it('distinguishes tile from metal', () => {
    expect(
      structureMeasurementBullet(
        structure({ inputs: { material: 'concrete_tile' } }),
      ),
    ).toMatch(/concrete tile$/)
  })

  it('falls back to footprint when sloped area is absent', () => {
    expect(
      structureMeasurementBullet(
        structure({ metrics: { footprint_m2: 210 }, inputs: {} }),
      ),
    ).toBe('Main dwelling: ~210 m² footprint')
  })
})
