// QuoteMax · generate LOGO CONCEPTS with Gemini (Nano Banana Pro).
// Usage: node --env-file=.env.local scripts/gen-quotemax-logos.mjs
//
// Real image generation — costs a few Gemini image calls. Saves PNGs to
// public/brand/concepts/ so you can eyeball and pick. Mirrors the request
// shape used in lib/ig-engine/providers/gemini.ts. Never prints the key.

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const key = process.env.GEMINI_API_KEY
const model = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3-pro-image-preview'
if (!key) {
  console.error('GEMINI_API_KEY not set — run with: node --env-file=.env.local scripts/gen-quotemax-logos.mjs')
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'public', 'brand', 'concepts')
mkdirSync(outDir, { recursive: true })

const BRAND =
  'Brand: "QuoteMax" — an AI quoting receptionist for Australian tradies (electricians, plumbers). ' +
  'Palette STRICTLY: deep navy #0E1622, vibrant orange #FF5A1F accent, off-white #F4F1EB. ' +
  'Aesthetic: bold, geometric, modern, confident "command-center" energy, square corners, FLAT vector ' +
  '(no gradients, no 3D, no photorealism, no drop shadows). Australian, trustworthy, premium.'

const concepts = [
  { name: '01-app-icon-orange-Q', aspect: '1:1',
    prompt: 'A single app-icon logo mark: a solid orange #FF5A1F square tile with a bold geometric WHITE letter "Q" (a clean ring with a short square-cut diagonal tail). Centered, generous margin, reads clearly even at 16px. Flat vector. No text/wordmark.' },
  { name: '02-app-icon-navy-Q', aspect: '1:1',
    prompt: 'An app-icon tile: deep navy #0E1622 square, a centered BOLD orange #FF5A1F geometric "Q" mark (ring + square tail). Minimal, modern, crisp at small sizes. Flat vector. No wordmark.' },
  { name: '03-wordmark', aspect: '16:9',
    prompt: 'A horizontal logo WORDMARK reading exactly "QUOTEMAX" (Q U O T E M A X) in heavy uppercase geometric sans-serif, tight letter-spacing, on deep navy #0E1622. "QUOTE" in off-white #F4F1EB, "MAX" in orange #FF5A1F. Crisp, balanced, premium.' },
  { name: '04-lockup', aspect: '16:9',
    prompt: 'A horizontal brand lockup on deep navy #0E1622: on the left a square orange #FF5A1F tile with a white geometric "Q"; to its right the wordmark "QUOTEMAX" (Q U O T E M A X) in heavy uppercase off-white sans-serif with "MAX" in orange. Aligned, generous spacing, flat vector.' },
  { name: '05-mark-max-peak', aspect: '1:1',
    prompt: 'An abstract logo mark fusing the letter "Q" with an upward-right arrow / rising peak to signal "MAX" (maximum, growth). Orange #FF5A1F + white on deep navy #0E1622. Bold, minimal, geometric, flat, iconic. No text.' },
  { name: '06-badge', aspect: '1:1',
    prompt: 'A circular brand badge: an orange #FF5A1F ring on deep navy #0E1622, a bold white "Q" centered, with "QUOTEMAX" and "AI QUOTES FOR TRADIES" in small uppercase off-white letters curved around the ring. Flat vector, crisp. Spelling exactly Q U O T E M A X.' },
]

async function gen(c) {
  const body = {
    systemInstruction: { parts: [{ text: 'You are a senior brand/logo designer. Output ONE clean, production-quality LOGO image. Flat vector aesthetic, exact palette, correct spelling, generous margins. No mockups, no UI chrome, no watermark, no signature.' }] },
    contents: [{ role: 'user', parts: [{ text: `${BRAND}\n\nDesign task: ${c.prompt}` }] }],
    generation_config: {
      temperature: 1,
      response_modalities: ['IMAGE'],
      thinking_config: { thinking_level: 'high' },
      image_config: { aspect_ratio: c.aspect },
    },
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) {
    console.error(`✗ ${c.name}: HTTP ${res.status} ${(await res.text()).slice(0, 180)}`)
    return false
  }
  const data = await res.json()
  const parts = data?.candidates?.[0]?.content?.parts ?? []
  const inline = parts.find((p) => p.inline_data?.data || p.inlineData?.data)
  const img = inline?.inline_data ?? inline?.inlineData
  if (!img?.data) {
    const refusal = parts.find((p) => p.text)?.text
    console.error(`✗ ${c.name}: no image data${refusal ? ` — ${refusal.slice(0, 140)}` : ''}`)
    return false
  }
  const ext = (img.mime_type ?? img.mimeType ?? 'image/png').includes('jpeg') ? 'jpg' : 'png'
  const p = join(outDir, `${c.name}.${ext}`)
  writeFileSync(p, Buffer.from(img.data, 'base64'))
  console.log(`✓ ${c.name} → ${p}`)
  return true
}

let ok = 0
for (const c of concepts) {
  try { if (await gen(c)) ok++ } catch (e) { console.error(`✗ ${c.name}:`, e?.message ?? e) }
}
console.log(`\nDone: ${ok}/${concepts.length} concepts saved to ${outDir}`)
