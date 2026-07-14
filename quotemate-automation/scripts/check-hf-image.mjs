// Smoke-check the Hugging Face image-EDIT path end to end — the provider
// roofing + painting now prefer for their "after" renders.
//
//   node --env-file=.env.local scripts/check-hf-image.mjs
//
// Fetches a real Google satellite tile (the same source roof-after.ts uses),
// runs it through HF image-to-image with a re-roof instruction, and reports
// the model, the routed partner, latency and output size. Any failure here is
// exactly what makes the live page fall back to the plain satellite/Street View.
import { InferenceClient } from '@huggingface/inference'

const token = (process.env.HUGGING_FACE_API_TOKEN ?? process.env.HF_TOKEN ?? '').trim()
if (!token) {
  console.error('HUGGING_FACE_API_TOKEN not set — HF image gen is unavailable.')
  process.exit(1)
}

const mapsKey = process.env.GOOGLE_MAPS_API_KEY
if (!mapsKey) {
  console.error('GOOGLE_MAPS_API_KEY not set — cannot fetch a source image.')
  process.exit(1)
}

const url =
  'https://maps.googleapis.com/maps/api/staticmap?center=-33.8688,151.2093&zoom=20' +
  `&size=640x480&maptype=satellite&key=${mapsKey}`
const res = await fetch(url)
console.log(`satellite source: HTTP ${res.status} ${res.headers.get('content-type')}`)
if (!res.ok) process.exit(1)
const src = Buffer.from(await res.arrayBuffer())

const model = (process.env.HF_IMAGE_MODEL ?? '').trim() || 'black-forest-labs/FLUX.1-Kontext-dev'
const forced = (process.env.HF_IMAGE_PROVIDER ?? '').trim().toLowerCase()
console.log(`model: ${model} | partner: ${forced || 'auto'}`)

const t0 = Date.now()
try {
  const out = await new InferenceClient(token).imageToImage({
    model,
    inputs: new Blob([src], { type: 'image/png' }),
    parameters: {
      prompt:
        'Replace the roof of the main building with a brand new Colorbond metal roof. ' +
        'Keep the building footprint, layout and surroundings identical.',
    },
    ...(forced && forced !== 'auto' ? { provider: forced } : {}),
  })
  const buf = Buffer.from(await out.arrayBuffer())
  console.log(`OK — ${Date.now() - t0}ms, ${out.type || 'image/?'}, ${buf.length} bytes`)
} catch (e) {
  console.log(`FAILED — ${Date.now() - t0}ms`)
  console.log(`  ${e?.name}: ${e?.message}`)
  process.exit(1)
}
