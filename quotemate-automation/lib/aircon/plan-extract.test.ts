import { describe, expect, it } from 'vitest'
import {
  buildPlanExtractionPrompt,
  LOAD_TYPE_BY_ROOM,
  modelAcceptsTemperature,
  parsePlanExtraction,
} from './plan-extract'

describe('buildPlanExtractionPrompt', () => {
  const prompt = buildPlanExtractionPrompt()

  it('demands every room with a page-percent polygon', () => {
    expect(prompt).toContain('EVERY ROOM')
    expect(prompt).toContain('polygon')
    expect(prompt).toContain('x" from the left edge (0-100)')
    expect(prompt).toContain('y" from the top edge (0-100)')
  })

  it('forbids guessing areas when no dimensions are printed', () => {
    expect(prompt).toContain('do NOT guess areas')
  })

  it('asks for the stated total area and strict JSON', () => {
    expect(prompt).toContain('stated_total_area_m2')
    expect(prompt).toContain('STRICT JSON only')
  })
})

describe('modelAcceptsTemperature', () => {
  it('rejects temperature for Opus 4.7/4.8', () => {
    expect(modelAcceptsTemperature('claude-opus-4-8')).toBe(false)
    expect(modelAcceptsTemperature('claude-opus-4-7')).toBe(false)
  })
  it('accepts temperature for older models', () => {
    expect(modelAcceptsTemperature('claude-sonnet-4-6')).toBe(true)
  })
})

const VALID = JSON.stringify({
  page: 2,
  rooms: [
    {
      name: 'BED 2',
      room_type: 'bedroom',
      polygon: [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 30 },
        { x: 10, y: 30 },
      ],
      dimensions_text: '3.6 x 4.2',
      area_m2: 15.12,
      confidence: 'high',
    },
    {
      name: 'FAMILY',
      room_type: 'living',
      polygon: [
        { x: 40, y: 10 },
        { x: 80, y: 10 },
        { x: 80, y: 50 },
        { x: 40, y: 50 },
      ],
      confidence: 'medium',
    },
  ],
  stated_total_area_m2: 184.2,
  overall_note: 'clear scan',
})

describe('parsePlanExtraction', () => {
  it('parses a clean response', () => {
    const parsed = parsePlanExtraction(VALID)
    expect(parsed).not.toBeNull()
    expect(parsed!.page).toBe(2)
    expect(parsed!.rooms).toHaveLength(2)
    expect(parsed!.rooms[0]).toMatchObject({
      name: 'BED 2',
      room_type: 'bedroom',
      dimensions_text: '3.6 x 4.2',
      area_m2: 15.12,
      confidence: 'high',
    })
    expect(parsed!.stated_total_area_m2).toBe(184.2)
  })

  it('tolerates prose around the JSON object', () => {
    const parsed = parsePlanExtraction(`Here is the read:\n${VALID}\nDone.`)
    expect(parsed?.rooms).toHaveLength(2)
  })

  it('returns null when there is no JSON at all', () => {
    expect(parsePlanExtraction('no rooms found, sorry')).toBeNull()
  })

  it('clamps out-of-range vertices into 0–100', () => {
    const parsed = parsePlanExtraction(
      JSON.stringify({
        page: 1,
        rooms: [
          {
            name: 'BED 1',
            room_type: 'bedroom',
            polygon: [
              { x: -5, y: 10 },
              { x: 130, y: 10 },
              { x: 50, y: 200 },
            ],
            confidence: 'high',
          },
        ],
        stated_total_area_m2: null,
        overall_note: '',
      }),
    )
    expect(parsed!.rooms[0].polygon).toEqual([
      { x: 0, y: 10 },
      { x: 100, y: 10 },
      { x: 50, y: 100 },
    ])
  })

  it('drops rooms with fewer than 3 usable vertices or no name', () => {
    const parsed = parsePlanExtraction(
      JSON.stringify({
        page: 1,
        rooms: [
          { name: 'BED 1', room_type: 'bedroom', polygon: [{ x: 1, y: 1 }, { x: 2, y: 2 }], confidence: 'high' },
          { name: '', room_type: 'living', polygon: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }] },
          { name: 'OK', room_type: 'living', polygon: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }] },
        ],
        stated_total_area_m2: null,
        overall_note: '',
      }),
    )
    expect(parsed!.rooms.map((r) => r.name)).toEqual(['OK'])
  })

  it('coerces unknown room types to other and bad confidence to medium', () => {
    const parsed = parsePlanExtraction(
      JSON.stringify({
        page: 1,
        rooms: [
          {
            name: 'SUNROOM',
            room_type: 'conservatory',
            polygon: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }],
            confidence: 'certain',
          },
        ],
        stated_total_area_m2: null,
        overall_note: '',
      }),
    )
    expect(parsed!.rooms[0].room_type).toBe('other')
    expect(parsed!.rooms[0].confidence).toBe('medium')
  })

  it('rejects implausible printed areas and stated totals', () => {
    const parsed = parsePlanExtraction(
      JSON.stringify({
        page: 0,
        rooms: [
          {
            name: 'BED 1',
            room_type: 'bedroom',
            polygon: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }],
            area_m2: 25000,
            confidence: 'high',
          },
        ],
        stated_total_area_m2: -4,
        overall_note: '',
      }),
    )
    expect(parsed!.page).toBe(1)
    expect(parsed!.rooms[0].area_m2).toBeNull()
    expect(parsed!.stated_total_area_m2).toBeNull()
  })
})

describe('LOAD_TYPE_BY_ROOM', () => {
  it('conditions bedrooms/studies as bedroom and living/kitchen as living', () => {
    expect(LOAD_TYPE_BY_ROOM.bedroom).toBe('bedroom')
    expect(LOAD_TYPE_BY_ROOM.study).toBe('bedroom')
    expect(LOAD_TYPE_BY_ROOM.living).toBe('living')
    expect(LOAD_TYPE_BY_ROOM.kitchen).toBe('living')
  })
  it('leaves wet areas, garages and circulation unconditioned', () => {
    expect(LOAD_TYPE_BY_ROOM.bathroom).toBeUndefined()
    expect(LOAD_TYPE_BY_ROOM.laundry).toBeUndefined()
    expect(LOAD_TYPE_BY_ROOM.garage).toBeUndefined()
    expect(LOAD_TYPE_BY_ROOM.hall).toBeUndefined()
  })
})
