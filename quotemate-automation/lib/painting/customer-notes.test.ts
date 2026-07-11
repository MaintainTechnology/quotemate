import { describe, expect, it } from 'vitest'
import { customerMeasurementNotes } from './customer-notes'

describe('customerMeasurementNotes', () => {
  it('keeps derivation sentences and drops trailing tradie instructions', () => {
    expect(
      customerMeasurementNotes([
        'Estimated from building footprint (149 m²) × 1 storey. Confirm storeys and internal area.',
      ]),
    ).toEqual(['Estimated from building footprint (149 m²) × 1 storey.'])
  })

  it('passes customer-safe formula notes through unchanged', () => {
    const notes = [
      'Walls ≈ floor area × 2.8 (2.4 m ceilings, openings deducted).',
      'Ceilings ≈ internal floor area.',
      'Trim (skirting + architraves) ≈ internal perimeter × 1.6.',
    ]
    expect(customerMeasurementNotes(notes)).toEqual(notes)
  })

  it('drops a note whose every sentence is tradie-directed', () => {
    expect(
      customerMeasurementNotes(['Floor area entered by hand — treated as confirmed.']),
    ).toEqual([])
  })

  it('strips the listing-confirmation instruction', () => {
    expect(
      customerMeasurementNotes([
        'Floor area from a property listing. Confirm it predates any renovation.',
      ]),
    ).toEqual(['Floor area from a property listing.'])
  })

  it('drops "before quoting" instructions wherever they sit', () => {
    expect(
      customerMeasurementNotes([
        'Floor area is estimated from the roof footprint × storeys. Set the storey count, then confirm or correct the area before quoting.',
      ]),
    ).toEqual(['Floor area is estimated from the roof footprint × storeys.'])
  })

  it('is defensive about jsonb shapes', () => {
    expect(customerMeasurementNotes(null)).toEqual([])
    expect(customerMeasurementNotes(undefined)).toEqual([])
    expect(customerMeasurementNotes([])).toEqual([])
  })
})
