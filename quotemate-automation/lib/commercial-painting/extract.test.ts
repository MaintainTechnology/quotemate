import { describe, it, expect } from 'vitest'
import {
  buildPaintTakeoffPrompt,
  buildMeasurementParsePrompt,
  parsePaintExtraction,
  parseMeasurementLines,
  normaliseSystem,
} from './extract'
import { classifyByFilename } from './classify'

describe('classifyByFilename — the four IGA pilot documents', () => {
  it('classifies each pilot filename correctly', () => {
    expect(classifyByFilename('AS73 IGA Swan Street [CP1]_2026-05-16.pdf')).toBe('plan_set')
    expect(classifyByFilename('IGA Swan Street painting areas measurments.pdf')).toBe('measurement_takeoff')
    expect(classifyByFilename('ESS26073_M200_P1_DUCTWORK LAYOUT.pdf')).toBe('services_layout')
    // 'IGA 2.pdf' carries no signal — heuristic says other; vision corrects it.
    expect(classifyByFilename('IGA 2.pdf')).toBe('other')
  })

  it('photo extensions and keywords classify as site_photo', () => {
    expect(classifyByFilename('site front.jpg')).toBe('site_photo')
    expect(classifyByFilename('IMG_2041.png')).toBe('site_photo')
  })

  it('measurement beats plan when both signals present (more specific first)', () => {
    expect(classifyByFilename('plan takeoff areas.pdf')).toBe('measurement_takeoff')
  })
})

describe('buildPaintTakeoffPrompt', () => {
  const prompt = buildPaintTakeoffPrompt({ jobHint: 'IGA Swan Street fit-out' })

  it('demands strict JSON with the PaintTakeoffItem fields', () => {
    expect(prompt).toContain('STRICT JSON')
    for (const field of ['surface', 'room', 'substrate', 'system', 'unit', 'quantity', 'coats', 'height_m', 'confidence', 'separate_price', 'note']) {
      expect(prompt).toContain(`"${field}"`)
    }
  })

  it('grounds the four systems and the finishes-schedule-first rule', () => {
    expect(prompt).toContain('spray_matt')
    expect(prompt).toContain('FINISHES SCHEDULE FIRST')
    expect(prompt).toContain('LATEST REVISION ONLY')
    expect(prompt).toContain('IGA Swan Street fit-out')
  })

  it('excludes unpaintable surfaces and demands provenance', () => {
    expect(prompt).toContain('ONLY PAINTED SURFACES')
    expect(prompt).toContain('PROVENANCE')
  })
})

describe('parsePaintExtraction', () => {
  const valid = JSON.stringify({
    job: { name: 'IGA Swan Street', address: '480 Swan St, Richmond VIC' },
    finishes_schedule: [{ code: 'PT-01', product: 'Dulux Professional', sheen: 'low sheen', surfaces: 'walls' }],
    items: [
      { surface: 'Retail concrete ceiling', room: 'Retail', substrate: 'concrete', system: 'spray_matt', unit: 'm2', quantity: 420, coats: 2, height_m: 5.2, confidence: 'high', separate_price: false, note: 'A-110 RCP' },
      { surface: 'BOH walls', room: 'BOH', substrate: 'plasterboard', system: 'low_sheen', unit: 'm2', quantity: 88.5, coats: 2, height_m: null, confidence: 'medium', separate_price: false, note: 'A-103' },
      { surface: 'Timber door', room: 'BOH', substrate: 'timber', system: 'semi_gloss', unit: 'item', quantity: 1, coats: 2, height_m: null, confidence: 'high', separate_price: false, note: 'door schedule' },
    ],
    overall_note: 'Excluded tiled splashbacks.',
  })

  it('parses a clean payload with job, schedule and items', () => {
    const p = parsePaintExtraction(valid)!
    expect(p.job.address).toContain('Richmond')
    expect(p.finishes_schedule[0].code).toBe('PT-01')
    expect(p.items).toHaveLength(3)
    expect(p.items[0].height_m).toBe(5.2)
    expect(p.items[0].source).toBe('plan')
    expect(p.items[2].unit).toBe('item')
  })

  it('survives markdown fences and trailing prose', () => {
    const fenced = 'Here is the takeoff:\n```json\n' + valid + '\n```\nLet me know if you need anything else.'
    const p = parsePaintExtraction(fenced)
    expect(p?.items).toHaveLength(3)
  })

  it('coerces field aliases, bad units and out-of-range coats', () => {
    const messy = JSON.stringify({
      items: [
        { name: 'Office walls', room: 'Office', system: 'LOW SHEEN', unit: 'sqm', area_m2: '45.5', coats: 9 },
        { surface: 'Cool room door', room: 'BOH', system: 'gloss enamel', unit: 'each', count: 2 },
      ],
    })
    const p = parsePaintExtraction(messy)!
    expect(p.items[0].surface).toBe('Office walls')
    expect(p.items[0].quantity).toBe(45.5)
    expect(p.items[0].unit).toBe('m2')
    expect(p.items[0].coats).toBe(2) // 9 out of range → default
    expect(p.items[0].system).toBe('low_sheen')
    expect(p.items[1].system).toBe('semi_gloss')
    expect(p.items[1].unit).toBe('item')
    expect(p.items[1].quantity).toBe(2)
  })

  it('unmappable system → low_sheen with LOW confidence (confirm step catches it)', () => {
    const p = parsePaintExtraction(JSON.stringify({
      items: [{ surface: 'Feature wall', room: 'Retail', system: 'limewash', unit: 'm2', quantity: 20 }],
    }))!
    expect(p.items[0].system).toBe('low_sheen')
    expect(p.items[0].confidence).toBe('low')
  })

  it('drops zero/negative/nameless lines, null on no usable items', () => {
    const p = parsePaintExtraction(JSON.stringify({
      items: [
        { surface: '', room: 'X', system: 'flat', unit: 'm2', quantity: 10 },
        { surface: 'Wall', room: 'X', system: 'flat', unit: 'm2', quantity: 0 },
      ],
    }))
    expect(p).toBeNull()
    expect(parsePaintExtraction('no json here at all')).toBeNull()
  })
})

describe('parseMeasurementLines', () => {
  it('parses the painter-takeoff shape with systems from notes', () => {
    const lines = parseMeasurementLines(JSON.stringify({
      lines: [
        { line_no: 1, surface: 'Retail concrete ceiling', room: 'Retail', unit: 'm2', quantity: 420, system: 'spray_matt', note: 'spray matt' },
        { line_no: 14, surface: 'BOH walls', room: 'BOH', unit: 'm2', quantity: 88.5, system: null, note: null },
        { line_no: 34, surface: 'Timber door', room: 'BOH', unit: 'item', quantity: 1, system: 'semi_gloss', note: 'qty one' },
      ],
      overall_note: '',
    }))!
    expect(lines).toHaveLength(3)
    expect(lines[0].system).toBe('spray_matt')
    expect(lines[1].system).toBeUndefined()
    expect(lines[2].unit).toBe('item')
    expect(lines[2].line_no).toBe(34)
  })

  it('skips unusable lines and returns null when nothing parses', () => {
    expect(parseMeasurementLines(JSON.stringify({ lines: [{ surface: '', quantity: 5 }] }))).toBeNull()
    expect(parseMeasurementLines('garbage')).toBeNull()
  })
})

describe('normaliseSystem', () => {
  it('maps the painter vocabulary onto the four systems', () => {
    expect(normaliseSystem('spray ceiling matt')).toBe('spray_matt')
    expect(normaliseSystem('suspension ceilings flat')).toBe('flat')
    expect(normaliseSystem('low-sheen walls')).toBe('low_sheen')
    expect(normaliseSystem('kitchen semi gloss premium')).toBe('semi_gloss')
    expect(normaliseSystem('weird finish')).toBeNull()
    expect(normaliseSystem(null)).toBeNull()
  })
})

describe('buildMeasurementParsePrompt', () => {
  it('demands faithful transcription with no merging', () => {
    const p = buildMeasurementParsePrompt()
    expect(p).toContain('EVERY line item faithfully')
    expect(p).toContain('STRICT JSON')
    expect(p).toContain('line_no')
  })
})
