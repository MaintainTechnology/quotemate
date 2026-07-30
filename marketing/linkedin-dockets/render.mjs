// Render dockets.html to one PNG per slide, plus the swipeable carousel PDF that
// LinkedIn actually wants for a 20-slide document post.
//
// Run:  node render.mjs                    # 20 slides at 1080x1350, 2x, + PDF
//       node render.mjs --scale 1 --sheet   # 1x, review contact sheet, no PDF
//       node render.mjs --only 1,4,20       # re-shoot specific slides

import { chromium } from 'playwright'
import http from 'node:http'
import { readFile, mkdir, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'out')
const argv = process.argv.slice(2)
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const scale = Number(flag('scale', '2'))
const [W, H] = flag('size', '1080x1350').split('x').map(Number)
const only = flag('only', '') ? flag('only', '').split(',').map((s) => Number(s.trim())) : null
const wantSheet = argv.includes('--sheet')
const wantPdf = !argv.includes('--no-pdf') && !wantSheet

const src = readFileSync(join(here, 'dockets.html'), 'utf8')
// Counted from the source so adding a docket to the D array is the only edit.
const total = (src.match(/^\{n:\d+,tag:/gm) || []).length
if (!total) throw new Error('no dockets found in dockets.html')

const MIME = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' }
const server = http.createServer(async (req, res) => {
  const raw = decodeURIComponent(req.url.split('?')[0])
  const want = raw === '/' ? 'dockets.html' : raw.replace(/^\/+/, '')
  try {
    // The request NEVER becomes a path. join(here, req.url) resolved `..`, so
    // GET /../../../.env.local — or its %2e%2e%2f / %5c forms — read and served
    // every live secret in the repo. Validating the request instead was tried
    // first and CodeQL still (correctly) objected: the untrusted value kept
    // flowing into readFile. So enumerate what exists and use the request only
    // to SELECT from that list — the path readFile gets is built from
    // filesystem data, so there is no check to get wrong.
    //
    // Dev-only server on a random localhost port, but alive whenever graphics
    // render. (CodeQL js/path-injection, high.)
    const entries = await readdir(here, { recursive: true })
    const hit = entries.find((e) => e.split(/[\/]/).join('/') === want)
    if (!hit) {
      res.writeHead(404)
      res.end('not found')
      return
    }
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

const nums = only ?? Array.from({ length: total }, (_, i) => i + 1)
const shots = []
console.log(`Rendering ${nums.length} of ${total} slide(s) at ${W}x${H} @${scale}x -> out/`)
for (const n of nums) {
  await page.goto(`http://localhost:${port}/dockets.html?d=${n - 1}`, { waitUntil: 'networkidle' })
  // Fonts AND images both have to settle. Manrope arriving late reflows every
  // headline after the shot, and a 2.5MB plate is not decoded on networkidle.
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map((im) => (im.complete ? 1 : new Promise((r) => { im.onload = im.onerror = r }))))
  })
  const buf = await page.screenshot({ path: join(OUT, `docket-${String(n).padStart(2, '0')}.png`) })
  shots.push(buf)
  console.log(`  ok docket-${String(n).padStart(2, '0')}.png`)
}

if (wantPdf && !only) {
  const imgs = shots.map((b) => `<img src="data:image/png;base64,${b.toString('base64')}" style="display:block;width:${W}px;height:${H}px">`).join('')
  await page.setContent(`<!doctype html><html><head><style>@page{size:${W}px ${H}px;margin:0}*{margin:0;padding:0}</style></head><body>${imgs}</body></html>`, { waitUntil: 'networkidle' })
  await page.pdf({ path: join(OUT, 'quotemax-dockets.pdf'), width: `${W}px`, height: `${H}px`, printBackground: true })
  console.log('  ok quotemax-launch-carousel.pdf')
}

if (wantSheet) {
  const sheet = `<!doctype html><body style="margin:0;background:#0a0908;display:grid;grid-template-columns:repeat(6,1fr);gap:8px;padding:8px;font:700 22px 'JetBrains Mono',monospace;color:#FFC400">
    ${Array.from({ length: total }, (_, i) => `<div style="position:relative"><img src="out/docket-${String(i + 1).padStart(2, '0')}.png" style="width:100%;display:block"><span style="position:absolute;left:0;top:0;background:#000d;padding:3px 9px">${i + 1}</span></div>`).join('')}
  </body>`
  await page.setViewportSize({ width: 3000, height: 1000 })
  await page.setContent(sheet, { waitUntil: 'networkidle' })
  await page.evaluate((base) => { for (const im of document.images) im.src = base + '/' + im.getAttribute('src') }, `http://localhost:${port}`)
  await page.evaluate(async () => {
    await Promise.all([...document.images].map((im) => (im.complete ? 1 : new Promise((r) => { im.onload = im.onerror = r }))))
  })
  await page.screenshot({ path: join(OUT, '_sheet.jpg'), type: 'jpeg', quality: 86, fullPage: true })
  console.log('  ok _sheet.jpg')
}

await browser.close()
server.close()
console.log('Done.')
