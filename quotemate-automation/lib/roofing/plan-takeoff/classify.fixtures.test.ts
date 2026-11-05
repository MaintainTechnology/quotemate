// TKO-10's done-when: the sheet index of both fixture plan sets matches
// eval/roof-takeoff/<fixture>/sheets.json. The PDFs are client documents kept
// out of git, so this skips where they aren't on disk. The pages the model
// reads (marked "model") get a stand-in answer from the expectations, unless
// TAKEOFF_LIVE_MODEL=1 asks the real model (needs ANTHROPIC_API_KEY):
//   TAKEOFF_LIVE_MODEL=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run lib/roofing/plan-takeoff/classify.fixtures.test.ts

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { classifyFile, isPreliminary, readSheetWithModel, type Sheet, type SheetReader } from './classify'

const FIXTURES = { grange: 'J14997-59-Grange-Rd', whittaker: 'J14945-5-Whittaker-St' }
const LIVE = process.env.TAKEOFF_LIVE_MODEL === '1'
const norm = (text: string | null) => (text ?? '').toUpperCase().replace(/\s+/g, ' ').trim()

for (const [fixture, folder] of Object.entries(FIXTURES)) {
  const expected: Array<Sheet & { model?: true }> = JSON.parse(readFileSync(`eval/roof-takeoff/${fixture}/sheets.json`, 'utf8')).sheets
  const files = [...new Set(expected.map((s) => s.file))]
  const dir = `docs/tag-roofing-requests/${folder}`

  describe.skipIf(!files.every((f) => existsSync(`${dir}/${f}`)))(`${fixture} sheet index`, () => {
    it.each(files)('%s', async (file) => {
      const want = expected.filter((s) => s.file === file)
      const answers = want.filter((s) => s.model)
      const standIn: SheetReader = async () => {
        const s = answers.shift()
        if (!s) throw new Error('the text left a page for the model that it should have read')
        return { number: s.number, title: s.title, revision: s.revision, status_text: s.status_text, kind: s.kind }
      }
      const { sheets, modelPages } = await classifyFile(file, new Uint8Array(readFileSync(`${dir}/${file}`)), LIVE ? readSheetWithModel : standIn)

      expect(modelPages).toBe(want.filter((s) => s.model).length)
      expect(sheets).toHaveLength(want.length)
      for (const [i, { model, ...sheet }] of want.entries()) {
        if (!(model && LIVE)) {
          expect(sheets[i]).toEqual(sheet)
          continue
        }
        // The model's wording may differ: it must name the same sheet, revision and status.
        expect(sheets[i]).toMatchObject({ page: sheet.page, number: sheet.number, revision: sheet.revision, kind: sheet.kind, used: sheet.used })
        expect(norm(sheets[i].title)).toBe(norm(sheet.title))
        expect(isPreliminary(sheets[i].status_text)).toBe(isPreliminary(sheet.status_text))
      }
    }, 180_000)
  })
}
