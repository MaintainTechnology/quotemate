// QuoteMate · smoke test detecting EXISTING solar panels on a roof from the
// Google satellite aerial via Gemini vision.
// Usage: node --env-file=.env.local scripts/smoke-roof-solar-detect.mjs
//
// Confirms we can detect existing rooftop PV from the same satellite image
// the roofing tool already fetches. Saves the aerial so you can eyeball it.

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const mapsKey = process.env.GOOGLE_MAPS_API_KEY
const gemKey = process.env.GEMINI_API_KEY
const model = process.env.GEMINI_TEXT_MODEL ?? process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash'
if (!mapsKey || !gemKey) {
  console.error('Missing GOOGLE_MAPS_API_KEY or GEMINI_API_KEY')
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'tmp', 'roof-solar')
mkdirSync(outDir, { recursive: true })

const ADDRESS = '28 Greens Rd, Coorparoo, 4151, QLD, Australia'
const redact = (s) => String(s).replaceAll(mapsKey, '<maps>').replaceAll(gemKey, '<gem>')

try {
  // 1. Geocode → centre the aerial on the building
  const geo = await (await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(ADDRESS)}&region=au&key=${mapsKey}`,
  )).json()
  if (geo.status !== 'OK') { console.error('Geocode:', geo.status); process.exit(2) }
  const { lat, lng } = geo.results[0].geometry.location
  console.log(`Centre: ${lat}, ${lng}`)

  // 2. Satellite aerial (same source the roofing tool uses)
  const satUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=20&size=640x640&scale=2&maptype=satellite&key=${mapsKey}`
  const satRes = await fetch(satUrl)
  console.log(`Satellite HTTP: ${satRes.status}`)
  if (!satRes.ok) { console.error('satellite fetch failed'); process.exit(3) }
  const satMime = satRes.headers.get('content-type') ?? 'image/png'
  const satBytes = Buffer.from(await satRes.arrayBuffer())
  const aerialPath = join(outDir, 'aerial.png')
  writeFileSync(aerialPath, satBytes)
  console.log(`  aerial saved: ${aerialPath} (${satBytes.length} bytes)`)

  // 3. Gemini vision — detect existing PV on the CENTRE building, JSON out
  const prompt =
    'You are analysing a top-down satellite aerial of an Australian residential property. ' +
    'The building of interest is the one at the CENTRE of the image. Determine whether that ' +
    "central building's roof has EXISTING solar photovoltaic (PV) panels. Solar panels appear " +
    'as dark blue or black rectangular grid arrays sitting flat on the roof. Ignore skylights, ' +
    'windows, vents and the neighbouring houses. ' +
    'Respond ONLY with strict JSON, no prose: ' +
    '{"has_solar": boolean, "array_count": number, "panel_count_estimate": number|null, ' +
    '"approx_area_m2": number|null, "confidence": "high"|"medium"|"low", "notes": string}'

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: satMime, data: satBytes.toString('base64') } }] }],
    generation_config: { temperature: 0, response_modalities: ['TEXT'] },
  }
  const gRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gemKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  )
  console.log(`Gemini (${model}) HTTP: ${gRes.status}`)
  if (!gRes.ok) { console.error('Gemini error:', redact((await gRes.text()).slice(0, 400))); process.exit(4) }
  const data = await gRes.json()
  const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text).filter(Boolean).join('').trim()
  const clean = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
  console.log('\nGemini solar-detection result:')
  try {
    console.log(JSON.stringify(JSON.parse(clean), null, 2))
  } catch {
    console.log(clean)
  }
  console.log(`\n  (open ${aerialPath} to compare)`)
} catch (e) {
  console.error('SMOKE FAILED:', redact(e?.message ?? e))
  process.exitCode = 1
}
