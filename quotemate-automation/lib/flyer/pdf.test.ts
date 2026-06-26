import { describe, it, expect } from 'vitest'
import { pdfPageSpec } from './pdf'

describe('pdfPageSpec', () => {
  it('derives portrait orientation when taller than wide', () => {
    const spec = pdfPageSpec(800, 1131)
    expect(spec.orientation).toBe('portrait')
    expect(spec.format).toEqual([800, 1131])
    expect(spec.unit).toBe('px')
  })

  it('derives landscape orientation when wider than tall', () => {
    expect(pdfPageSpec(1200, 600).orientation).toBe('landscape')
  })

  it('rounds and floors to a minimum of 1px', () => {
    expect(pdfPageSpec(799.6, 1130.2).format).toEqual([800, 1130])
    expect(pdfPageSpec(0, 0).format).toEqual([1, 1])
  })
})
