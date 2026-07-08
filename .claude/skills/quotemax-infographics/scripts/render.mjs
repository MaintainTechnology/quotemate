// QuoteMax infographics — render a generator HTML to PNGs (+ a carousel PDF).
//
// Requires Playwright:  npm i playwright  &&  npx playwright install chromium
//
// Usage:
//   node scripts/render.mjs                         # bundled generator, 1080x1350 -> ./out
//   node scripts/render.mjs --gen ./my-post.html    # your edited copy (keep an img/ dir beside it)
//   node scripts/render.mjs --format ig-square --scale 1 --no-pdf --out ./posts
//
// It serves the generator's own folder, opens generator.html?slide=N at the
// format viewport, and screenshots each slide. deviceScaleFactor defaults to 2.

import { chromium } from 'playwright'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { readFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname, basename, isAbsolute } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const FORMATS = {
  'li-carousel': [1080, 1350],
  'li-single': [1200, 627],
  'ig-square': [1080, 1080],
  'ig-story': [1080, 1920],
  'flyer-a4': [1240, 1754],
  'deck-16x9': [1920, 1080],
}

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def
}

const genArg = arg('gen', '')
const genPath = genArg ? (isAbsolute(genArg) ? genArg : join(process.cwd(), genArg)) : join(here, '..', 'assets', 'generator.html')
const serveDir = dirname(genPath)
const genName = basename(genPath)
const format = arg('format', 'li-carousel')
const scale = Number(arg('scale', '2'))
const outDir = join(process.cwd(), arg('out', 'out'))
const makePdf = !process.argv.includes('--no-pdf')
const [W, H] = FORMATS[format] ?? FORMATS['li-carousel']
mkdirSync(outDir, { recursive: true })

// Count slides straight from the generator's SLIDES array (each entry: `{ kind: '...`).
const count = (readFileSync(genPath, 'utf8').match(/\{\s*kind:\s*'/g) || []).length || 1

const MIME = { '.html': 'text/html', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' }
const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0])
    if (p === '/') p = '/' + genName
    const buf = await readFile(join(serveDir, p))
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' })
    res.end(buf)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
const port = await new Promise((r) => server.listen(0, () => r(server.address().port)))
const base = `http://localhost:${port}/${genName}`

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: scale })
const page = await ctx.newPage()
const pngs = []
console.log(`Rendering ${count} slide(s) at ${W}x${H} (x${scale}) from ${genName} -> ${outDir}`)
for (let i = 0; i < count; i++) {
  await page.goto(`${base}?slide=${i}`, { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map((im) => (im.complete ? 1 : new Promise((r) => (im.onload = im.onerror = r)))))
  })
  const buf = await page.screenshot({ path: join(outDir, `slide-${i + 1}.png`) })
  pngs.push(buf)
  console.log(`  ✓ slide-${i + 1}.png`)
}

if (makePdf) {
  try {
    const imgs = pngs.map((b) => `<img src="data:image/png;base64,${b.toString('base64')}" style="display:block;width:${W}px;height:${H}px" />`).join('')
    const doc = `<!doctype html><html><head><style>@page{size:${W}px ${H}px;margin:0}*{margin:0;padding:0}</style></head><body>${imgs}</body></html>`
    await page.setContent(doc, { waitUntil: 'networkidle' })
    await page.pdf({ path: join(outDir, 'carousel.pdf'), width: `${W}px`, height: `${H}px`, printBackground: true })
    console.log('  ✓ carousel.pdf')
  } catch (e) {
    console.log('  (skipped PDF —', e.message, ')')
  }
}

await browser.close()
server.close()
console.log('Done.')
