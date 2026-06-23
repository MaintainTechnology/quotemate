// QuoteMax · build raster brand assets from the master SVG (app/icon.svg).
// Usage: node scripts/build-brand-assets.mjs
//
// Emits, all derived from the one vector source so they never drift:
//   · app/favicon.ico        — multi-size (16/32/48) PNG-compressed ICO (legacy/Safari)
//   · app/apple-icon.png     — 180×180 iOS home-screen icon
//   · public/brand/quotemax-icon-512.png  + -1024.png — high-res app icon for stores/decks
// Next 16 auto-links app/icon.svg, app/favicon.ico and app/apple-icon.png from <head>.

import sharp from 'sharp'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const svg = readFileSync(join(root, 'app', 'icon.svg'))
const brandDir = join(root, 'public', 'brand')
mkdirSync(brandDir, { recursive: true })

// density high so small sizes still antialias crisply from the vector source.
const png = (size) => sharp(svg, { density: 512 }).resize(size, size).png().toBuffer()

// ── favicon.ico: pack 16/32/48 PNG entries into one ICO container ───────
function buildIco(sizes, buffers) {
  const count = sizes.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)
  const entries = []
  let offset = 6 + count * 16
  for (let i = 0; i < count; i++) {
    const e = Buffer.alloc(16)
    const s = sizes[i]
    e.writeUInt8(s >= 256 ? 0 : s, 0) // width  (0 == 256)
    e.writeUInt8(s >= 256 ? 0 : s, 1) // height
    e.writeUInt8(0, 2) // palette
    e.writeUInt8(0, 3) // reserved
    e.writeUInt16LE(1, 4) // colour planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(buffers[i].length, 8)
    e.writeUInt32LE(offset, 12)
    offset += buffers[i].length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...buffers])
}

const icoSizes = [16, 32, 48]
const icoPngs = await Promise.all(icoSizes.map(png))
writeFileSync(join(root, 'app', 'favicon.ico'), buildIco(icoSizes, icoPngs))
writeFileSync(join(root, 'app', 'apple-icon.png'), await png(180))
writeFileSync(join(brandDir, 'quotemax-icon-512.png'), await png(512))
writeFileSync(join(brandDir, 'quotemax-icon-1024.png'), await png(1024))

// ── OpenGraph default share image (1200×630) for the marketing site ─────
// Next 16 auto-uses app/opengraph-image.png as the site's default OG image.
const ogSvg = readFileSync(join(brandDir, 'quotemax-og.svg'))
const og = await sharp(ogSvg, { density: 144 }).resize(1200, 630).png().toBuffer()
writeFileSync(join(root, 'app', 'opengraph-image.png'), og)
writeFileSync(join(brandDir, 'quotemax-og.png'), og)

console.log('✓ Built: app/favicon.ico (16/32/48), app/apple-icon.png (180), app/opengraph-image.png (1200×630), public/brand/quotemax-icon-{512,1024}.png + quotemax-og.png')
