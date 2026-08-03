// The source is a two-panel composite: a tradie in a roof cavity above, a
// tablet showing a paid roof measurement below, separated by a white diagonal
// band. Used whole it can only ever be one picture. Split, it becomes two
// photographs that drop straight into the frames this project already uses:
// the problem above, the answer below.
//
// Run: node split.mjs
import { chromium } from 'playwright'
import http from 'node:http'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = 'img/roof-cavity-vs-tablet.jpg'

// Measured off the source, normalised. The white band runs roughly 0.455 to
// 0.522, so each crop stops clear of it rather than carrying a white edge.
//
// The lower panel is also cropped at x 0.78. Two reasons, both about not
// shipping something that cannot be stood behind:
//   1. A large "RELIA-ROOFING" wall logo sits at x 0.80 to 1.00. That is an
//      invented company. Beside QuoteMax claims it would read as a named
//      customer, which there is no basis to imply.
//   2. The right edge is where the branding is densest. Losing it costs the
//      composition nothing: the tablet and the operator both sit left of 0.78.
// The tablet's own interface text is AI-garbled ("Search fropdiecales", "40,25
// mm" for a roof area). It is never used above 622px wide, where it scales to
// about 43% and reads as interface rather than as words. "PAID BOOKING: $99"
// is set large enough to survive that, which is the one line worth keeping.
const CUTS = [
  { name: 'roof-cavity', top: 0.000, bottom: 0.448, left: 0, right: 1 },
  { name: 'paid-booking', top: 0.532, bottom: 1.000, left: 0, right: 0.78 },
]

const MIME = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg' }
const server = http.createServer(async (req, res) => {
  const raw = decodeURIComponent(req.url.split('?')[0])
  const want = raw === '/' ? '__index' : raw.replace(/^\/+/, '')
  if (want === '__index') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end('<!doctype html><title>split</title><body>')
  }
  try {
    // The request selects from a directory listing rather than becoming a path,
    // so the value handed to readFile is built from filesystem data.
    const entries = await readdir(here, { recursive: true })
    const hit = entries.find((e) => e.split(/[\\/]/).join('/') === want)
    if (!hit) { res.writeHead(404); res.end('not found'); return }
    res.writeHead(200, { 'content-type': MIME[extname(hit)] || 'application/octet-stream' })
    res.end(await readFile(join(here, hit)))
  } catch { res.writeHead(404); res.end('not found') }
})
const port = await new Promise((r) => server.listen(0, () => r(server.address().port)))

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' })

const out = await page.evaluate(async ({ port, SRC, CUTS }) => {
  const im = new Image()
  im.src = `http://localhost:${port}/${SRC}`
  await im.decode()
  const W = im.naturalWidth, H = im.naturalHeight
  const made = []
  for (const c of CUTS) {
    const x = Math.round((c.left ?? 0) * W)
    const y = Math.round(c.top * H)
    const w = Math.round(((c.right ?? 1) - (c.left ?? 0)) * W)
    const h = Math.round((c.bottom - c.top) * H)
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = h
    cv.getContext('2d').drawImage(im, x, y, w, h, 0, 0, w, h)
    made.push({ name: c.name, w, h, ar: +(w / h).toFixed(4), data: cv.toDataURL('image/jpeg', 0.94) })
  }
  return { source: `${W}x${H}`, made }
}, { port, SRC, CUTS })

for (const m of out.made) {
  await writeFile(join(here, 'img', `${m.name}.jpg`), Buffer.from(m.data.split(',')[1], 'base64'))
  console.log(`  ${m.name}.jpg  ${m.w}x${m.h}  AR ${m.ar}`)
}
console.log(`source ${out.source}`)
await browser.close()
server.close()
