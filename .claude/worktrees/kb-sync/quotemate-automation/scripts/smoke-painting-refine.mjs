// QuoteMate · smoke test the conversational refine loop (Jon's
// "paint the fence grey too"). Feeds the prior repaint back to Gemini with
// a follow-up instruction. Run smoke-painting-preview.mjs first.
// Usage: node --env-file=.env.local scripts/smoke-painting-refine.mjs

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const gemKey = process.env.GEMINI_API_KEY
const model = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3-pro-image-preview'
if (!gemKey) { console.error('Missing GEMINI_API_KEY'); process.exit(1) }

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, '..', 'tmp', 'painting-preview')
const srcPath = existsSync(join(dir, 'after.jpg')) ? join(dir, 'after.jpg') : join(dir, 'before.jpg')
if (!existsSync(srcPath)) { console.error('No source image — run smoke-painting-preview.mjs first.'); process.exit(2) }

const INSTRUCTION = 'paint the fence grey too'
const srcBytes = readFileSync(srcPath)
console.log(`Source: ${srcPath} (${srcBytes.length} bytes)`)
console.log(`Instruction: "${INSTRUCTION}"`)

const system =
  'You are an architectural visualiser editing a real photo of a house that has already been digitally repainted. ' +
  'You apply ONLY the single change the customer asks for. Everything else in the image stays pixel-faithful.'
const user =
  `Apply this single change to the image: "${INSTRUCTION}". STRICT RULES: change ONLY what is asked; keep the ` +
  'building shape, rooflines, windows, doors, garden, driveway, trees, vehicles, sky, neighbouring houses and the ' +
  'camera angle/zoom/framing unchanged; do NOT undo earlier repainting; do NOT add text or people. Photorealistic.'

const body = {
  systemInstruction: { parts: [{ text: system }] },
  contents: [{ role: 'user', parts: [{ text: user }, { inline_data: { mime_type: 'image/jpeg', data: srcBytes.toString('base64') } }] }],
  generation_config: { temperature: 0.1, response_modalities: ['IMAGE'], image_config: { aspect_ratio: '4:3' } },
}

try {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gemKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  console.log(`Gemini (${model}) HTTP: ${res.status}`)
  if (!res.ok) { console.error(String(await res.text()).replaceAll(gemKey, '<gem>').slice(0, 400)); process.exit(3) }
  const data = await res.json()
  const parts = data?.candidates?.[0]?.content?.parts ?? []
  const inline = parts.find((p) => p.inline_data?.data || p.inlineData?.data)
  const img = inline?.inline_data ?? inline?.inlineData
  if (!img?.data) { console.error('No image returned.', parts.find((p) => p.text)?.text?.slice(0, 200) ?? ''); process.exit(4) }
  const outPath = join(dir, 'refined.jpg')
  writeFileSync(outPath, Buffer.from(img.data, 'base64'))
  console.log(`Refined saved: ${outPath} (${Buffer.from(img.data, 'base64').length} bytes)`)
  console.log('\n✓ Conversational refine works. Open after.jpg vs refined.jpg to compare the fence.')
} catch (e) {
  console.error('SMOKE FAILED:', String(e?.message ?? e).replaceAll(gemKey, '<gem>'))
  process.exitCode = 1
}
