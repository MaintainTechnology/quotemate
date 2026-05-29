import { describe, expect, it } from 'vitest'
import { buildVisionPrompt, parseVisionResponse } from './vision-verify'

describe('buildVisionPrompt', () => {
  it('asks both questions when a reference image is supplied', () => {
    const p = buildVisionPrompt({ address: '27 Smith St', hasReferenceImage: true })
    expect(p).toMatch(/FIRST image is the customer/)
    expect(p).toMatch(/SECOND image is a Google Maps satellite view/)
    expect(p).toMatch(/Does the first image show the SAME building/)
  })
  it('skips the match question when no reference image', () => {
    const p = buildVisionPrompt({ address: '27 Smith St', hasReferenceImage: false })
    expect(p).toMatch(/Skip the match question/)
    expect(p).toMatch(/Single image attached/)
  })
  it('lists every accepted material value', () => {
    const p = buildVisionPrompt({ address: '27 Smith St', hasReferenceImage: true })
    for (const m of [
      'colorbond_trimdek',
      'colorbond_kliplok',
      'concrete_tile',
      'terracotta_tile',
      'cement_sheet',
      'unknown',
    ]) {
      expect(p).toContain(m)
    }
  })
  it('demands strict JSON only', () => {
    const p = buildVisionPrompt({ address: '27 Smith St', hasReferenceImage: false })
    expect(p).toMatch(/STRICT JSON only/)
  })
})

describe('parseVisionResponse', () => {
  it('parses a typical strict-JSON response', () => {
    const v = parseVisionResponse(
      JSON.stringify({
        match: true,
        reason: 'Same hip-roof outline + brick chimney visible in both.',
        material: 'colorbond_trimdek',
        material_confidence: 'high',
        red_flags: [],
      }),
    )
    expect(v.match).toBe(true)
    expect(v.material).toBe('colorbond_trimdek')
    expect(v.materialConfidence).toBe('high')
    expect(v.redFlags).toEqual([])
  })

  it('tolerates a markdown ```json fence', () => {
    const v = parseVisionResponse(
      '```json\n{ "match": false, "reason": "Different roof shape.", "material": "concrete_tile", "material_confidence": "medium", "red_flags": [] }\n```',
    )
    expect(v.match).toBe(false)
    expect(v.material).toBe('concrete_tile')
  })

  it('collapses unparseable text to inconclusive', () => {
    expect(parseVisionResponse('hmm not sure').match).toBeNull()
    expect(parseVisionResponse('').material).toBe('unknown')
    expect(parseVisionResponse(undefined).materialConfidence).toBe('low')
  })

  it('coerces "true"/"false" strings, and "null" to null', () => {
    expect(parseVisionResponse('{ "match": "true", "material": "concrete_tile" }').match).toBe(true)
    expect(parseVisionResponse('{ "match": "no", "material": "concrete_tile" }').match).toBe(false)
    expect(parseVisionResponse('{ "match": null, "material": "concrete_tile" }').match).toBeNull()
  })

  it('rejects unknown material values, falling back to "unknown"', () => {
    expect(
      parseVisionResponse('{ "match": true, "material": "tin", "red_flags": [] }').material,
    ).toBe('unknown')
  })

  it('caps red_flags to 6 entries and trims long strings', () => {
    const long = 'x'.repeat(200)
    const v = parseVisionResponse(
      JSON.stringify({
        match: true,
        reason: 'ok',
        material: 'concrete_tile',
        material_confidence: 'high',
        red_flags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', long],
      }),
    )
    expect(v.redFlags).toHaveLength(6)
    expect(v.redFlags.every((s) => s.length <= 80)).toBe(true)
  })

  it('treats non-string red_flag entries as missing', () => {
    const v = parseVisionResponse(
      '{ "material": "concrete_tile", "red_flags": [1, true, "valid"] }',
    )
    expect(v.redFlags).toEqual(['valid'])
  })

  it('returns a reason capped at 240 chars', () => {
    const long = 'r'.repeat(400)
    const v = parseVisionResponse(
      JSON.stringify({ material: 'colorbond_trimdek', reason: long }),
    )
    expect(v.reason.length).toBeLessThanOrEqual(240)
  })
})
