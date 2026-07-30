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

const html = `<!doctype html><body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(7,1fr);gap:5px;font:12px monospace;color:#fff">
${files.map((f) => `<div style="position:relative"><img src="${sub}/${f}" style="width:100%;aspect-ratio:52/120;object-fit:cover;display:block"><span style="position:absolute;left:0;bottom:0;background:#000c;padding:2px 5px">${f.replace(/\.\w+$/, '')}</span></div>`).join('')}
</body>`

const srv = http.createServer(async (req, res) => {
  const raw = decodeURIComponent(req.url.split('?')[0])
  if (raw === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html) }
  const want = raw.replace(/^\/+/, '')
  try {
    // The request NEVER becomes a path. join(dir, req.url) resolved `..`, so
    // GET /../../../.env.local read and served every live secret in the repo.
    // Enumerate what exists and use the request only to SELECT from that list,
    // so the path readFile gets is built from filesystem data and there is no
    // check to get wrong. Dev-only server on a random localhost port, but alive
    // whenever graphics render. (CodeQL js/path-injection, high.)
    const entries = await readdir(dir, { recursive: true })
    const hit = entries.find((e) => e.split(/[\/]/).join('/') === want)
    if (!hit) { res.writeHead(404); res.end('not found'); return }
    const b = await readFile(join(dir, hit))
    res.writeHead(200, { 'content-type': MIME[extname(hit)] || 'application/octet-stream' }); res.end(b)
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
