// The eval's scorer (TKO-15) on the hand-measured takeoffs, against readings
// that each differ from them in one way.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RoofPlanTakeoffSchema, type RoofPlanTakeoff } from './schema'
import { scoreTakeoff, type Score } from './score'

const reference = (fixture: string) =>
  RoofPlanTakeoffSchema.parse(JSON.parse(readFileSync(`eval/roof-takeoff/${fixture}/takeoff.json`, 'utf8')))
const GRANGE = reference('grange')
const variant = (change: (t: RoofPlanTakeoff) => void) => {
  const t = structuredClone(GRANGE)
  change(t)
  return t
}
const planes = (t: RoofPlanTakeoff) => t.structures.flatMap((s) => s.planes)
const failing = (score: Score) => (['structures', 'area', 'pitch', 'edges'] as const).filter((gate) => !score[gate].pass)

describe('scoreTakeoff', () => {
  it('passes the reference against itself', () => {
    const score = scoreTakeoff(GRANGE, GRANGE)
    expect(score.pass).toBe(true)
    expect(score.area.detail).toBe('230.55 m² against 230.55 m² (0.0%).')
  })

  it('counts roofs exactly, so merging the carport bays fails, as the live reading does', () => {
    const merged = variant((t) => {
      const [, , west, east] = t.structures
      west.planes.push(...east.planes)
      west.edges.push(...east.edges)
      t.structures.pop()
    })
    const score = scoreTakeoff(GRANGE, merged)
    expect(failing(score)).toEqual(['structures'])
    expect(score.structures.detail).toBe('3 roofs read, 4 expected.')
  })

  it('holds plan area to 3% of the job total', () => {
    const scaled = (factor: number) => variant((t) => {
      for (const p of planes(t)) p.plan_area_m2 = (p.plan_area_m2 ?? 0) * factor
    })
    expect(scoreTakeoff(GRANGE, scaled(1.029)).area.pass).toBe(true)
    expect(scoreTakeoff(GRANGE, scaled(1.031)).area.pass).toBe(false)
  })

  it('scores each roof when the counts match, so offsetting errors fail', () => {
    // House 1 10% under and House 2 10% over leave the job's total exact.
    const offset = variant((t) => {
      t.structures[0].planes[0].plan_area_m2 = 87.53
      t.structures[1].planes[0].plan_area_m2 = 106.97
    })
    const score = scoreTakeoff(GRANGE, offset)
    expect(failing(score)).toEqual(['area'])
    expect(score.area.detail).toBe(
      '230.55 m² against 230.55 m² (0.0%). By roof: House 2 106.97 m² against 97.25 m² (10.0%); House 1 87.53 m² against 97.25 m² (10.0%).',
    )
  })

  it('pairs roofs by size, not by the order they were read in', () => {
    expect(scoreTakeoff(GRANGE, variant((t) => { t.structures.reverse() })).pass).toBe(true)
  })

  it('fails the area when a plane has none, as the live reading of the carport does', () => {
    const score = scoreTakeoff(GRANGE, variant((t) => { t.structures[2].planes[0].plan_area_m2 = null }))
    expect(failing(score)).toEqual(['area'])
    expect(score.area.detail).toBe('1 plane has no area, so the total is incomplete.')
  })

  it('holds each pitch to 2° both ways, and fails an unknown one', () => {
    const pitched = (deg: number | null) => variant((t) => { t.structures[0].planes[0].pitch_deg = deg })
    expect(scoreTakeoff(GRANGE, pitched(6.5)).pitch.pass).toBe(true) // within 2° of the houses' 5°
    expect(scoreTakeoff(GRANGE, pitched(10)).pitch.pass).toBe(false) // a pitch the reference doesn't have
    expect(scoreTakeoff(GRANGE, pitched(null)).pitch).toEqual({ pass: false, detail: 'A plane has no pitch.' })
    // Every plane at 6° misses the carports' 3°.
    const flat = variant((t) => { for (const p of planes(t)) p.pitch_deg = 6 })
    expect(scoreTakeoff(GRANGE, flat).pitch).toEqual({ pass: false, detail: '6° read, 5°, 3° expected.' })
  })

  it('holds each edge type to 5%, and fails a type on one side only or an unknown length', () => {
    const eave = (t: RoofPlanTakeoff) => t.structures[0].edges.find((e) => e.type === 'eave')!
    // The job's eaves total 26.17 m, so 1.2 m more is 4.6% and 1.62 m is 6.2%.
    expect(scoreTakeoff(GRANGE, variant((t) => { eave(t).length_m = 10.13 + 1.2 })).edges.pass).toBe(true)
    expect(scoreTakeoff(GRANGE, variant((t) => { eave(t).length_m = 10.13 + 1.62 })).edges).toEqual({
      pass: false, detail: 'eave 27.79 m against 26.17 m.',
    })
    const ridge = variant((t) => { t.structures[0].edges.push({ type: 'ridge', length_m: 5, source: 'measured', confidence: 'high' }) })
    expect(scoreTakeoff(GRANGE, ridge).edges.detail).toBe('ridge 5 m against 0 m.')
    expect(scoreTakeoff(GRANGE, variant((t) => { eave(t).length_m = null })).edges.detail).toBe('eave has an unknown length.')
  })
})

describe("scoreTakeoff on Whittaker's reference (TKO-00d)", () => {
  it('passes it against itself, over its three pitches', () => {
    const whittaker = reference('whittaker')
    const score = scoreTakeoff(whittaker, whittaker)
    expect(score.pass).toBe(true)
    expect(score.area.detail).toBe('122.08 m² against 122.08 m² (0.0%).')
    expect(score.pitch.detail).toBe('25°, 4.9°, 4.8° read, 25°, 4.9°, 4.8° expected.')
  })

  it("fails its valley read on plan: at the main roof's 25° that is 5% short, so lengths are along the roof (DEC-039)", () => {
    const whittaker = reference('whittaker')
    const onPlan = structuredClone(whittaker)
    onPlan.structures[0].edges.find((e) => e.type === 'valley')!.length_m = 3.178 // 2247 mm each way on plan
    expect(scoreTakeoff(whittaker, onPlan).edges).toEqual({ pass: false, detail: 'valley 3.18 m against 3.35 m.' })
  })
})
