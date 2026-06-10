// QuoteMate · smoke test exterior wall-material detection from the Street
// View frontage. Usage: node --env-file=.env.local scripts/smoke-painting-material.mjs

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const mapsKey = process.env.GOOGLE_MAPS_API_KEY
const gemKey = process.env.GEMINI_API_KEY
const model = process.env.GEMINI_VISION_MODEL ?? 'gemini-2.5-flash'
if (!mapsKey || !gemKey) { console.error('Missing keys'); process.exit(1) }

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, '..', 'tmp', 'painting-preview')
mkdirSync(dir, { recursive: true })

const LOCATION = '28 Greens Rd, Coorparoo, 4151, QLD, Australia'
let bytes, mime = 'image/jpeg'
const cached = join(dir, 'before.jpg')
if (existsSync(cached)) {
  bytes = readFileSync(cached)
  console.log(`Using cached frontage: ${cached} (${bytes.length} bytes)`)
} else {
  const url = `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${encodeURIComponent(LOCATION)}&fov=85&pitch=8&scale=2&source=outdoor&return_error_code=true&key=${mapsKey}`
  const res = await fetch(url)
  if (!res.ok) { console.error('Street View fetch failed', res.status); process.exit(2) }
  bytes = Buffer.from(await res.arrayBuffer())
  writeFileSync(cached, bytes)
  console.log(`Fetched frontage (${bytes.length} bytes)`)
}

const prompt =
  'You are analysing a street-level photo of the FRONT of an Australian house for an exterior painting quote. ' +
  'Identify the primary EXTERIOR WALL material of the main house (ignore the roof, fence, garden and neighbours). ' +
  'Choose ONE: render, weatherboard, brick_face, brick_painted, fibro, metal, or unknown. Also read storeys and ' +
  'coarse condition. Respond ONLY with strict JSON: {"material": string, "storeys": number|null, ' +
  '"condition_hint": "sound"|"weathered"|"peeling"|"bare"|"unknown", "confidence": "high"|"medium"|"low", "notes": string}'

const body = {
  contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: bytes.toString('base64') } }] }],
  generation_config: { temperature: 0, response_modalities: ['TEXT'] },
}
try {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gemKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  console.log(`Gemini (${model}) HTTP: ${res.status}`)
  if (!res.ok) { console.error(String(await res.text()).replaceAll(gemKey, '<gem>').slice(0, 300)); process.exit(3) }
  const data = await res.json()
  const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text).filter(Boolean).join('').trim()
  const clean = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
  console.log('\nWall-material detection:')
  try { console.log(JSON.stringify(JSON.parse(clean), null, 2)) } catch { console.log(clean) }
} catch (e) {
  console.error('SMOKE FAILED:', String(e?.message ?? e).replaceAll(gemKey, '<gem>'))
  process.exitCode = 1
}
