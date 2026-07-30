// Render background.html to one 1920x1080 PNG per variant.
//
// 1920x1080 IS the target, not a master to downscale: Zoom, Teams and Meet all
// want 16:9 at 1920x1080, and a 2x file is only worth having if you also want a
// 4K version, hence --scale 2.
//
// Run:  node render.mjs                 # 4 backgrounds at 1920x1080
//       node render.mjs --guides        # same, with the safe-zone overlay drawn
//       node render.mjs --scale 2       # 3840x2160, for 4K capture
//       node render.mjs --only 1        # re-shoot one

import { chromium } from 'playwright'
import http from 'node:http'
import { readFile, mkdir, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'out')
const SRC = 'background.html'
const argv = process.argv.slice(2)
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const scale = Number(flag('scale', '1'))
const [W, H] = flag('size', '1920x1080').split('x').map(Number)
const only = flag('only', '') ? flag('only', '').split(',').map((s) => Number(s.trim())) : null
const wantGuides = argv.includes('--guides')

const src = readFileSync(join(here, SRC), 'utf8')
// Counted from the source so adding a variant to the V array is the only edit.
const ids = [...src.matchAll(/^\{id:'([^']+)'/gm)].map((m) => m[1])
if (!ids.length) throw new Error(`no variants found in ${SRC}`)

const MIME = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' }
const server = http.createServer(async (req, res) => {
  const raw = decodeURIComponent(req.url.split('?')[0])
  const want = raw === '/' ? SRC : raw.replace(/^\/+/, '')
  try {
    // The request never becomes a path. Enumerate what exists and let the
    // request only SELECT from that list, so the value handed to readFile is
    // built from filesystem data rather than from user input. Without this,
    // join(here, req.url) resolves `..` and a dev server on localhost will
    // happily serve .env.local. (Matches the hardening in the sibling
    // linkedin-payment-terms renderer; CodeQL js/path-injection.)
    const entries = await readdir(here, { recursive: true })
    const hit = entries.find((e) => e.split(/[\\/]/).join('/') === want)
    if (!hit) { res.writeHead(404); res.end('not found'); return }
    const buf = await readFile(join(here, hit))
    res.writeHead(200, { 'content-type': MIME[extname(hit)] || 'application/octet-stream' })
    res.end(buf)
  } catch { res.writeHead(404); res.end('not found') }
})
const port = await new Promise((r) => server.listen(0, () => r(server.address().port)))
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: scale })
const page = await ctx.newPage()

const nums = only ?? ids.map((_, i) => i + 1)
console.log(`Rendering ${nums.length} of ${ids.length} background(s) at ${W * scale}x${H * scale} -> out/`)
for (const n of nums) {
  const q = `?v=${n - 1}${wantGuides ? '&guides' : ''}`
  await page.goto(`http://localhost:${port}/${SRC}${q}`, { waitUntil: 'networkidle' })
  // Fonts and images both have to settle. Manrope arriving late reflows the
  // lockup block after the shot, and a 2.8MB plate is not decoded on
  // networkidle. The blur filter also needs a frame to compose.
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map((im) => (im.complete ? 1 : new Promise((r) => { im.onload = im.onerror = r }))))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  })
  const name = `quotemax-${ids[n - 1]}${wantGuides ? '-GUIDES' : ''}.png`
  await page.screenshot({ path: join(OUT, name) })
  console.log(`  ok ${name}`)
}

await browser.close()
server.close()
console.log('Done.')
