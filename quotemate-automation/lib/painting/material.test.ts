import { describe, expect, it } from 'vitest'
import {
  buildMaterialDetectPrompt,
  materialGuidance,
  parseMaterialDetection,
} from './material'

describe('buildMaterialDetectPrompt', () => {
  it('asks for the exterior wall material as strict JSON', () => {
    const p = buildMaterialDetectPrompt()
    expect(p.toLowerCase()).toContain('exterior wall material')
    expect(p).toContain('weatherboard')
    expect(p.toLowerCase()).toContain('json')
  })
})

describe('parseMaterialDetection', () => {
  it('parses clean JSON', () => {
    const d = parseMaterialDetection('{"material":"weatherboard","storeys":2,"condition_hint":"weathered","confidence":"high","notes":"x"}')
    expect(d?.material).toBe('weatherboard')
    expect(d?.storeys).toBe(2)
    expect(d?.confidence).toBe('high')
  })

  it('strips code fences', () => {
    const d = parseMaterialDetection('```json\n{"material":"render","confidence":"medium","notes":""}\n```')
    expect(d?.material).toBe('render')
  })

  it('coerces an unknown material / confidence safely', () => {
    const d = parseMaterialDetection('{"material":"stucco","confidence":"sure","notes":""}')
    expect(d?.material).toBe('unknown')
    expect(d?.confidence).toBe('low')
  })

  it('returns null for non-JSON', () => {
    expect(parseMaterialDetection('nope')).toBeNull()
    expect(parseMaterialDetection('')).toBeNull()
  })
})

describe('materialGuidance', () => {
  it('flags weatherboard as the highest-labour substrate', () => {
    const g = materialGuidance('weatherboard')
    expect(g.labour_factor).toBeGreaterThan(1)
    expect(g.inspection).toBe(false)
  })

  it('routes pre-1990 fibro to inspection (asbestos)', () => {
    const g = materialGuidance('fibro', { yearBuilt: 1975 })
    expect(g.inspection).toBe(true)
    expect(g.inspection_reason?.toLowerCase()).toContain('asbestos')
  })

  it('still inspects fibro of unknown age unless confidence is low', () => {
    expect(materialGuidance('fibro', { confidence: 'high' }).inspection).toBe(true)
    expect(materialGuidance('fibro', { confidence: 'low' }).inspection).toBe(false)
  })

  it('treats metal cladding as the cheapest exterior', () => {
    expect(materialGuidance('metal').labour_factor).toBeLessThan(1)
  })

  it('suggests a bare-substrate condition for unpainted brick', () => {
    expect(materialGuidance('brick_face').suggested_condition).toBe('bare')
  })
})
