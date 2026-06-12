// Acceptance §9.5: Gemini repaint preview renders from IGA 2.pdf
// (image-only PDF) without altering the building structure. Exercises
// the real preview core: mupdf rasterise page 1 → commercial repaint
// prompt → geminiProvider.renderImage. Writes before/after PNGs.
//
// Usage: node --env-file=.env.local --import tsx scripts/accept-paint-preview.ts

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { rasterizePage, cropToPng } from '../lib/estimation/refine'
import { buildCommercialRepaintPrompt } from '../lib/commercial-painting/preview-prompt'
import { geminiProvider } from '../lib/ig-engine/providers/gemini'

async function main() {
  const pdf = readFileSync('C:/Users/dalig/Downloads/QuoteMate/commercial-painting/IGA 2.pdf')
  const raster = await rasterizePage(pdf, 1, 1600)
  const png = await cropToPng(raster, { x: 0, y: 0, w: raster.widthPx, h: raster.heightPx })
  console.log(`source: ${raster.widthPx}×${raster.heightPx}px (${Math.round(png.length / 1024)} KB)`)

  const prompt = buildCommercialRepaintPrompt({ colour: 'a crisp light-grey scheme with charcoal fascia' })
  const started = Date.now()
  const out = await geminiProvider.renderImage({
    system: prompt.system,
    user: prompt.user,
    sourceImage: { base64: png.toString('base64'), mime: 'image/png' },
    aspectRatio: '4:3',
  })
  console.log(`render: ${out.mime}, ${Math.round((Date.now() - started) / 1000)}s`)

  mkdirSync('scripts/output', { recursive: true })
  writeFileSync('scripts/output/iga-before.png', png)
  writeFileSync(
    `scripts/output/iga-after.${out.mime === 'image/jpeg' ? 'jpg' : 'png'}`,
    Buffer.from(out.base64, 'base64'),
  )
  console.log('Wrote scripts/output/iga-before.png + iga-after.*')
}

main().catch((e) => {
  console.error('PREVIEW ACCEPTANCE FAILED:', e)
  process.exitCode = 1
})
