// QuoteMax Brand Studio · bake brand-treated (duotone) photos.
// Usage: node scripts/studio/bake-photos.mjs
//
// next/og (satori) can't do mix-blend-mode or SVG filters, so we bake the DS
// duotone treatment into the source photos ONCE with sharp (which does support
// the multiply / soft-light blends), then the render templates just place the
// finished photo. Recipe mirrors lib/studio/tokens.ts DUOTONE.
//
// Sources: redesign/marketing/linkedin-carousel/img/*.jpg (committed).
// Output:  public/studio/photos/*.png (servable, referenced by templates).

import sharp from 'sharp'
import { readdirSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, parse } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..', '..') // quotemate-automation
const repoRoot = join(appRoot, '..')
const srcDir = join(repoRoot, 'redesign', 'marketing', 'linkedin-carousel', 'img')
const outDir = join(appRoot, 'public', 'studio', 'photos')
mkdirSync(outDir, { recursive: true })

const D = {
  saturation: 0.5,
  brightness: 0.86,
  charcoal: { r: 22, g: 18, b: 15, alpha: 0.42 },
  accent: { r: 255, g: 196, b: 0, alpha: 0.12 },
}
const WIDTH = 1400 // base width; templates crop via object-fit/position

const solid = (w, h, bg) => ({
  create: { width: w, height: h, channels: 4, background: bg },
})

async function bake(file) {
  const src = join(srcDir, file)
  const name = parse(file).name
  // Pass 1: resize + desaturate + darken.
  const pass1 = await sharp(src)
    .resize({ width: WIDTH, withoutEnlargement: true })
    .modulate({ saturation: D.saturation, brightness: D.brightness })
    .toBuffer({ resolveWithObject: true })
  const { width, height } = pass1.info
  // Pass 2: warm-charcoal multiply + accent soft-light, exactly sized to the base.
  await sharp(pass1.data)
    .composite([
      { input: solid(width, height, D.charcoal), blend: 'multiply' },
      { input: solid(width, height, D.accent), blend: 'soft-light' },
    ])
    .png({ quality: 90 })
    .toFile(join(outDir, `${name}.png`))
  return `${name}.png (${width}×${height})`
}

const files = readdirSync(srcDir).filter((f) => /\.(jpe?g|png)$/i.test(f))
if (!files.length) {
  console.error(`No source photos found in ${srcDir}`)
  process.exit(1)
}
console.log(`Baking ${files.length} photos → public/studio/photos/`)
for (const f of files) {
  try {
    console.log('  ✓', await bake(f))
  } catch (e) {
    console.error('  ✗', f, '—', e.message)
  }
}
console.log('Done.')
