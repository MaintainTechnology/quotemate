// Tests for the pure extraction prompt + schema + parser.
// No I/O — these all run on string inputs.

import { describe, expect, it } from 'vitest'
import {
  ExtractedServiceSchema,
  ExtractedServicesSchema,
  buildExtractionPrompt,
  parseExtractionResponse,
  unwrapModelJson,
} from './trade-book-prompt'

const minimalService = {
  trade: 'electrical',
  name: 'Install LED downlight (new install)',
  category: 'downlight',
  default_unit: 'each',
  default_unit_price_ex_gst: 35,
  default_labour_hours: 1.75,
  source_citation: 'Page 12, Section 4.2',
}

describe('buildExtractionPrompt', () => {
  it('returns a prompt string', () => {
    const p = buildExtractionPrompt()
    expect(typeof p).toBe('string')
    expect(p.length).toBeGreaterThan(200)
  })

  it('includes the schema hint with key field names', () => {
    const p = buildExtractionPrompt()
    expect(p).toContain('default_labour_hours')
    expect(p).toContain('row_assumptions')
    expect(p).toContain('inspection_triggers')
    expect(p).toContain('always_inspection')
    expect(p).toContain('source_citation')
  })

  it('adds a trade hint when trade is provided', () => {
    const p = buildExtractionPrompt({ trade: 'plumbing' })
    expect(p).toContain('plumbing tradie')
    expect(p).toContain('trade="plumbing"')
  })

  it('omits the trade hint when trade is undefined', () => {
    const p = buildExtractionPrompt()
    expect(p).not.toContain(' tradie. Prefer trade=')
  })

  it('tells the model to return pure JSON, no markdown fences', () => {
    const p = buildExtractionPrompt()
    expect(p.toLowerCase()).toContain('no prose')
    expect(p.toLowerCase()).toContain('no markdown code fences')
  })
})

describe('ExtractedServiceSchema', () => {
  it('accepts a minimal valid service', () => {
    const r = ExtractedServiceSchema.safeParse(minimalService)
    expect(r.success).toBe(true)
    if (r.success) {
      // Schema fills in defaults for optional fields.
      expect(r.data.clarifying_questions).toEqual([])
      expect(r.data.row_assumptions).toEqual({})
      expect(r.data.inspection_triggers).toEqual([])
      expect(r.data.properties).toEqual({})
      expect(r.data.always_inspection).toBe(false)
      expect(r.data.materials).toEqual([])
    }
  })

  it('accepts a fully-populated service', () => {
    const full = {
      ...minimalService,
      description: 'New downlight install where no fitting exists.',
      default_exclusions: 'Excludes new wiring runs and ceiling repair',
      clarifying_questions: ['How many?', 'Which room?'],
      row_assumptions: { switch_within_metres: 5, max_storeys: 1 },
      inspection_triggers: ['raked ceiling', 'multi-storey'],
      properties: { weatherproof: false, new_install: true },
      always_inspection: false,
      materials: [
        { name: 'LED downlight 9W', brand: 'Clipsal', unit_price_ex_gst: 28 },
      ],
    }
    const r = ExtractedServiceSchema.safeParse(full)
    expect(r.success).toBe(true)
  })

  it('rejects a service with a missing required field', () => {
    const { name, ...rest } = minimalService
    void name
    const r = ExtractedServiceSchema.safeParse(rest)
    expect(r.success).toBe(false)
  })

  it('rejects a service with a negative price', () => {
    const r = ExtractedServiceSchema.safeParse({
      ...minimalService,
      default_unit_price_ex_gst: -5,
    })
    expect(r.success).toBe(false)
  })

  it('rejects a service with an unknown trade', () => {
    const r = ExtractedServiceSchema.safeParse({
      ...minimalService,
      trade: 'astronaut',
    })
    expect(r.success).toBe(false)
  })

  it('rejects a service with a too-long name', () => {
    const r = ExtractedServiceSchema.safeParse({
      ...minimalService,
      name: 'x'.repeat(200),
    })
    expect(r.success).toBe(false)
  })

  it('rejects clarifying_questions with blank entries', () => {
    const r = ExtractedServiceSchema.safeParse({
      ...minimalService,
      clarifying_questions: ['Real one', ''],
    })
    expect(r.success).toBe(false)
  })

  it('rejects a material with a negative price', () => {
    const r = ExtractedServiceSchema.safeParse({
      ...minimalService,
      materials: [{ name: 'Bad part', unit_price_ex_gst: -10 }],
    })
    expect(r.success).toBe(false)
  })
})

describe('ExtractedServicesSchema (top-level array)', () => {
  it('accepts an empty array', () => {
    const r = ExtractedServicesSchema.safeParse([])
    expect(r.success).toBe(true)
  })

  it('accepts an array of valid services', () => {
    const r = ExtractedServicesSchema.safeParse([minimalService, minimalService])
    expect(r.success).toBe(true)
  })

  it('rejects an array containing an invalid service', () => {
    const r = ExtractedServicesSchema.safeParse([
      minimalService,
      { ...minimalService, trade: 'astronaut' },
    ])
    expect(r.success).toBe(false)
  })
})

describe('unwrapModelJson', () => {
  it('returns plain JSON unchanged', () => {
    expect(unwrapModelJson('[{"a":1}]')).toBe('[{"a":1}]')
  })

  it('strips ```json ... ``` code fences', () => {
    expect(unwrapModelJson('```json\n[{"a":1}]\n```')).toBe('[{"a":1}]')
  })

  it('strips plain ``` ... ``` fences (no language tag)', () => {
    expect(unwrapModelJson('```\n[{"a":1}]\n```')).toBe('[{"a":1}]')
  })

  it('strips a UTF-8 BOM prefix', () => {
    expect(unwrapModelJson('﻿[{"a":1}]')).toBe('[{"a":1}]')
  })

  it('slices out the array from prose-wrapped output', () => {
    const wrapped = 'Here is the JSON you asked for:\n\n[{"a":1}]\n\nLet me know if you need more!'
    expect(unwrapModelJson(wrapped)).toBe('[{"a":1}]')
  })

  it('handles an unclosed leading fence', () => {
    expect(unwrapModelJson('```json\n[{"a":1}]')).toBe('[{"a":1}]')
  })
})

describe('parseExtractionResponse', () => {
  it('parses a clean array of one valid service', () => {
    const result = parseExtractionResponse(JSON.stringify([minimalService]))
    expect(result.hasRows).toBe(true)
    expect(result.rows).toHaveLength(1)
    expect(result.errors).toHaveLength(0)
    expect(result.rows[0].name).toBe(minimalService.name)
  })

  it('parses a fenced JSON response', () => {
    const fenced = '```json\n' + JSON.stringify([minimalService]) + '\n```'
    const result = parseExtractionResponse(fenced)
    expect(result.hasRows).toBe(true)
    expect(result.rows).toHaveLength(1)
  })

  it('parses a single-object response by treating it as a 1-item array', () => {
    const result = parseExtractionResponse(JSON.stringify(minimalService))
    expect(result.hasRows).toBe(true)
    expect(result.rows).toHaveLength(1)
  })

  it('handles a wrapped {services: [...]} response', () => {
    const wrapped = JSON.stringify({ services: [minimalService] })
    const result = parseExtractionResponse(wrapped)
    expect(result.hasRows).toBe(true)
    expect(result.rows).toHaveLength(1)
  })

  it('handles a wrapped {results: [...]} response', () => {
    const wrapped = JSON.stringify({ results: [minimalService] })
    const result = parseExtractionResponse(wrapped)
    expect(result.hasRows).toBe(true)
    expect(result.rows).toHaveLength(1)
  })

  it('returns a fatal error when the response is not JSON', () => {
    const result = parseExtractionResponse('this is not JSON at all')
    expect(result.hasRows).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].issues[0]).toContain('not valid JSON')
  })

  it('mixed valid/invalid rows — keeps the good, reports the bad', () => {
    const mix = [
      minimalService,
      { ...minimalService, trade: 'astronaut' }, // invalid
      { ...minimalService, name: 'OK row 2' }, // valid
    ]
    const result = parseExtractionResponse(JSON.stringify(mix))
    expect(result.hasRows).toBe(true)
    expect(result.rows).toHaveLength(2)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].index).toBe(1)
    expect(result.errors[0].issues.join(' ')).toContain('trade')
  })

  it('returns 0 rows and 1 error per invalid row when all are bad', () => {
    const all = [
      { ...minimalService, trade: 'astronaut' },
      { ...minimalService, default_unit_price_ex_gst: -1 },
    ]
    const result = parseExtractionResponse(JSON.stringify(all))
    expect(result.hasRows).toBe(false)
    expect(result.rows).toHaveLength(0)
    expect(result.errors).toHaveLength(2)
  })

  it('handles a primitive (string) response gracefully', () => {
    const result = parseExtractionResponse('"hello"')
    expect(result.hasRows).toBe(false)
    expect(result.errors).toHaveLength(1)
  })
})
