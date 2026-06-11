import { describe, expect, it } from 'vitest'
import { parseDimensionText, polygonAreaPct, resolveRoomAreas } from './plan-scale'
import type { AcExtractedRoom, AcPlanPoint } from './types'

const rect = (x: number, y: number, w: number, h: number): AcPlanPoint[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
]

const room = (
  name: string,
  room_type: AcExtractedRoom['room_type'],
  polygon: AcPlanPoint[],
  extra: Partial<AcExtractedRoom> = {},
): AcExtractedRoom => ({
  name,
  room_type,
  polygon,
  area_m2: null,
  confidence: 'high',
  ...extra,
})

describe('parseDimensionText', () => {
  it('parses metre dimensions with x or ×', () => {
    expect(parseDimensionText('3.6 x 4.2')).toBeCloseTo(15.12, 2)
    expect(parseDimensionText('3.6 × 4.2')).toBeCloseTo(15.12, 2)
  })
  it('parses millimetre dimensions', () => {
    expect(parseDimensionText('3600 x 4200')).toBeCloseTo(15.12, 2)
    expect(parseDimensionText('3,600 × 4,200')).toBeCloseTo(15.12, 2)
  })
  it('parses unit-suffixed dimensions', () => {
    expect(parseDimensionText('3.6m x 4.2m')).toBeCloseTo(15.12, 2)
  })
  it('rejects garbage, missing input and implausible areas', () => {
    expect(parseDimensionText(undefined)).toBeNull()
    expect(parseDimensionText('big room')).toBeNull()
    expect(parseDimensionText('0.1 x 0.1')).toBeNull()
    expect(parseDimensionText('90 x 90')).toBeNull() // 8100 m² — misread
  })
})

describe('polygonAreaPct', () => {
  it('computes the shoelace area of a rectangle', () => {
    expect(polygonAreaPct(rect(10, 10, 20, 10))).toBe(200)
  })
  it('is orientation-independent', () => {
    const cw = rect(10, 10, 20, 10)
    const ccw = [...cw].reverse()
    expect(polygonAreaPct(ccw)).toBe(polygonAreaPct(cw))
  })
  it('returns 0 for degenerate polygons', () => {
    expect(polygonAreaPct([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBe(0)
  })
})

describe('resolveRoomAreas', () => {
  it('uses printed dimensions when present', () => {
    const out = resolveRoomAreas({
      rooms: [room('BED 2', 'bedroom', rect(0, 0, 20, 10), { dimensions_text: '3.6 x 4.2' })],
    })
    expect(out.rooms[0].area_m2).toBeCloseTo(15.1, 1)
    expect(out.rooms[0].area_source).toBe('dimensions')
    expect(out.dimensioned).toBe(true)
  })

  it('prefers the parsed dimension string over the model arithmetic', () => {
    const out = resolveRoomAreas({
      rooms: [
        room('BED 2', 'bedroom', rect(0, 0, 20, 10), {
          dimensions_text: '3.6 x 4.2',
          area_m2: 99,
        }),
      ],
    })
    expect(out.rooms[0].area_m2).toBeCloseTo(15.1, 1)
  })

  it('apportions undimensioned rooms from the stated total by polygon area', () => {
    const out = resolveRoomAreas({
      rooms: [
        room('BED 1', 'bedroom', rect(0, 0, 20, 10), { dimensions_text: '4 x 4' }), // 16 m²
        room('FAMILY', 'living', rect(0, 20, 40, 10)), // pct 400
        room('BED 2', 'bedroom', rect(0, 40, 20, 10)), // pct 200
      ],
      statedTotalM2: 76, // 60 m² left for the two undimensioned rooms
    })
    const family = out.rooms.find((r) => r.name === 'FAMILY')!
    const bed2 = out.rooms.find((r) => r.name === 'BED 2')!
    expect(family.area_m2).toBeCloseTo(40, 1)
    expect(bed2.area_m2).toBeCloseTo(20, 1)
    expect(family.area_source).toBe('stated_total_apportioned')
    expect(out.total_area_m2).toBeCloseTo(76, 1)
    expect(out.dimensioned).toBe(true)
  })

  it('infers the plan scale from dimensioned rooms when no total is known', () => {
    const out = resolveRoomAreas({
      rooms: [
        // 200 pct² ↔ 16 m² ⇒ 0.08 m²/pct²
        room('BED 1', 'bedroom', rect(0, 0, 20, 10), { dimensions_text: '4 x 4' }),
        room('FAMILY', 'living', rect(0, 20, 40, 10)), // 400 pct² → 32 m²
      ],
    })
    const family = out.rooms.find((r) => r.name === 'FAMILY')!
    expect(family.area_m2).toBeCloseTo(32, 1)
    expect(family.area_source).toBe('scale_inferred')
  })

  it('falls back to the solar footprint when nothing else exists, with a warning', () => {
    const out = resolveRoomAreas({
      rooms: [
        room('FAMILY', 'living', rect(0, 0, 40, 10)), // 400
        room('BED 1', 'bedroom', rect(0, 20, 20, 10)), // 200
      ],
      solarFloorAreaM2: 90,
    })
    expect(out.rooms.find((r) => r.name === 'FAMILY')!.area_m2).toBeCloseTo(60, 1)
    expect(out.rooms.find((r) => r.name === 'BED 1')!.area_m2).toBeCloseTo(30, 1)
    expect(out.dimensioned).toBe(false)
    expect(out.warnings.join(' ')).toMatch(/satellite footprint/)
  })

  it('maps load types: kitchen→living, study→bedroom, bathroom→unconditioned', () => {
    const out = resolveRoomAreas({
      rooms: [
        room('KITCHEN', 'kitchen', rect(0, 0, 10, 10), { dimensions_text: '3 x 3' }),
        room('STUDY', 'study', rect(20, 0, 10, 10), { dimensions_text: '3 x 3' }),
        room('BATH', 'bathroom', rect(40, 0, 10, 10), { dimensions_text: '2 x 3' }),
      ],
    })
    expect(out.rooms.find((r) => r.name === 'KITCHEN')!.load_type).toBe('living')
    expect(out.rooms.find((r) => r.name === 'STUDY')!.load_type).toBe('bedroom')
    expect(out.rooms.find((r) => r.name === 'BATH')!.load_type).toBeNull()
  })

  it('warns when the plan total disagrees with the satellite estimate', () => {
    const out = resolveRoomAreas({
      rooms: [room('FAMILY', 'living', rect(0, 0, 40, 10), { dimensions_text: '5 x 8' })], // 40 m²
      solarFloorAreaM2: 200,
    })
    expect(out.warnings.join(' ')).toMatch(/differs from the satellite/)
  })

  it('caps implausible single-room areas', () => {
    const out = resolveRoomAreas({
      rooms: [
        room('HUGE', 'living', rect(0, 0, 90, 90)),
        room('BED', 'bedroom', rect(0, 95, 2, 2), { dimensions_text: '3 x 3' }),
      ],
      statedTotalM2: 500,
    })
    const huge = out.rooms.find((r) => r.name === 'HUGE')!
    expect(huge.area_m2).toBeLessThanOrEqual(120)
    expect(out.warnings.join(' ')).toMatch(/capped/)
  })
})
