// Asserts the tab icon survives BOTH tab strips, whichever file the browser
// picks. Run after scripts/build-brand-assets.mjs:
//   node scripts/check-icon-transparency.mjs
//
// Three things it pins down, each of which has broken once already:
//   1. No background tile on icon.svg or favicon.ico (the white box).
//   2. The body is CHARCOAL everywhere, and no media query can flip it. White
//      bodies on dark tab strips were rejected; a stylesheet in here reintroduces
//      one the moment a browser honours it, so the rules must stay absent.
//   3. apple-icon stays opaque, or iOS composites it onto black.

import sharp from 'sharp'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const GOLD = [0xff, 0xc4, 0x00]
const CHARCOAL = [0x16, 0x12, 0x0f]

async function raw(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const px = (x, y) => {
    const i = (y * info.width + x) * info.channels
    return [data[i], data[i + 1], data[i + 2], data[i + 3]]
  }
  return { info, px }
}

// Corner alpha is the tell: a full-bleed tile makes every corner opaque, and
// the glyph never reaches the corners, so transparent corners == no tile.
async function corners(buf) {
  const { info, px } = await raw(buf)
  const { width: w, height: h } = info
  return [px(0, 0)[3], px(w - 1, 0)[3], px(0, h - 1)[3], px(w - 1, h - 1)[3]]
}

// Which of the two brand colours dominates the opaque pixels. This is what
// catches a fallback that renders in the wrong colourway.
async function dominantBody(buf) {
  const { info, px } = await raw(buf)
  let gold = 0
  let charcoal = 0
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const [r, g, b, a] = px(x, y)
      if (a < 250) continue
      const near = (c) => Math.abs(r - c[0]) < 24 && Math.abs(g - c[1]) < 24 && Math.abs(b - c[2]) < 24
      if (near(GOLD)) gold++
      else if (near(CHARCOAL)) charcoal++
    }
  }
  assert.ok(gold + charcoal > 0, 'no brand-coloured pixels at all — glyph missing')
  return { gold, charcoal, body: gold >= charcoal ? 'gold' : 'charcoal' }
}

const svgBuf = readFileSync(join(root, 'app', 'icon.svg'))
// Markup only. The file's comment block discusses the very things asserted
// against below ("white", "prefers-color-scheme"), so testing the raw text
// makes the documentation fail the check.
const svgText = readFileSync(join(root, 'app', 'icon.svg'), 'utf8').replace(/<!--[\s\S]*?-->/g, '')

// ── 1. icon.svg: no tile, and no theme switching at all ────────────────
assert.ok(!/<rect[^>]*width="699"/.test(svgText), 'icon.svg full-bleed rect is back')
assert.ok(
  !/prefers-color-scheme/.test(svgText),
  'icon.svg has a prefers-color-scheme rule again — the favicon is one fixed colourway',
)
assert.ok(!/<style/.test(svgText), 'icon.svg has a stylesheet again — fills belong on the paths')
assert.match(svgText, /fill="#16120F"/, 'icon.svg lost its charcoal body')
assert.match(svgText, /fill="#FFC400"/, 'icon.svg lost its gold notch')

const svgPng = await sharp(svgBuf, { density: 512 }).resize(64, 64).png().toBuffer()
assert.deepEqual(await corners(svgPng), [0, 0, 0, 0], 'icon.svg has a background tile')

// ── 2. charcoal body, gold notch — the logo-4 colourway, no white ───────
const marked = await dominantBody(svgPng)
assert.equal(
  marked.body,
  'charcoal',
  `icon.svg body is ${marked.body} (gold ${marked.gold}px vs charcoal ${marked.charcoal}px), want charcoal`,
)
assert.ok(marked.gold > 0, 'icon.svg has no gold pixels — the notch is missing')
assert.ok(!/#FFFFFF|#ffffff|fill="white"/.test(svgText), 'icon.svg went white again')

// ── 3. favicon.ico: every packed size, same two properties ──────────────
const ico = readFileSync(join(root, 'app', 'favicon.ico'))
const count = ico.readUInt16LE(4)
assert.equal(count, 3, `favicon.ico should pack 16/32/48, got ${count}`)
for (let i = 0; i < count; i++) {
  const e = 6 + i * 16
  const entry = ico.subarray(ico.readUInt32LE(e + 12), ico.readUInt32LE(e + 12) + ico.readUInt32LE(e + 8))
  assert.deepEqual(await corners(entry), [0, 0, 0, 0], `favicon.ico entry ${i} has a background tile`)
  const { body } = await dominantBody(entry)
  assert.equal(body, 'charcoal', `favicon.ico entry ${i} body is ${body}, want charcoal`)
}

// ── 4. apple-icon.png: the inverse — opaque, on charcoal, 180px ─────────
const apple = readFileSync(join(root, 'app', 'apple-icon.png'))
assert.deepEqual(
  await corners(apple),
  [255, 255, 255, 255],
  'apple-icon.png went transparent — iOS will composite it onto black',
)
const { info: appleInfo, px: applePx } = await raw(apple)
assert.deepEqual(applePx(0, 0).slice(0, 3), [0xfa, 0xf8, 0xf4], 'apple-icon ground is not #FAF8F4')
assert.equal(appleInfo.width, 180, 'apple-icon should be 180x180')

console.log(
  `✓ icon.svg + favicon.ico: no tile, charcoal body + gold notch ` +
    `(${marked.charcoal}px charcoal vs ${marked.gold}px gold), no theme switching; ` +
    'apple-icon opaque on #FAF8F4',
)
