// TKO-11's done-when: both fixtures read into schema-valid takeoffs, with
// evidence on every plane citing a chosen sheet. It asks the real model, so
// it runs only with TAKEOFF_LIVE_MODEL=1 and ANTHROPIC_API_KEY, where the PDFs
// are on disk:
//   TAKEOFF_LIVE_MODEL=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run lib/roofing/plan-takeoff/read.fixtures.test.ts
// The reading is saved as reading.json beside the PDFs (git ignores that
// folder: client documents), for working on calibration and checks offline.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Sheet } from './classify'
import { readPlans } from './read'
import { RoofPlanTakeoffSchema } from './schema'

const FIXTURES = { grange: 'J14997-59-Grange-Rd', whittaker: 'J14945-5-Whittaker-St' }
const LIVE = process.env.TAKEOFF_LIVE_MODEL === '1'

for (const [fixture, folder] of Object.entries(FIXTURES)) {
  // The expectations' "model" flags ride along; the schema drops them.
  const sheets: Sheet[] = JSON.parse(readFileSync(`eval/roof-takeoff/${fixture}/sheets.json`, 'utf8')).sheets
  const request = JSON.parse(readFileSync(`eval/roof-takeoff/${fixture}/request.json`, 'utf8'))
  const dir = `docs/tag-roofing-requests/${folder}`
  const files = [...new Set(sheets.filter((s) => s.used).map((s) => s.file))]

  describe.skipIf(!LIVE || !files.every((f) => existsSync(`${dir}/${f}`)))(`${fixture} reading`, () => {
    it('is a schema-valid takeoff with evidence on every plane', async () => {
      const started = Date.now()
      const read = await readPlans({
        sheets,
        files: new Map(files.map((f) => [f, new Uint8Array(readFileSync(`${dir}/${f}`))])),
        scopeNote: request.scope_note,
        job: { name: request.job_name, ref: request.job_ref, address: request.site_address },
      })
      if (!read.ok) throw new Error(read.note)
      const takeoff = RoofPlanTakeoffSchema.parse(read.takeoff)
      writeFileSync(`${dir}/reading.json`, JSON.stringify(takeoff, null, 2))

      const planes = takeoff.structures.flatMap((s) => s.planes)
      expect(planes.length).toBeGreaterThan(0)
      for (const plane of planes) {
        expect(plane.evidence.length).toBeGreaterThan(0)
        for (const e of plane.evidence) expect(sheets.some((s) => s.used && s.file === e.file && s.page === e.page)).toBe(true)
      }
      console.log(`${fixture}: ${((Date.now() - started) / 1000).toFixed(0)}s, ${read.usage.calls} call(s), ${read.usage.inputTokens} tokens in, ${read.usage.outputTokens} out`)
      for (const s of takeoff.structures) {
        console.log(`  ${s.id} ${s.label} (${s.role}): ${s.planes.map((p) => `${p.plan_area_m2} m² at ${p.pitch_deg}° ${p.profile ?? ''}`).join('; ')}${s.exclusions.length ? ` | excluded: ${s.exclusions.map((x) => x.label).join(', ')}` : ''}`)
      }
      console.log(`  questions: ${takeoff.scope.questions.length}`)
    }, 600_000)
  })
}
