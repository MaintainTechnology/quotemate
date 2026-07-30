// Render payment-terms.html to one PNG per graphic.
//
// These post as single images, not as a document carousel, so there is no PDF
// step here. Pass --pdf if you ever want one for a swipe version.
//
// Run:  node render.mjs                  # 6 graphics at 1080x1350, 2x
//       node render.mjs --scale 1 --sheet # 1x plus a contact sheet, to review crops
//       node render.mjs --only 1,2        # re-shoot just the two post images

import { chromium } from 'playwright'
import http from 'node:http'
import { readFile, mkdir, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'out')
const SRC = 'payment-terms.html'
const argv = process.argv.slice(2)
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const scale = Number(flag('scale', '2'))
const [W, H] = flag('size', '1080x1350').split('x').map(Number)
const only = flag('only', '') ? flag('only', '').split(',').map((s) => Number(s.trim())) : null
const wantSheet = argv.includes('--sheet')
const wantPdf = argv.includes('--pdf')

const src = readFileSync(join(here, SRC), 'utf8')
// Counted from the source so adding a graphic to the D array is the only edit.
const refs = [...src.matchAll(/^\{n:(\d+),tag:/gm)].map((m) => m[1])
if (!refs.length) throw new Error(`no graphics found in ${SRC}`)
const total = refs.length

const MIME = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' }
const server = http.createServer(async (req, res) => {
  const raw = decodeURIComponent(req.url.split('?')[0])
  const want = raw === '/' ? SRC : raw.replace(/^\/+/, '')
  try {
    // The request NEVER becomes a path. Two earlier attempts validated it and
    // CodeQL still (correctly) objected: the untrusted value flowed into
    // readFile, and safety rested on a check rather than on construction. So
    // enumerate what actually exists and use the request only to SELECT from
    // that list — the path handed to readFile is built from filesystem data.
    //
    // Before this, `join(here, req.url)` resolved `..`, so
    // GET /../../../.env.local — or its %2e%2e%2f / %5c forms — read and served
    // every live secret in the repo. Dev-only server on a random localhost
    // port, but alive whenever graphics render. (CodeQL js/path-injection, high.)
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
console.log(`Rendering ${nums.length} of ${total} graphic(s) at ${W}x${H} @${scale}x -> out/`)
for (const n of nums) {
  await page.goto(`http://localhost:${port}/${SRC}?d=${n - 1}`, { waitUntil: 'networkidle' })
  // Fonts AND images both have to settle. Manrope arriving late reflows every
  // headline after the shot, and a 3.5MB photo is not decoded on networkidle.
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map((im) => (im.complete ? 1 : new Promise((r) => { im.onload = im.onerror = r }))))
  })
  const name = `post-${refs[n - 1]}.png`
  const buf = await page.screenshot({ path: join(OUT, name) })
  shots.push(buf)
  console.log(`  ok ${name}`)
}

// --pdf works with --only on purpose: the two post images are wanted as a
// two-page document, which is the one way LinkedIn shows a 4:5 graphic
// uncropped when a post carries more than one image.
if (wantPdf) {
  const imgs = shots.map((b) => `<img src="data:image/png;base64,${b.toString('base64')}" style="display:block;width:${W}px;height:${H}px">`).join('')
  await page.setContent(`<!doctype html><html><head><style>@page{size:${W}px ${H}px;margin:0}*{margin:0;padding:0}</style></head><body>${imgs}</body></html>`, { waitUntil: 'networkidle' })
  await page.pdf({ path: join(OUT, 'quotemax-payment-terms.pdf'), width: `${W}px`, height: `${H}px`, printBackground: true })
  console.log('  ok quotemax-payment-terms.pdf')
}

if (wantSheet) {
  const sheet = `<!doctype html><body style="margin:0;background:#0a0908;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:10px;font:700 30px 'JetBrains Mono',monospace;color:#FFC400">
    ${refs.map((r) => `<div style="position:relative"><img src="out/post-${r}.png" style="width:100%;display:block"><span style="position:absolute;left:0;top:0;background:#000d;padding:4px 12px">${r}</span></div>`).join('')}
  </body>`
  await page.setViewportSize({ width: 2200, height: 1000 })
  await page.setContent(sheet, { waitUntil: 'networkidle' })
  await page.evaluate((base) => { for (const im of document.images) im.src = base + '/' + im.getAttribute('src') }, `http://localhost:${port}`)
  await page.evaluate(async () => {
    await Promise.all([...document.images].map((im) => (im.complete ? 1 : new Promise((r) => { im.onload = im.onerror = r }))))
  })
  await page.screenshot({ path: join(OUT, '_sheet.jpg'), type: 'jpeg', quality: 88, fullPage: true })
  console.log('  ok _sheet.jpg')
}

await browser.close()
server.close()
console.log('Done.')
