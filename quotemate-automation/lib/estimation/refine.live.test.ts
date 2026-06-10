// LIVE eval of the tiled refine pass — costs real API calls, so it only runs
// when explicitly requested:
//
//   LIVE_REFINE=1 LIVE_PDF="<plan.pdf>" LIVE_PAGE=5 npx vitest run lib/estimation/refine.live.test.ts
//
// (Run from an UPPERCASE drive path on Windows — vitest-dev/vitest#5251.)

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { refineCounts } from './refine'

const LIVE = !!process.env.LIVE_REFINE

describe.skipIf(!LIVE)('refineCounts (live)', () => {
  it(
    'recounts dense lighting items on one sheet with positions',
    { timeout: 600_000 },
    async () => {
      const pdf = readFileSync(process.env.LIVE_PDF!)
      const page = Number(process.env.LIVE_PAGE ?? 5)
      const result = await refineCounts({
        pdf,
        page,
        targets: [
          {
            type: 'Feature Recessed LED Downlight 12W',
            symbol: 'small circle (recessed downlight)',
            hint: 'general/feature downlight, some labelled 12W; NOT ones labelled 9W or IP65',
          },
          {
            type: 'Feature Recessed LED Downlight 9W @ mirrors',
            symbol: 'small circle labelled 9W',
            hint: 'at mirrors in the amenities/toilet area',
          },
          {
            type: 'Shower Recessed LED Downlight IP65',
            symbol: 'small circle labelled IP65',
            hint: 'in shower compartments',
          },
          {
            type: 'General LED Panel',
            symbol: 'plain rectangle panel',
            hint: '1200x300 surface mounted LED panel',
          },
        ],
      })
      console.log(JSON.stringify(result, null, 2))
      expect(result.items).toHaveLength(4)
      for (const item of result.items) {
        expect(item.locations).toHaveLength(item.count)
      }
    },
  )
})
