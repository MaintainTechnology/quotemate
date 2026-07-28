// Contact sheet for a folder of images, at the 4:5 crop the slides use, so
// plate choice and object-position are decided by looking rather than by
// filename. Run: node sheet.mjs gfx   |   node sheet.mjs img
import { chromium } from 'playwright'
import http from 'node:http'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const sub = process.argv[2] ?? 'gfx'
const files = (await readdir(join(dir, sub))).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort()
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' }

const html = `<!doctype html><body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(5,1fr);gap:5px;font:12px monospace;color:#fff">
${files.map((f) => `<div style="position:relative"><img src="${sub}/${f}" style="width:100%;aspect-ratio:4/5;object-fit:cover;display:block"><span style="position:absolute;left:0;bottom:0;background:#000c;padding:2px 5px">${f.replace(/\.\w+$/, '')}</span></div>`).join('')}
</body>`

const srv = http.createServer(async (req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0])
  if (p === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html) }
  try {
    const b = await readFile(join(dir, p))
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(b)
  } catch { res.writeHead(404); res.end() }
})
const port = await new Promise((r) => srv.listen(0, () => r(srv.address().port)))
await mkdir(join(dir, 'out'), { recursive: true })
const br = await chromium.launch()
const pg = await br.newPage({ viewport: { width: 1500, height: 900 } })
await pg.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' })
await pg.screenshot({ path: join(dir, 'out', `_${sub}-sheet.jpg`), type: 'jpeg', quality: 82, fullPage: true })
await br.close(); srv.close()
console.log(`ok ${files.length} -> out/_${sub}-sheet.jpg`)
