// Spec specs/quote-visual-parity.md R1 — pure derivation of the report's
// property-visuals block from a quote's trade + intake.scope snapshot.
// Mirrors the customer page: RoofHeroStrip stats for roofing,
// CommercialPaintDetails takeoff summary for commercial painting.

import { describe, it, expect } from 'vitest'
import { quotePropertyVisuals } from './property-visuals'

const roofScope = {
  sloped_area_m2: 193.7,
  footprint_m2: 168.2,
  form: 'hip',
  material: 'colorbond_corrugated',
  pitch: 'shallow',
  hips: 4,
  valleys: 2,
  ridge_lm: 21.4,
  storeys: 2,
}

describe('quotePropertyVisuals — roofing', () => {
  it('derives the RoofHeroStrip stat grid from intake.scope', () => {
    const v = quotePropertyVisuals('roofing', roofScope, 'data:image/png;base64,AAAA')
    expect(v).not.toBeNull()
    expect(v!.imageSrc).toBe('data:image/png;base64,AAAA')
    const byLabel = Object.fromEntries(v!.stats.map((s) => [s.label, s.value]))
    expect(byLabel['Sloped area']).toBe('194 m²')
    expect(byLabel['Material']).toBe('Colorbond Corrugated')
    expect(byLabel['Roof form']).toBe('Hip')
    expect(byLabel['Pitch']).toBe('Shallow')
    expect(byLabel['Hips · valleys']).toBe('4 · 2')
    expect(byLabel['Ridge']).toBe('21 lm')
    expect(byLabel['Storeys']).toBe('2')
    expect(byLabel['Footprint']).toBe('168 m²')
    expect(v!.disclaimer).toMatch(/satellite imagery/i)
  })

  it('skips null fields instead of printing placeholders', () => {
    const v = quotePropertyVisuals(
      'roofing',
      { sloped_area_m2: 100 },
      null,
    )
    expect(v).not.toBeNull()
    expect(v!.stats.map((s) => s.label)).toEqual(['Sloped area'])
  })

  it('returns null when there is neither an image nor any stats', () => {
    expect(quotePropertyVisuals('roofing', null, null)).toBeNull()
    expect(quotePropertyVisuals('roofing', 'not-an-object', null)).toBeNull()
  })

  it('keeps the image when scope is empty (image-only block)', () => {
    const v = quotePropertyVisuals('roofing', null, 'data:image/png;base64,BB')
    expect(v).not.toBeNull()
    expect(v!.imageSrc).toBe('data:image/png;base64,BB')
    expect(v!.stats).toEqual([])
  })
})

describe('quotePropertyVisuals — commercial painting', () => {
  it('derives the takeoff summary stats', () => {
    const v = quotePropertyVisuals(
      'commercial_painting',
      { job_name: 'Warehouse repaint', surfaces: 12, total_m2: 2450.4, labour_hours: 160, crew_size: 4, estimated_days: 5 },
      null,
    )
    expect(v).not.toBeNull()
    const byLabel = Object.fromEntries(v!.stats.map((s) => [s.label, s.value]))
    expect(byLabel['Measured area']).toBe('2,450 m²')
    expect(byLabel['Surfaces']).toBe('12')
    expect(byLabel['Labour hours']).toBe('160')
    expect(byLabel['Crew size']).toBe('4')
    expect(byLabel['Est. days']).toBe('5')
    expect(v!.disclaimer).toBeNull()
  })

  it('returns null with no takeoff and no image', () => {
    expect(quotePropertyVisuals('commercial_painting', {}, null)).toBeNull()
  })
})

describe('quotePropertyVisuals — other trades', () => {
  it('returns null for electrical/plumbing/unknown regardless of scope', () => {
    expect(quotePropertyVisuals('electrical', roofScope, 'data:x')).toBeNull()
    expect(quotePropertyVisuals('plumbing', roofScope, 'data:x')).toBeNull()
    expect(quotePropertyVisuals('', roofScope, 'data:x')).toBeNull()
  })
})
