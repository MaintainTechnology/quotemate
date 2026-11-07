// RoofPlanTakeoff v1's bounds (TKO-28): generous beside any reading so far
// (Grange's: 4 roofs, 49 sheets, 700 values, no text over 282 characters), and
// a size check that refuses a body too big to be a reading before zod parses
// it, as parsing a hostile one blocks the event loop for seconds.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RoofPlanTakeoffSchema, takeoffTooLarge, type RoofPlanTakeoff } from './schema'

const GRANGE = RoofPlanTakeoffSchema.parse(JSON.parse(readFileSync('eval/roof-takeoff/grange/takeoff.json', 'utf8')))
const [roof] = GRANGE.structures
const [plane] = roof.planes
const withPlane = (over: Partial<RoofPlanTakeoff['structures'][number]['planes'][number]>): unknown =>
  ({ ...GRANGE, structures: [{ ...roof, planes: [{ ...plane, ...over }] }] })

describe('RoofPlanTakeoffSchema bounds', () => {
  it('takes every reading so far', () => {
    expect(RoofPlanTakeoffSchema.safeParse(GRANGE).success).toBe(true)
  })

  it('refuses a profile no drawing would print, and more roofs than any job has', () => {
    expect(RoofPlanTakeoffSchema.safeParse(withPlane({ profile: 'x'.repeat(201) })).success).toBe(false)
    expect(RoofPlanTakeoffSchema.safeParse({ ...GRANGE, structures: Array.from({ length: 51 }, () => roof) }).success).toBe(false)
    expect(RoofPlanTakeoffSchema.safeParse({ ...GRANGE, scope: { ...GRANGE.scope, questions: ['?'.repeat(2001)] } }).success).toBe(false)
  })
})

describe('takeoffTooLarge', () => {
  it('passes a real reading and refuses a hostile body without walking all of it', () => {
    expect(takeoffTooLarge(GRANGE)).toBe(false)
    // Built before the clock starts, so the budget times the check alone, not a loaded machine building them.
    const roofs = { structures: Array.from({ length: 300_000 }, () => ({})) }
    const questions = { scope: { questions: ['x'.repeat(300_000)] } }
    const started = performance.now()
    expect(takeoffTooLarge(roofs)).toBe(true)
    expect(takeoffTooLarge(questions)).toBe(true)
    expect(performance.now() - started).toBeLessThan(200)
  })
})
