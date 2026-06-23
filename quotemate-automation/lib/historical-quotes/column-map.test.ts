import { describe, it, expect } from 'vitest'
import { heuristicColumnMap } from './column-map'

describe('heuristicColumnMap', () => {
  it('maps common header names to canonical fields', () => {
    const m = heuristicColumnMap(['job description', 'total price', 'gst', 'quote date', 'qty', 'unit'])
    expect(m.description).toBe('job description')
    expect(m.price).toBe('total price')
    expect(m.gst_basis).toBe('gst')
    expect(m.date).toBe('quote date')
    expect(m.quantity).toBe('qty')
    expect(m.unit).toBe('unit')
  })

  it('returns null for canonical fields with no matching header', () => {
    const m = heuristicColumnMap(['foo', 'bar'])
    expect(m.description).toBeNull()
    expect(m.price).toBeNull()
    expect(m.date).toBeNull()
  })
})
