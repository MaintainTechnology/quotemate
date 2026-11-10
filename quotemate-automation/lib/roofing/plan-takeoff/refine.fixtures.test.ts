// TKO-29's done-when on Grange: the live reading TKO-11 saved, finished as
// the calibrate stage finishes it, has four roofs with the carport bays scaled
// from their drawn outlines, and its checks make it ready. Skips where the
// plans or the reading (client documents, kept out of git) aren't on disk.

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
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
