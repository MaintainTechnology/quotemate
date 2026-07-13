// ════════════════════════════════════════════════════════════════════
// IG Engine — Replicate provider adapter (Google Nano Banana Pro).
//
// Wraps Replicate's `google/nano-banana-pro` model (= gemini-3-pro-image-
// preview) for image edits + text-to-image. Activated by setting
// IG_IMAGE_PROVIDER=replicate (see providers/select.ts); needs
// REPLICATE_API_TOKEN.
//
// ⚠ CAPABILITY GAP vs the direct Gemini provider — Replicate's wrapper
// exposes ONLY: prompt, resolution, image_input, aspect_ratio,
// output_format, safety_filter_level, allow_fallback_model. It does NOT
// expose systemInstruction, thinking_level, temperature or top_p. So:
//   · req.system is FOLDED into the flat `prompt` (no dedicated field),
//   · thinking_level:high + temperature/top_p:0 are LOST — the adherence
//     levers the direct provider relies on aren't available here.
// The identical model IS reachable with all those controls via the Gemini
// provider (GEMINI_IMAGE_MODEL=gemini-3-pro-image-preview) — prefer that
// unless Replicate access is specifically required.
//
// Wire format (Replicate official-model prediction API):
//   POST https://api.replicate.com/v1/models/google/nano-banana-pro/predictions
//   headers: Authorization: Bearer <token>, Prefer: wait
//   body:    { input: { prompt, image_input[], resolution, aspect_ratio,
//                        output_format, safety_filter_level,
//                        allow_fallback_model:false } }
//   → prediction { status, output: <uri>, urls.get }
// The output URI is fetched to bytes. `allow_fallback_model` is pinned
// false so load never silently swaps in a different model.
//
// The adapter throws on failure; callers wrap in their own best-effort
// logic (the preview/samples generators treat a render error as a
// non-blocking failure on that quote).
// ════════════════════════════════════════════════════════════════════

import type {
  ImageBytes,
  ImageProvider,
  ProviderCapabilities,
  RenderImageRequest,
} from './base'

const DEFAULT_MODEL = 'google/nano-banana-pro'
// 1K | 2K | 4K. Default 2K (Replicate's own default) — Nano Banana Pro is
// the quality play; drop to 1K to cut cost. env-overridable, no deploy.
const RESOLUTION = (process.env.REPLICATE_IMAGE_RESOLUTION ?? '2K').trim()

const CAPABILITIES: ProviderCapabilities = {
  edit: true,
  textToImage: true,
  // Output is an image URI only — no text/vision path (judge stays on Gemini).
  vision: false,
}

const PREDICTIONS_ENDPOINT = (model: string): string =>
  `https://api.replicate.com/v1/models/${model}/predictions`

function requireToken(): string {
  const t = (process.env.REPLICATE_API_TOKEN ?? '').trim()
  if (!t) throw new Error('REPLICATE_API_TOKEN not set')
  return t
}

/** Pick the Replicate model slug. Honour a per-call override ONLY when it
 *  looks like an owner/name slug (the app's req.model carries Gemini ids,
 *  which must not leak into a Replicate call). PURE. */
export function replicateModel(reqModel?: string): string {
  const envModel = (process.env.REPLICATE_IMAGE_MODEL ?? '').trim()
  if (reqModel && reqModel.includes('/')) return reqModel
  return envModel || DEFAULT_MODEL
}

/** Fold system + user (+ extraStrict) into the single flat prompt Replicate
 *  consumes, and — since image_input is an unlabelled array — name what each
 *  attached image is so the model knows which to edit vs replicate. PURE. */
export function buildReplicatePrompt(req: RenderImageRequest): string {
  const user = req.extraStrict ? `${req.user}\n\n${req.extraStrict}` : req.user
  const parts = [req.system, user].filter((s) => s && s.trim() !== '')
  const legend: string[] = []
  if (req.sourceImage) {
    legend.push(
      'Attached image 1 is the customer\'s own photo — EDIT it in place, ' +
        'preserving the room, layout, angle and lighting exactly.',
    )
  }
  if (req.reference) {
    const n = req.sourceImage ? 2 : 1
    legend.push(`Attached image ${n}: ${req.reference.label} — replicate it exactly; do not substitute.`)
  }
  if (legend.length) parts.push(legend.join('\n'))
  return parts.join('\n\n')
}

/** Ordered data-URI list for image_input: source photo first, then the
 *  labelled reference. Empty for text-to-image. PURE. */
export function buildImageInput(req: RenderImageRequest): string[] {
  const toDataUri = (img: ImageBytes): string => `data:${img.mime};base64,${img.base64}`
  const out: string[] = []
  if (req.sourceImage) out.push(toDataUri(req.sourceImage))
  if (req.reference) out.push(toDataUri(req.reference.image))
  return out
}

/** Resolve the aspect_ratio field. With any input image, 'match_input_image'
 *  (the anti-crop default) — never forward the app's derived ratios, whose
 *  enum may not match Replicate's. Text-to-image → a safe square default.
 *  PURE. */
export function resolveAspectRatio(req: RenderImageRequest): string {
  return req.sourceImage || req.reference ? 'match_input_image' : '1:1'
}

/** Pull the single output URI from a Replicate prediction (output is a URI
 *  string, or occasionally an array). PURE. */
export function extractOutputUrl(output: unknown): string {
  const url = Array.isArray(output) ? output[0] : output
  if (typeof url !== 'string' || !url) {
    throw new Error('Replicate returned no output image URL')
  }
  return url
}

/** Mime from an image buffer's magic bytes; defaults to image/png. PURE. */
export function detectMime(buf: Uint8Array): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp'
  return 'image/png'
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

type Prediction = {
  status?: string
  output?: unknown
  error?: unknown
  urls?: { get?: string }
}

// ── renderImage ─────────────────────────────────────────────────────
async function renderImage(req: RenderImageRequest): Promise<ImageBytes> {
  const token = requireToken()
  const model = replicateModel(req.model)

  const input: Record<string, unknown> = {
    prompt: buildReplicatePrompt(req),
    resolution: RESOLUTION,
    aspect_ratio: resolveAspectRatio(req),
    output_format: 'png',
    safety_filter_level: 'block_only_high',
    // Never silently fall back to a different model (e.g. seedream) on load.
    allow_fallback_model: false,
  }
  const images = buildImageInput(req)
  if (images.length) input.image_input = images

  const res = await fetch(PREDICTIONS_ENDPOINT(model), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Block until the prediction resolves (up to ~60s) — no manual polling
      // for the common fast case; the loop below covers the slow tail.
      Prefer: 'wait',
    },
    body: JSON.stringify({ input }),
  })
  if (!res.ok) {
    throw new Error(`Replicate HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`)
  }

  let pred = (await res.json()) as Prediction
  // Poll the tail if `Prefer: wait` returned before completion.
  let guard = 0
  while (pred.status && !['succeeded', 'failed', 'canceled'].includes(pred.status) && guard++ < 40) {
    if (!pred.urls?.get) break
    await sleep(1500)
    const p = await fetch(pred.urls.get, { headers: { Authorization: `Bearer ${token}` } })
    pred = (await p.json()) as Prediction
  }
  if (pred.status !== 'succeeded') {
    const reason = pred.error ? String(pred.error).slice(0, 200) : (pred.status ?? 'unknown')
    throw new Error(`Replicate prediction ${pred.status ?? 'error'} — ${reason}`)
  }

  const url = extractOutputUrl(pred.output)
  const imgRes = await fetch(url)
  if (!imgRes.ok) throw new Error(`Replicate output fetch HTTP ${imgRes.status}`)
  const buf = new Uint8Array(await imgRes.arrayBuffer())
  return { base64: Buffer.from(buf).toString('base64'), mime: detectMime(buf) }
}

export const replicateProvider: ImageProvider = {
  name: 'replicate',
  capabilities: CAPABILITIES,
  renderImage,
  // No generateText — Nano Banana Pro on Replicate is image-out only. The
  // judge/verify QA paths stay on their own (Gemini/Claude) providers.
}
