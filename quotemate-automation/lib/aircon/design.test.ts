import { describe, expect, it } from 'vitest'
import { designAcLayout, polygonCentroid, type AcDesignArgs } from './design'
import type { AcPlanPoint, AcResolvedRoom, RoomLoad } from './types'

const rect = (x: number, y: number, w: number, h: number): AcPlanPoint[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
]

const room = (
  name: string,
  room_type: AcResolvedRoom['room_type'],
  load_type: AcResolvedRoom['load_type'],
  polygon: AcPlanPoint[],
  area = 12,
): AcResolvedRoom => ({ name, room_type, load_type, polygon, area_m2: area, area_source: 'dimensions' })

const load = (name: string, room_type: RoomLoad['room_type'], kw: number): RoomLoad => ({
  name,
  room_type,
  area_m2: 12,
  volume_m3: 28.8,
  kw,
})

const ROOMS: AcResolvedRoom[] = [
  room('BED 1', 'bedroom', 'bedroom', rect(10, 10, 20, 20), 16),
  room('BED 2', 'bedroom', 'bedroom', rect(10, 40, 20, 20), 12),
  room('FAMILY', 'living', 'living', rect(50, 10, 40, 50), 38),
  room('HALL', 'hall', null, rect(32, 10, 16, 50), 9),
  room('BATH', 'bathroom', null, rect(10, 62, 20, 18), 6),
]

const LOADS: RoomLoad[] = [
  load('BED 1', 'bedroom', 1.7),
  load('BED 2', 'bedroom', 1.3),
  load('FAMILY', 'living', 5.7),
]

const ARGS: AcDesignArgs = {
  page: 1,
  rooms: ROOMS,
  loads: LOADS,
  ducted_kw: 7,
  ceiling_height: 'standard',
  storeys: 1,
}

describe('polygonCentroid', () => {
  it('finds the centre of a rectangle', () => {
    expect(polygonCentroid(rect(10, 10, 20, 20))).toEqual({ x: 20, y: 20 })
  })
  it('handles degenerate input', () => {
    expect(polygonCentroid([])).toEqual({ x: 50, y: 50 })
  })
})

describe('designAcLayout — ducted', () => {
  const design = designAcLayout(ARGS)

  it('places one outlet per conditioned room at its centroid, with its kW', () => {
    expect(design.ducted.outlets).toHaveLength(3)
    const family = design.ducted.outlets.find((o) => o.room === 'FAMILY')!
    expect(family.at).toEqual({ x: 70, y: 35 })
    expect(family.kw).toBe(5.7)
    // No outlets in unconditioned rooms.
    expect(design.ducted.outlets.map((o) => o.room)).not.toContain('HALL')
    expect(design.ducted.outlets.map((o) => o.room)).not.toContain('BATH')
  })

  it('runs a duct from the unit to every outlet', () => {
    expect(design.ducted.runs).toHaveLength(3)
    for (const run of design.ducted.runs) {
      expect(run.from).toEqual(design.ducted.unit)
    }
  })

  it('pulls the unit toward the big loads (kW-weighted)', () => {
    // FAMILY (5.7 of 8.7 kW) sits at x=70 — the unit must lean right of centre.
    expect(design.ducted.unit.x).toBeGreaterThan(50)
  })

  it('puts the return air in the hallway when the plan has one', () => {
    expect(design.ducted.return_air).toEqual({ x: 40, y: 35 })
  })

  it('groups zones living vs sleeping', () => {
    expect(design.ducted.zones).toEqual([
      { name: 'Living zone', rooms: ['FAMILY'] },
      { name: 'Sleeping zone', rooms: ['BED 1', 'BED 2'] },
    ])
  })

  it('places the outdoor unit outside the building envelope', () => {
    const o = design.ducted.outdoor
    const inside = o.x > 10 && o.x < 90 && o.y > 10 && o.y < 80
    expect(inside).toBe(false)
  })

  it('is deterministic', () => {
    expect(designAcLayout(ARGS)).toEqual(design)
  })
})

describe('designAcLayout — gates and warnings', () => {
  it('flags 3-phase at 12 kW+', () => {
    const d = designAcLayout({ ...ARGS, ducted_kw: 14 })
    expect(d.ducted.warnings.join(' ')).toMatch(/3-phase/)
  })
  it('flags the roof cavity for raked ceilings', () => {
    const d = designAcLayout({ ...ARGS, ceiling_height: 'raked' })
    expect(d.ducted.warnings.join(' ')).toMatch(/roof cavity|cavity/)
  })
  it('flags riser checks for 3+ levels', () => {
    const d = designAcLayout({ ...ARGS, storeys: 3 })
    expect(d.ducted.warnings.join(' ')).toMatch(/risers?/)
  })
  it('stays quiet when nothing trips', () => {
    const d = designAcLayout(ARGS)
    expect(d.ducted.warnings).toEqual([])
    expect(d.split.warnings).toEqual([])
  })
  it('warns on an empty conditioned set', () => {
    const d = designAcLayout({ ...ARGS, rooms: [ROOMS[3], ROOMS[4]], loads: [] })
    expect(d.ducted.outlets).toEqual([])
    expect(d.split.heads).toEqual([])
    expect(d.ducted.warnings.join(' ')).toMatch(/No conditioned rooms/)
  })
})

describe('designAcLayout — split', () => {
  const design = designAcLayout(ARGS)

  it('places one head per conditioned room on an outer wall', () => {
    expect(design.split.heads).toHaveLength(3)
    const bed1 = design.split.heads.find((h) => h.room === 'BED 1')!
    // BED 1 sits top-left; its farthest-from-centre edge midpoint is the
    // left wall (x=10) or top wall (y=10) — never the room centre.
    expect(bed1.at).not.toEqual({ x: 20, y: 20 })
    expect(bed1.kw).toBe(1.7)
  })

  it('warns when the head count exceeds the multi-split practical limit', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      room(`BED ${i + 1}`, 'bedroom', 'bedroom', rect(10 + i * 12, 10, 10, 10)),
    )
    const d = designAcLayout({
      ...ARGS,
      rooms: many,
      loads: many.map((r) => load(r.name, 'bedroom', 1.5)),
    })
    expect(d.split.warnings.join(' ')).toMatch(/ducted is usually the better fit/)
  })
})
