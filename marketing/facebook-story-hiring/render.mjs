// Render hiring-story.html to one 1080x1920 PNG per role, ready to post as a
// Facebook (or Instagram) story.
//
// Run from this folder:
//   node render.mjs                 # every role at 1080x1920, the size to upload
//   node render.mjs --scale 2       # 2160x3840 masters, for print or re-cropping
//   node render.mjs --guides        # also out/_guides-<id>.png with the safe zones drawn on
//   node render.mjs --only 1        # just the first role
//
// Every shot runs the page's own QA pass first (text overflow, safe zones,
// fonts, photos). Any failure stops the export, so a broken frame never
// reaches out/. Pass --force to write it anyway while iterating.

import { chromium } from 'playwright'
import http from 'node:http'
import { readFile, mkdir, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'out')
const SRC = 'hiring-story.html'
const W = 1080
const H = 1920
const argv = process.argv.slice(2)
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const scale = Number(flag('scale', '1'))
const only = flag('only', '') ? flag('only', '').split(',').map((s) => Number(s.trim())) : null
const wantGuides = argv.includes('--guides')
const force = argv.includes('--force')

// Counted from the source, so adding a role to the ROLES array is the only edit.
const ids = [...readFileSync(join(here, SRC), 'utf8').matchAll(/^\s*id:\s*'([^']+)'/gm)].map((m) => m[1])
if (!ids.length) throw new Error(`no roles found in ${SRC}`)

const MIME = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' }
const server = http.createServer(async (req, res) => {
  const raw = decodeURIComponent(req.url.split('?')[0])
  const want = raw === '/' ? SRC : raw.replace(/^\/+/, '')
  try {
    // The request never becomes a path. List what exists in this folder and
    // use the request only to SELECT from that list, so a request such as
    // /../../.env.local cannot reach anything outside it. Same pattern as
    // ../linkedin-payment-terms/render.mjs; split on both separators so the
    // match also works on Windows.
    const entries = await readdir(here, { recursive: true })
    const hit = entries.find((e) => e.split(/[\\/]/).join('/') === want)
    if (!hit) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    const buf = await readFile(join(here, hit))
    res.writeHead(200, { 'content-type': MIME[extname(hit)] || 'application/octet-stream' })
    res.end(buf)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)))
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: scale })
const page = await ctx.newPage()

const nums = only ?? ids.map((_, i) => i + 1)
let failed = 0
console.log(`Rendering ${nums.length} of ${ids.length} story frame(s) at ${W}x${H} @${scale}x -> out/`)
for (const n of nums) {
  const id = ids[n - 1]
  const shots = [['', '']].concat(wantGuides ? [['_guides-', '&guides=1']] : [])
  for (const [prefix, extra] of shots) {
    await page.goto(`http://127.0.0.1:${port}/${SRC}?r=${n - 1}${extra}`, { waitUntil: 'networkidle' })
    // Fonts and photos both have to settle: Manrope arriving late reflows every
    // headline after the shot. The page's QA pass waits for both.
    const qa = await page.evaluate(() => window.__ready)
    if (!qa.ok) {
      console.log(`  QA FAILED for ${id}:`)
      for (const issue of qa.issues) console.log(`    - ${issue}`)
      if (!force) { failed++; continue }
    }
    const name = prefix ? `${prefix}${id}.png` : `story-${id}${scale === 1 ? '' : `@${scale}x`}.png`
    await page.screenshot({ path: join(OUT, name) })
    console.log(`  ok ${name}   (CTA ends at y=${Math.round(qa.cta.b)}, safe line 1670)`)
  }
}

await browser.close()
server.close()
if (failed) {
  console.log(`${failed} frame(s) failed QA and were not written. Fix them, or pass --force to inspect.`)
  process.exit(1)
}
console.log('Done.')
