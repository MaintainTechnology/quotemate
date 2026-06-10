// Dump small PNG thumbnails of every page of a PDF (visual sheet ID for raster
// plan sets). Usage: node scripts/pdf-thumbs.mjs "<pdf path>" [outDir]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import * as mupdf from 'mupdf'

const out = process.argv[3] ?? 'estimation-output/thumbs'
mkdirSync(out, { recursive: true })
const doc = mupdf.Document.openDocument(readFileSync(process.argv[2]), 'application/pdf')
for (let i = 0; i < doc.countPages(); i++) {
  const page = doc.loadPage(i)
  const [x0, , x1] = page.getBounds()
  const zoom = 900 / Math.max(1, x1 - x0)
  const pix = page.toPixmap(mupdf.Matrix.scale(zoom, zoom), mupdf.ColorSpace.DeviceRGB, true, true)
  writeFileSync(`${out}/p${String(i + 1).padStart(2, '0')}.png`, pix.asPNG())
  pix.destroy()
  page.destroy()
}
doc.destroy()
console.log(`saved ${doc.countPages?.() ?? ''}thumbnails → ${out}`)
