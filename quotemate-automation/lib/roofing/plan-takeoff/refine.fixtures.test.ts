// TKO-29's done-when on Grange: the live reading TKO-11 saved, finished as
// the calibrate stage finishes it, has four roofs with the carport bays scaled
// from their drawn outlines, and its checks make it ready. Skips where the
// plans or the reading (client documents, kept out of git) aren't on disk.

import { existsSync, readFileSync } from 'node:fs'
import type { generateText } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { areaSchedule, runChecks } from './checks'
import { pageText } from './classify'
import { refineReading } from './refine'
import { RoofPlanTakeoffSchema } from './schema'
import { scoreTakeoff } from './score'

const DIR = 'docs/tag-roofing-requests/grange'
const PLANS = 'architectural.pdf'
const READING = `${DIR}/reading.json`
const read = (path: string) => RoofPlanTakeoffSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
const within = (actual: number | null, expected: number, pct: number) => Math.abs((actual ?? 0) / expected - 1) * 100 <= pct

describe.skipIf(!existsSync(`${DIR}/${PLANS}`) || !existsSync(READING))('Grange, measured from its outlines', () => {
  it('scales and splits the carport bays, and comes out ready', async () => {
    const reading = read(READING)
    const plans = () => new Map([[PLANS, new Uint8Array(readFileSync(`${DIR}/${PLANS}`))]])
    const { takeoff, measured } = await refineReading(reading, { sheets: reading.sheets, files: plans() })

    // The reading's one carport roof becomes the two bays, each 3219-odd by
    // 5599 mm as hand-measured (Service Spec §12: 36.05 m² within 3%).
    expect(measured).toBe(2)
    const bays = takeoff.structures.filter((s) => s.role === 'secondary').map((s) => s.planes[0])
    expect(bays).toHaveLength(2)
    const [west, east] = bays
    expect(within(west.plan_dims_mm![0], 3219, 1) && within(west.plan_dims_mm![1], 5599, 1)).toBe(true)
    expect(within(east.plan_dims_mm![0], 3220, 1) && within(east.plan_dims_mm![1], 5599, 1)).toBe(true)
    expect(within((west.plan_area_m2 ?? 0) + (east.plan_area_m2 ?? 0), 36.05, 3)).toBe(true)
    expect(west).toMatchObject({ pitch_deg: 3, confidence: 'medium' })
    expect(west.evidence.at(-1)).toMatchObject({ page: 6, text: expect.stringMatching(/^RF:03: drawn outline \d+ × \d+ mm/) })

    const { getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(plans().get(PLANS)!)
    const schedule = areaSchedule(await pageText(pdf, 1), PLANS, 1)
    await pdf.destroy()
    const scopeNote = JSON.parse(readFileSync('eval/roof-takeoff/grange/request.json', 'utf8')).scope_note as string
    const checks = runChecks(takeoff, { scopeNote, schedule })
    expect(checks.results.filter((r) => r.result === 'fail')).toEqual([])
    expect(checks.status).toBe('ready')

    // Against the hand-measured reference: the roofs, area and pitch now hold.
    const score = scoreTakeoff(read('eval/roof-takeoff/grange/takeoff.json'), takeoff)
    expect([score.structures.pass, score.area.pass, score.pitch.pass]).toEqual([true, true, true])
  }, 60_000)
})

// TKO-30's first half on Whittaker: its drawings write no pitch, and its text
// is drawn as outlines, so its reading has none. Its elevation's roof lines
// give the hipped house 25° and the new section's skillion 5° (DEC-044).
const WHITTAKER = 'docs/tag-roofing-requests/whittaker'
const W_READING = `${WHITTAKER}/reading.json`
const W_FILES = ['elevations.pdf', 'floor-plan.pdf', 'engineering.pdf', 'sections.pdf']

describe.skipIf(!W_FILES.every((f) => existsSync(`${WHITTAKER}/${f}`)) || !existsSync(W_READING))('Whittaker, pitched from its elevation', () => {
  it('pitches the hipped house at 25° and the new section at 5°, which passes the pitch gate', async () => {
    const reading = read(W_READING)
    const files = new Map(W_FILES.map((f) => [f, new Uint8Array(readFileSync(`${WHITTAKER}/${f}`))]))
    const { takeoff, pitched } = await refineReading(reading, { sheets: reading.sheets, files })

    expect(pitched).toBe(5)
    const [house, section] = takeoff.structures
    expect(house.planes.map((p) => [p.pitch_deg, p.pitch_source])).toEqual(house.planes.map(() => [25, 'elevation']))
    expect(section.planes[0]).toMatchObject({ pitch_deg: 5, pitch_source: 'elevation' })
    expect(house.planes[0].evidence).toContainEqual({ file: 'elevations.pdf', page: 1, text: expect.stringMatching(/^Pitch 25°/), bbox: null })

    // Against the hand-measured reference (TKO-00d): the pitches now hold.
    const score = scoreTakeoff(read('eval/roof-takeoff/whittaker/takeoff.json'), takeoff)
    expect([score.structures.pass, score.pitch.pass]).toEqual([true, true])
  }, 60_000)

  // TKO-30's second half: A104 dimensions nothing, but draws the hipped
  // house's hips, valley and ridges, so they measure it (DEC-045).
  it("measures the hipped house's six faces and its lines from A104's drawn hips and ridges, as the reference does", async () => {
    const reading = read(W_READING)
    const files = new Map(W_FILES.map((f) => [f, new Uint8Array(readFileSync(`${WHITTAKER}/${f}`))]))
    const { takeoff, hipped } = await refineReading(reading, { sheets: reading.sheets, files })
    const reference = read('eval/roof-takeoff/whittaker/takeoff.json')
    expect(hipped).toBe(6)

    // Each face within 1% of the reference's hip faces, smallest to largest.
    const [house, section] = takeoff.structures
    const [hipFaces] = reference.structures.map((s) => s.planes.filter((p) => p.pitch_deg === 25))
    const bySize = (planes: typeof hipFaces) => planes.map((p) => [p.fall, p.plan_area_m2 ?? 0] as const).sort((a, b) => a[1] - b[1])
    const [mine, theirs] = [bySize(house.planes), bySize(hipFaces)]
    expect(mine.map(([fall]) => fall)).toEqual(theirs.map(([fall]) => fall))
    expect(mine.every(([, area], i) => within(area, theirs[i][1], 1))).toBe(true)
    expect(house.planes.every((p) => p.confidence === 'medium' && p.polygon_mm && p.sloped_area_m2)).toBe(true)
    expect(house.planes[0].evidence.at(-1)).toMatchObject({ file: 'floor-plan.pdf', page: 1, text: expect.stringMatching(/^Hip roof: drawn hips and ridges, face 1 of 6/) })

    // Its lines within 0.5% of the reference's, along the roof at 25° (DEC-039).
    // The reference lists the hip roof's 15 lines first, then the lower roofs'.
    const lengths = (edges: typeof house.edges, type: string) => edges.filter((e) => e.type === type).map((e) => e.length_m ?? 0).sort((a, b) => a - b)
    const hipRoofLines = reference.structures[0].edges.slice(0, 15)
    for (const [type, count] of [['hip', 6], ['valley', 1], ['ridge', 2], ['eave', 6]] as const) {
      const [got, want] = [lengths(house.edges, type), lengths(hipRoofLines, type)]
      expect(got).toHaveLength(count)
      expect(got.every((l, i) => within(l, want[i], 0.5))).toBe(true)
    }

    // The new section stays as read. The job's area waits on the lower roofs
    // and the new section, which the reading neither lists nor places.
    expect(section.planes.map((p) => [p.id, p.plan_area_m2])).toEqual([['S2-P1', null]])
    const score = scoreTakeoff(reference, takeoff)
    expect([score.structures.pass, score.pitch.pass, score.area.pass]).toEqual([true, true, false])
  }, 60_000)

  // TKO-30's lower roofs and new section: A104's rib-filled areas, numbered on
  // the sheet and assigned by the model (DEC-047). A stand-in answers as the
  // drawing reads; the live reads are the eval's.
  const answering = (reply: object) => vi.fn().mockResolvedValue({ text: JSON.stringify(reply), finishReason: 'stop', usage: { inputTokens: 2600, outputTokens: 250 } }) as unknown as typeof generateText
  const AS_DRAWN = {
    areas: [
      { n: 1, roof: 'S1', fall: 'north' }, { n: 2, roof: 'S1', fall: 'east' }, { n: 3, roof: null, fall: 'west' },
      { n: 4, roof: 'S2', fall: 'west' }, { n: 5, roof: 'S1', fall: 'south' }, { n: 6, roof: 'S1', fall: 'east' },
    ],
    left_out: [{ label: 'Insulated roof over new deck', areas: [3] }],
  }
  const refined = (assign: typeof generateText) => {
    const reading = read(W_READING)
    const files = new Map(W_FILES.map((f) => [f, new Uint8Array(readFileSync(`${WHITTAKER}/${f}`))]))
    const scopeNote = JSON.parse(readFileSync('eval/roof-takeoff/whittaker/request.json', 'utf8')).scope_note as string
    return refineReading(reading, { sheets: reading.sheets, files, scopeNote, assign })
  }
  const roofArea = (s: { planes: Array<{ plan_area_m2: number | null }> }) => s.planes.reduce((sum, p) => sum + (p.plan_area_m2 ?? 0), 0)

  it('measures the lower roofs and the new section the model assigns on the numbered A104, which passes every gate', async () => {
    const { takeoff, regioned, usage } = await refined(answering(AS_DRAWN))
    expect([regioned, usage]).toEqual([5, { inputTokens: 2600, outputTokens: 250, calls: 1 }])
    const reference = read('eval/roof-takeoff/whittaker/takeoff.json')
    expect(scoreTakeoff(reference, takeoff).pass).toBe(true)
    // Each roof within 3% of the reference's, as the scorer pairing roofs holds them.
    const [house, section] = takeoff.structures
    expect([within(roofArea(house), 109.18, 3), within(roofArea(section), 12.9, 3)]).toEqual([true, true])
    expect(section.planes[0]).toMatchObject({ id: 'S2-P1', fall: 'west', pitch_deg: 5, confidence: 'medium' })
    // The deck's 45 m² is in no plane.
    expect(takeoff.structures.flatMap((s) => s.planes).some((p) => (p.plan_area_m2 ?? 0) > 40)).toBe(false)
  }, 60_000)

  it('never measures the left-out deck: given to the house it is still left out, and not found it stops everything', async () => {
    const given = { ...AS_DRAWN, areas: AS_DRAWN.areas.map((a) => (a.n === 3 ? { ...a, roof: 'S1' } : a)) }
    const { takeoff } = await refined(answering(given))
    expect(takeoff.structures.flatMap((s) => s.planes).some((p) => (p.plan_area_m2 ?? 0) > 40)).toBe(false)
    const lost = await refined(answering({ ...given, left_out: [] }))
    expect([lost.regioned, lost.refused]).toEqual([0, expect.stringContaining('Insulated roof over new deck')])
  }, 60_000)
})
