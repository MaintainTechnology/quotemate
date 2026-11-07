// TKO-13's done-when on the fixtures: Grange's hand-measured reference takeoff
// (DEC-012) is ready, with the brief's own verdict of C1 to C8 passing and C9
// warning about stages; Whittaker's reading is needs_review with C8, and so is
// its hand-measured reference (TKO-00d). Grange's area schedule is read off its
// A0000 title sheet, so those skip where the PDFs (client documents, kept out
// of git) or the saved reading are not on disk.

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { areaSchedule, runChecks } from './checks'
import { pageText } from './classify'
import { RoofPlanTakeoffSchema } from './schema'

const GRANGE_PLANS = 'docs/tag-roofing-requests/grange/architectural.pdf'
const WHITTAKER_READING = 'docs/tag-roofing-requests/whittaker/reading.json'
const scopeNote = (fixture: string) => JSON.parse(readFileSync(`eval/roof-takeoff/${fixture}/request.json`, 'utf8')).scope_note as string

describe.skipIf(!existsSync(GRANGE_PLANS))('Grange checks', () => {
  it('are ready on the hand-measured takeoff, with C9 warning that the request names no stage', async () => {
    const reference = RoofPlanTakeoffSchema.parse(JSON.parse(readFileSync('eval/roof-takeoff/grange/takeoff.json', 'utf8')))
    const { getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(readFileSync(GRANGE_PLANS)))
    const schedule = areaSchedule(await pageText(pdf, 1), 'Architectural.pdf', 1)
    await pdf.destroy()

    const checks = runChecks(reference, { scopeNote: scopeNote('grange'), schedule })
    expect(checks.status).toBe('ready')
    expect(checks.results.map((r) => `${r.id} ${r.result}`)).toEqual([
      'C1 pass', 'C2 pass', 'C3 pass', 'C4 pass', 'C5 pass', 'C6 pass', 'C7 pass', 'C8 pass', 'C9 warning', 'C10 skipped',
    ])
    expect(checks.results[2].detail).toBe("230.55 m² on plan against the schedule's 233 m² proposed dual occupancy footprint (1.1%).")
    expect(checks.results[8].detail).toBe("The drawings show 4 roofs over 2 stages, and the request doesn't say which stages to price.")
  }, 60_000)
})

describe.skipIf(!existsSync(WHITTAKER_READING))('Whittaker checks', () => {
  it('need review, with C8 warning that the drawings are preliminary', () => {
    const reading = RoofPlanTakeoffSchema.parse(JSON.parse(readFileSync(WHITTAKER_READING, 'utf8')))
    const checks = runChecks(reading, { scopeNote: scopeNote('whittaker'), schedule: [] })
    expect(checks.status).toBe('needs_review')
    expect(checks.results.find((r) => r.id === 'C8')).toMatchObject({
      result: 'warning', detail: expect.stringMatching(/A104.*marked PRELIMINARY 21\.04\.26/),
    })
  })
})

// The reference is in git, so this always runs. A correct reading of Whittaker
// still needs review: its one written dimension is drawn as outlines, so the
// scale rests on the title block and C1 fails, as Service Spec §12 expects.
describe("Whittaker's reference checks", () => {
  it('need review on C1 alone, with the deck excluded and C8 warning', () => {
    const reference = RoofPlanTakeoffSchema.parse(JSON.parse(readFileSync('eval/roof-takeoff/whittaker/takeoff.json', 'utf8')))
    const checks = runChecks(reference, { scopeNote: scopeNote('whittaker'), schedule: [] })
    expect(checks.status).toBe('needs_review')
    expect(checks.results.map((r) => `${r.id} ${r.result}`)).toEqual([
      'C1 fail', 'C2 pass', 'C3 skipped', 'C4 pass', 'C5 pass', 'C6 pass', 'C7 pass', 'C8 warning', 'C9 pass', 'C10 skipped',
    ])
    expect(checks.results[0].detail).toBe('No written dimension could be measured to confirm the stated 1:50 @ A1 (an A1 sheet printed at 50% size).')
    expect(checks.results[1].detail).toBe("Each plane's dimensions agree with its area within 3% (11 compared).")
    expect(checks.results[5].detail).toBe('Excluded from the totals: Insulated roof over the new deck.')
    expect(checks.results[7].detail).toMatch(/A104.*marked PRELIMINARY 21\.04\.26/)
  })
})
