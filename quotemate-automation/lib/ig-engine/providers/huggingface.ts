// ════════════════════════════════════════════════════════════════════
// IG Engine — Hugging Face image-EDIT provider. PRIMARY for the trade
// "after" renders (roofing re-roof + painting repaint) as of 2026-07-14.
//
// Wraps HF Inference Providers image-to-image (FLUX.1-Kontext-dev by default)
// for instruction-based editing. Selected by lib/ig-engine/providers/edit-select.ts,
// which prefers this provider whenever HUGGING_FACE_API_TOKEN is set (Replicate,
// then Gemini, remain the fallbacks).
//
// ⚠ NOT GEMINI: Google's image models are NOT on Hugging Face — this is an OPEN
// model (FLUX Kontext / Qwen-Image-Edit), so the render's look differs.
//
// WHY THE CLIENT: HF's raw REST is chat-only; for image tasks each partner
// (fal-ai / replicate / wavespeed / …) has its OWN request+response format, and the
// editing models are NOT on the free `hf-inference` provider. The official
// @huggingface/inference client normalises all of that AND does provider:'auto'
// routing (picks a partner that actually serves the model) — which is why a raw
// fetch to hf-inference 400'd with "Model not supported by provider hf-inference".
// Default provider is 'auto'; force one with HF_IMAGE_PROVIDER=fal-ai|replicate|…
// and the model with HF_IMAGE_MODEL. Measured 2026-07-14 on a 640×480 satellite
// tile: fal-ai ~7s, replicate ~6s, wavespeed ~18s, auto ~13s.
//
// TIMEOUT: the call is aborted after HF_IMAGE_TIMEOUT_MS (default 90s). A partner
// request was observed to hang and never settle, which would otherwise burn the
// route's whole maxDuration budget. Callers wrap this best-effort; on failure (or
// timeout) roof-after/paint-after record 'failed' and the page shows the plain
// satellite / Street View photo.
// ════════════════════════════════════════════════════════════════════

import type {
  ImageBytes,
  ImageProvider,
  ProviderCapabilities,
  RenderImageRequest,
} from './base'

const DEFAULT_MODEL = 'black-forest-labs/FLUX.1-Kontext-dev'
const DEFAULT_TIMEOUT_MS = 90_000

// textToImage: false — renderImage below REQUIRES a source image (the HF task is
// image-to-image). Claiming otherwise would invite a caller to route a prompt-only
// render here and get a throw.
const CAPABILITIES: ProviderCapabilities = { edit: true, textToImage: false, vision: false }

function requireToken(): string {
  const t = (process.env.HUGGING_FACE_API_TOKEN ?? process.env.HF_TOKEN ?? '').trim()
  if (!t) throw new Error('HUGGING_FACE_API_TOKEN not set')
  return t
}

/** PURE — HF model slug. A per-call override is honoured only when it looks like
 *  an owner/name slug (the app's req.model may carry a Gemini id, which must not
 *  leak into an HF call). Else HF_IMAGE_MODEL env, else FLUX.1-Kontext-dev. */
export function hfImageModel(reqModel?: string): string {
  if (reqModel && reqModel.includes('/')) return reqModel
  return (process.env.HF_IMAGE_MODEL ?? '').trim() || DEFAULT_MODEL
}

/** PURE — which partner to route through, or undefined for 'auto' (let HF pick a
 *  partner that serves the model — the fix for "not supported by hf-inference"). */
export function hfImageProvider(): string | undefined {
  const p = (process.env.HF_IMAGE_PROVIDER ?? '').trim().toLowerCase()
  return p && p !== 'auto' ? p : undefined
}

/** PURE — abort budget for one render. Env override for slow partners. */
export function hfTimeoutMs(): number {
  const n = Number((process.env.HF_IMAGE_TIMEOUT_MS ?? '').trim())
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS
}

/** PURE — fold system + user (+ extraStrict) into the single instruction the
 *  edit model consumes (HF image-to-image has one flat prompt field). */
export function buildHfImagePrompt(req: RenderImageRequest): string {
  const user = req.extraStrict ? `${req.user}\n\n${req.extraStrict}` : req.user
  return [req.system, user].filter((s) => s && s.trim() !== '').join('\n\n')
}

/** PURE — mime from image magic bytes; defaults to image/png. */
export function detectMime(buf: Uint8Array): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp'
  return 'image/png'
}

type HfClient = {
  imageToImage: (
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => Promise<Blob>
}

/** LAZY load of @huggingface/inference — deferred so the SDK isn't parsed on the
 *  cold start of every route that pulls in the provider registry.
 *
 *  ⚠ The specifier MUST stay a LITERAL. It used to be a variable (to keep the dep
 *  "optional"), but the package is a declared dependency, and a non-literal
 *  specifier is invisible to Next's build tracing — so @huggingface/inference was
 *  never copied into the Vercel function bundle and every roof-after/paint-after
 *  render failed in production with "is not installed" while working locally. */
async function loadInferenceClient(token: string): Promise<HfClient> {
  const mod = (await import('@huggingface/inference')) as unknown as {
    InferenceClient: new (token: string) => HfClient
  }
  return new mod.InferenceClient(token)
}

async function renderImage(req: RenderImageRequest): Promise<ImageBytes> {
  const token = requireToken()
  if (!req.sourceImage) {
    throw new Error('HF image provider: sourceImage required (image-to-image edit)')
  }
  const client = await loadInferenceClient(token)

  const inputs = new Blob([Buffer.from(req.sourceImage.base64, 'base64')], {
    type: req.sourceImage.mime,
  })
  const provider = hfImageProvider()

  const out: Blob = await client.imageToImage(
    {
      model: hfImageModel(req.model),
      inputs,
      parameters: { prompt: buildHfImagePrompt(req) },
      // Omit for provider:'auto' (the client default → picks a partner that serves the model).
      ...(provider ? { provider } : {}),
    },
    // A hung partner request would otherwise never settle — abort it so the
    // caller records 'failed' fast and falls back to the un-edited photo.
    { signal: AbortSignal.timeout(hfTimeoutMs()) },
  )

  const buf = new Uint8Array(await out.arrayBuffer())
  return { base64: Buffer.from(buf).toString('base64'), mime: out.type || detectMime(buf) }
}

export const huggingfaceProvider: ImageProvider = {
  name: 'huggingface',
  capabilities: CAPABILITIES,
  renderImage,
}
