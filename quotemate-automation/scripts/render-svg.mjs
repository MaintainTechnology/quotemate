// Render an SVG file to PNG via sharp. Usage:
//   node scripts/render-svg.mjs <input.svg> <output.png> <width> <height>
import sharp from 'sharp'
import { readFileSync } from 'node:fs'

const [, , inp, out, w, h] = process.argv
if (!inp || !out) {
  console.error('Usage: node scripts/render-svg.mjs <in.svg> <out.png> <w> <h>')
  process.exit(1)
}
await sharp(readFileSync(inp), { density: 200 })
  .resize(Number(w) || null, Number(h) || null)
  .png()
  .toFile(out)
console.log('✓ rendered', out)
