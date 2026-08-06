// ════════════════════════════════════════════════════════════════════
// IG Engine — Gemini provider adapter.
//
// Wraps the v1beta generateContent REST API for the Nano Banana family
// (gemini-3.1-flash-lite-image by default). Two operations:
//   · renderImage  — image out, with optional source + reference images.
//   · generateText — text out (vision input optional), used by the judge.
//
// All the field-level conventions of the prior inline implementation
// are preserved: snake_case payload, image_config aspect-ratio
// passthrough, low temperature default, structured error messages on
// non-200. The adapter throws on failure; the caller wraps in its own
// best-effort logic (the verify loop, the runRemovalPass try/catch).
// ════════════════════════════════════════════════════════════════════

import type {
  ImageBytes,
  ImageProvider,
  ProviderCapabilities,
  RenderImageRequest,
  TextRequest,
} from './base'

// Model ids verified against ListModels + a real generateContent call on this
// project's key, 2026-08-06 — never assume one, this file has already lost
// 'gemini-3-pro-image-preview' to a shutdown (see lib/roofing/model3d.ts).
//
// IMAGE: the pro tier, and GA rather than preview. Verified with the exact
// body built below (temperature 0, top_p 0, thinking_level high, image_size
// 1K) returning a real image. Was 'gemini-3.1-flash-lite-image' — the
// cheapest tier there is, on quote previews the customer actually sees.
const DEFAULT_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3-pro-image'
// TEXT gets its OWN default. It used to fall back to DEFAULT_IMAGE_MODEL,
// which only looked harmless while both were the same cheap flash-lite id —
// with the image default raised to a pro IMAGE model, that fallback would
// have quietly billed text generation at pro-image rates against a model
// built to emit pictures. GEMINI_TEXT_MODEL is set in Preview/Production, so
// this is the dev-and-fallback path.
const DEFAULT_TEXT_MODEL =
  process.env.GEMINI_TEXT_MODEL ?? 'gemini-3.6-flash'

// ── Gemini image generation levers ──────────────────────────────────
// DELIBERATE: QuoteMax renders quote previews, where reproducibility beats
// variety — so temperature + top_p default to 0 for the most deterministic,
// prompt-literal output. NOTE this OVERRIDES Google's general Gemini-3
// guidance (ai.google.dev, 2026-06), which recommends leaving temperature
// at 1.0 and warns that lowering it "risks looping or degraded performance";
// top_p is also undocumented for the image models and may be ignored. The
// real adherence levers remain thinkingLevel + the system rules — watch for
// repeated/degraded renders and revert via GEMINI_IMAGE_TEMPERATURE /
// GEMINI_IMAGE_TOP_P if it regresses.
// thinkingLevel 'high' makes the model reason through complex /
// negative-constraint prompts before rendering. Image size is fixed at 1K
// (flash-lite's native resolution). All env-overridable without a deploy.
const IMAGE_TEMPERATURE = (() => {
  const v = Number(process.env.GEMINI_IMAGE_TEMPERATURE)
  return Number.isFinite(v) ? v : 0
})()
const IMAGE_TOP_P = (() => {
  const v = Number(process.env.GEMINI_IMAGE_TOP_P)
  return Number.isFinite(v) ? v : 0
})()
const IMAGE_SIZE = (process.env.GEMINI_IMAGE_SIZE ?? '1K').trim()
// Aspect ratio. 'auto' (default) omits aspect_ratio so Gemini self-selects
// framing. Any other value re-enables passing the caller-derived source
// ratio (image-config.ts) — the anti-crop behaviour — without a code change:
// set GEMINI_IMAGE_ASPECT=source to restore it.
const IMAGE_ASPECT_MODE = (process.env.GEMINI_IMAGE_ASPECT ?? 'auto')
  .trim()
  .toLowerCase()
const IMAGE_THINKING_LEVEL = (process.env.GEMINI_IMAGE_THINKING_LEVEL ?? 'high')
  .trim()
  .toLowerCase()

const endpoint = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

const CAPABILITIES: ProviderCapabilities = {
  edit: true,
  textToImage: true,
  vision: true,
}

// ── Internal payload / response shapes ──────────────────────────────
type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } }

type GeminiInlineData = {
  mime_type?: string
  mimeType?: string
  data: string
}

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
        inline_data?: GeminiInlineData
        inlineData?: GeminiInlineData
      }>
    }
  }>
}

function requireApiKey(): string {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not set')
  return key
}

// ── Transient-failure retry ─────────────────────────────────────────
// Gemini returns 429 (RESOURCE_EXHAUSTED — per-minute/day quota exhausted)
// and 503 (model overloaded) under load; Google's guidance for both is "back
// off and retry". Without this a single momentary spike surfaced as a hard
// failure to every caller — the roof layout-map button showed "Gemini HTTP
// 429". Bounded + capped so retries never blow the caller's Vercel
// maxDuration. All env-tunable without a deploy; GEMINI_RETRY_ATTEMPTS=1
// disables retrying entirely.
const intEnv = (raw: string | undefined, def: number, min: number, max: number): number => {
  const n = Number(raw)
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), min), max) : def
}
const RETRY_ATTEMPTS = () => intEnv(process.env.GEMINI_RETRY_ATTEMPTS, 3, 1, 6)
const RETRY_BASE_MS = () => intEnv(process.env.GEMINI_RETRY_BASE_MS, 800, 0, 60_000)
const RETRY_MAX_DELAY_MS = () => intEnv(process.env.GEMINI_RETRY_MAX_DELAY_MS, 15_000, 0, 60_000)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Honour a numeric `Retry-After` (seconds — what generativelanguage returns);
 *  the HTTP-date form is ignored. Returns ms, or 0 when absent/unparseable. */
function retryAfterMs(header: string | null | undefined): number {
  const secs = Number((header ?? '').trim())
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : 0
}

/** POST to Gemini with bounded exponential backoff on transient (429/503)
 *  statuses. Returns the parsed JSON body; throws `Gemini HTTP <status>:
 *  <body>` when the non-2xx is non-transient or retries are exhausted — the
 *  body is included so logs show WHICH quota tripped (per-minute vs per-day). */
async function geminiPost(url: string, body: unknown): Promise<GeminiResponse> {
  const attempts = RETRY_ATTEMPTS()
  let lastErr = 'Gemini request failed'
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) return (await res.json()) as GeminiResponse
    const errText = await res.text().catch(() => '')
    lastErr = `Gemini HTTP ${res.status}${errText ? `: ${errText.slice(0, 500)}` : ''}`
    const transient = res.status === 429 || res.status === 503
    if (!transient || attempt === attempts) throw new Error(lastErr)
    const backoff = RETRY_BASE_MS() * 2 ** (attempt - 1)
    const delay = Math.min(
      Math.max(backoff, retryAfterMs(res.headers?.get?.('retry-after'))),
      RETRY_MAX_DELAY_MS(),
    )
    if (delay > 0) await sleep(delay)
  }
  throw new Error(lastErr)
}

// ── renderImage ─────────────────────────────────────────────────────
async function renderImage(req: RenderImageRequest): Promise<ImageBytes> {
  const key = requireApiKey()
  const model = req.model ?? DEFAULT_IMAGE_MODEL
  const url = `${endpoint(model)}?key=${encodeURIComponent(key)}`

  // Parts order: user text (+ optional defect feedback) → source image
  // → optional labelled reference image. Same as the previous inline
  // generate.ts / samples.ts callers used.
  const userParts: GeminiPart[] = [
    { text: req.extraStrict ? `${req.user}\n\n${req.extraStrict}` : req.user },
  ]
  if (req.sourceImages?.length) {
    // Labelled set (multi-view conditioning) — the label precedes its image
    // so the model can tell FRONT from LEFT. Wins over the single source.
    for (const { image, label } of req.sourceImages) {
      userParts.push({ text: label })
      userParts.push({ inline_data: { mime_type: image.mime, data: image.base64 } })
    }
  } else if (req.sourceImage) {
    userParts.push({
      inline_data: {
        mime_type: req.sourceImage.mime,
        data: req.sourceImage.base64,
      },
    })
  }
  if (req.reference) {
    userParts.push({ text: req.reference.label })
    userParts.push({
      inline_data: {
        mime_type: req.reference.image.mime,
        data: req.reference.image.base64,
      },
    })
  }

  const body = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: 'user', parts: userParts }],
    generation_config: {
      temperature: req.temperature ?? IMAGE_TEMPERATURE,
      top_p: req.topP ?? IMAGE_TOP_P,
      response_modalities: ['IMAGE'],
      // High thinking = the Gemini-3 image adherence lever (complex /
      // negative-constraint prompts). Image output → never add
      // response_mime_type/response_schema here (those are text-only and
      // would suppress the image). Disable via GEMINI_IMAGE_THINKING_LEVEL=off.
      ...(IMAGE_THINKING_LEVEL && IMAGE_THINKING_LEVEL !== 'off' && IMAGE_THINKING_LEVEL !== 'none'
        ? { thinking_config: { thinking_level: IMAGE_THINKING_LEVEL } }
        : {}),
      // Resolution fixed at 1K (flash-lite native). aspect_ratio omitted by
      // default (IMAGE_ASPECT_MODE='auto') → model self-selects framing; set
      // GEMINI_IMAGE_ASPECT=source to pass the caller-derived source ratio
      // instead (stops Gemini reframing the customer's room).
      image_config: {
        image_size: IMAGE_SIZE,
        ...(IMAGE_ASPECT_MODE !== 'auto' && req.aspectRatio
          ? { aspect_ratio: req.aspectRatio }
          : {}),
      },
    },
  }

  const data = await geminiPost(url, body)
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find(p => p.inline_data?.data || p.inlineData?.data)
  const inline = imagePart?.inline_data ?? imagePart?.inlineData
  if (!inline?.data) {
    const refusal = parts.find(p => p.text)?.text
    throw new Error(
      `Gemini returned no image data${refusal ? ` — ${refusal.slice(0, 200)}` : ''}`,
    )
  }
  return {
    base64: inline.data,
    mime: inline.mime_type ?? inline.mimeType ?? 'image/png',
  }
}

// ── generateText (vision+text) ──────────────────────────────────────
async function generateText(req: TextRequest): Promise<string> {
  const key = requireApiKey()
  const model = req.model ?? DEFAULT_TEXT_MODEL
  const url = `${endpoint(model)}?key=${encodeURIComponent(key)}`

  const parts: GeminiPart[] = [{ text: req.prompt }]
  for (const img of req.images ?? []) {
    parts.push({
      inline_data: { mime_type: img.mime, data: img.base64 },
    })
  }
  // Opt-in structured output: a caller that passes responseSchema gets
  // application/json constrained to that schema (Gemini structured output —
  // text-only, so it replaces response_modalities). Free-text callers (the
  // judge/verify paths) keep the TEXT modality. Pattern proven by
  // lib/invoice/extract.ts; the downstream parsers still strip fences/coerce
  // defensively, so this hardens — never weakens — the existing path.
  const generationConfig: Record<string, unknown> = {
    temperature: req.temperature ?? 0,
  }
  if (req.responseSchema) {
    generationConfig.response_mime_type = 'application/json'
    generationConfig.response_schema = req.responseSchema
  } else {
    generationConfig.response_modalities = ['TEXT']
  }
  const data = await geminiPost(url, {
    contents: [{ role: 'user', parts }],
    generation_config: generationConfig,
  })
  const text = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text ?? ''
  return text
}

export const geminiProvider: ImageProvider = {
  name: 'gemini',
  capabilities: CAPABILITIES,
  renderImage,
  generateText,
}
