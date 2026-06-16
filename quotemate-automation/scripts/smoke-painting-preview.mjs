// QuoteMate · smoke test the painting AI repaint pipeline end-to-end.
// Usage: node --env-file=.env.local scripts/smoke-painting-preview.mjs
//
// Confirms (a) the Street View Static API is enabled + has imagery, and
// (b) Gemini image-to-image actually returns a repainted photo. Saves the
// before/after images so you can eyeball the result. Real Gemini call —
// costs one image generation. Never prints the keys.

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const mapsKey = process.env.GOOGLE_MAPS_API_KEY
const gemKey = process.env.GEMINI_API_KEY
const model = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3-pro-image-preview'
if (!mapsKey || !gemKey) {
  console.error('Missing GOOGLE_MAPS_API_KEY or GEMINI_API_KEY')
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'tmp', 'painting-preview')
mkdirSync(outDir, { recursive: true })

const LOCATION = '28 Greens Rd, Coorparoo, 4151, QLD, Australia'
const COLOUR = 'Monument charcoal'
const redact = (s) => String(s).replaceAll(mapsKey, '<maps>').replaceAll(gemKey, '<gem>')

try {
  // 1. Street View metadata
  const metaUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${encodeURIComponent(LOCATION)}&source=outdoor&key=${mapsKey}`
  const meta = await (await fetch(metaUrl)).json()
  console.log(`Street View metadata: ${meta.status}${meta.date ? ` (imagery ${meta.date})` : ''}`)
  if (meta.status !== 'OK') {
    console.error('→ No Street View imagery, or enable the "Street View Static API" on this key.')
    process.exit(2)
  }

  // 2. Street View image
  const svUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${encodeURIComponent(LOCATION)}&fov=85&pitch=8&scale=2&source=outdoor&return_error_code=true&key=${mapsKey}`
  const svRes = await fetch(svUrl)
  console.log(`Street View image HTTP: ${svRes.status}`)
  if (!svRes.ok) {
    console.error('→ Street View image fetch failed.')
    process.exit(3)
  }
  const svMime = svRes.headers.get('content-type') ?? 'image/jpeg'
  const svBytes = Buffer.from(await svRes.arrayBuffer())
  const beforePath = join(outDir, 'before.jpg')
  writeFileSync(beforePath, svBytes)
  console.log(`  before saved: ${beforePath} (${svBytes.length} bytes)`)

  // 3. Gemini repaint (image-to-image), mirroring lib/ig-engine/providers/gemini.ts
  const system =
    'You are an architectural visualiser editing a real street-level photo of a house. ' +
    'You make ONE kind of change only: repaint the exterior surfaces of the building in a new colour. ' +
    'Everything else stays pixel-faithful to the source photo.'
  const user =
    `Repaint the exterior walls/cladding of this house in ${COLOUR}, as a crisp, freshly applied two-coat finish. ` +
    'STRICT RULES: keep the exact same building shape, rooflines, windows, doors, garden, driveway, fences, ' +
    'trees, vehicles, sky, neighbouring houses and the camera angle/zoom/framing unchanged. Do NOT change the ' +
    'roof, do NOT add or remove anything, do NOT re-frame, do NOT add text or people. Photorealistic, consistent ' +
    'lighting. The result must read as the SAME house photographed after an exterior repaint.'

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }, { inline_data: { mime_type: svMime, data: svBytes.toString('base64') } }] }],
    // Mirror the production renderImage config (lib/ig-engine/providers/gemini.ts):
    // Gemini-3 default temperature 1.0 + thinkingLevel high for adherence.
    generation_config: { temperature: 1, response_modalities: ['IMAGE'], thinking_config: { thinking_level: 'high' }, image_config: { aspect_ratio: '4:3' } },
  }
  const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gemKey}`
  console.log(`Calling Gemini (${model})…`)
  const gRes = await fetch(gUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!gRes.ok) {
    console.error('Gemini error:', redact((await gRes.text()).slice(0, 400)))
    process.exit(4)
  }
  const data = await gRes.json()
  const parts = data?.candidates?.[0]?.content?.parts ?? []
  const inline = parts.find((p) => p.inline_data?.data || p.inlineData?.data)
  const img = inline?.inline_data ?? inline?.inlineData
  if (!img?.data) {
    const refusal = parts.find((p) => p.text)?.text
    console.error('Gemini returned no image data.', refusal ? `Message: ${refusal.slice(0, 200)}` : '')
    process.exit(5)
  }
  const afterBytes = Buffer.from(img.data, 'base64')
  const ext = (img.mime_type ?? img.mimeType ?? 'image/png').includes('jpeg') ? 'jpg' : 'png'
  const afterPath = join(outDir, `after.${ext}`)
  writeFileSync(afterPath, afterBytes)
  console.log(`  after saved:  ${afterPath} (${afterBytes.length} bytes)`)

  console.log('\n✓ Full pipeline works: Street View → Gemini repaint → image out.')
  console.log(`  Open the two files in ${outDir} to compare before/after.`)
} catch (e) {
  console.error('SMOKE FAILED:', redact(e?.message ?? e))
  process.exitCode = 1
}
