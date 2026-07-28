// Render docket.html to one PNG per post, plus a contact sheet for review.
//
// Serves this folder over HTTP (so the logo SVG, the photos and the Google
// Fonts request all resolve the way they will in a browser), opens
// docket.html?post=N at the exact output size, waits for fonts AND images to
// settle, then screenshots. Waiting on document.fonts alone is not enough:
// Manrope arriving late reflows every headline after the shot.
//
// Run:  node render.mjs                      # 15 posts at 1080x1350, 2x
//       node render.mjs --scale 1 --sheet     # 1x plus a review contact sheet
//       node render.mjs --only 3,7            # re-shoot specific posts
//       node render.mjs --size 1080x1080      # any other output size

import { chromium } from 'playwright'
import http from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'out')

const argv = process.argv.slice(2)
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def
}
const scale = Number(flag('scale', '2'))
const [W, H] = flag('size', '1080x1350').split('x').map(Number)
const only = flag('only', '')
  ? flag('only', '').split(',').map((s) => Number(s.trim()))
  : null
const wantSheet = argv.includes('--sheet')

// Count the posts straight out of the source so the two can never disagree.
const src = readFileSync(join(here, 'docket.html'), 'utf8')
const total = (src.match(/^\{ n:\d+, kind:/gm) || []).length
if (!total) throw new Error('could not find any posts in docket.html')

const MIME = {
  '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
}
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0])
  if (p === '/') p = '/docket.html'
  try {
    const buf = await readFile(join(here, p))
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' })
    res.end(buf)
  } catch {
    res.writeHead(404); res.end('not found')
  }
})
const port = await new Promise((r) => server.listen(0, () => r(server.address().port)))
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: scale })
const page = await ctx.newPage()

const nums = only ?? Array.from({ length: total }, (_, i) => i + 1)
console.log(`Rendering ${nums.length} of ${total} post(s) at ${W}x${H} @${scale}x -> out/`)
for (const n of nums) {
  await page.goto(`http://localhost:${port}/docket.html?post=${n - 1}`, { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map((im) =>
      im.complete ? 1 : new Promise((r) => { im.onload = im.onerror = r })))
  })
  await page.screenshot({ path: join(OUT, `post-${String(n).padStart(2, '0')}.png`) })
  console.log(`  ok post-${String(n).padStart(2, '0')}.png`)
}

if (wantSheet) {
  const cols = 5
  const sheet = `<!doctype html><body style="margin:0;background:#0a0908;display:grid;grid-template-columns:repeat(${cols},1fr);gap:8px;padding:8px;font:700 22px 'JetBrains Mono',monospace;color:#FFC400">
    ${Array.from({ length: total }, (_, i) => {
      const f = `out/post-${String(i + 1).padStart(2, '0')}.png`
      return `<div style="position:relative"><img src="${f}" style="width:100%;display:block"><span style="position:absolute;left:0;top:0;background:#000d;padding:3px 9px">${i + 1}</span></div>`
    }).join('')}
  </body>`
  await page.setViewportSize({ width: 2700, height: 1000 })
  await page.setContent(sheet, { waitUntil: 'networkidle' })
  // setContent leaves the page on about:blank, so relative img paths do not
  // resolve; point them at the local server instead.
  await page.evaluate((base) => {
    for (const im of document.images) im.src = base + '/' + im.getAttribute('src')
  }, `http://localhost:${port}`)
  await page.evaluate(async () => {
    await Promise.all([...document.images].map((im) =>
      im.complete ? 1 : new Promise((r) => { im.onload = im.onerror = r })))
  })
  await page.screenshot({ path: join(OUT, '_sheet.jpg'), type: 'jpeg', quality: 88, fullPage: true })
  console.log('  ok _sheet.jpg')
}

await browser.close()
server.close()
console.log('Done.')
