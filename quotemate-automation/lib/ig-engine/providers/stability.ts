// ════════════════════════════════════════════════════════════════════
// IG Engine — Stability SD 3.5 Large provider adapter (NVIDIA NIM).
//
// Wraps the NVIDIA "Visual GenAI" inference contract for Stable
// Diffusion 3.5 Large. This is a TEXT-TO-IMAGE model: it renders a
// brand-new image from the prompt — it does NOT edit a supplied photo.
// The SMS-receptionist preview + sample paths (electrical + plumbing)
// dispatch through here when STABILITY_NIM_URL is configured; see
// providers/select.ts for how the engine picks between this and Gemini.
//
// Wire format (verified against the live NVIDIA `artifacts` response
// shape and the build.nvidia.com SD 3.5 Large NIM deploy guide):
//   POST <STABILITY_NIM_URL>            (default http://localhost:8000/v1/infer)
//   headers: Accept + Content-Type json, optional Bearer <key>
//   body:    { prompt, mode, cfg_scale, aspect_ratio?, seed, steps,
//              negative_prompt }
//   200:     { artifacts: [{ base64, finishReason, seed }] }
//            (self-hosted NIM + NVIDIA-hosted genai) — a single-image
//            { image, finish_reason } shape is also tolerated.
//
// SD has no `system` role and no `temperature`, so the adapter folds
// req.system + req.user (+ extraStrict) into one prompt and ignores
// temperature. As a text-to-image model it also has no use for the
// sourceImage / reference photos, so those are intentionally dropped —
// the engine already chose text-to-image for both preview and samples.
//
// The adapter throws on failure; callers wrap in their own best-effort
// logic (the preview/samples generators treat any render error as a
// non-blocking failure on that quote).
// ════════════════════════════════════════════════════════════════════

import type {
  ImageBytes,
  ImageProvider,
  ProviderCapabilities,
  RenderImageRequest,
} from './base'

// Default to the NIM's documented local invoke URL. In production this
// points at wherever the SD 3.5 Large NIM container is served (a GPU
// host / DGX Cloud). Setting it is what activates this provider.
const DEFAULT_NIM_URL = 'http://localhost:8000/v1/infer'

// ── Tunables (env-overridable, never need a deploy to change) ────────
function nimUrl(): string {
  return (process.env.STABILITY_NIM_URL || DEFAULT_NIM_URL).trim()
}
// Self-hosted NIMs typically need no inference auth; the NVIDIA-hosted
// genai gateway needs the nvapi- bearer. Send it only when present.
function apiKey(): string | null {
  return (process.env.STABILITY_API_KEY || process.env.NVIDIA_API_KEY || '').trim() || null
}
function defaultMode(): string {
  return (process.env.STABILITY_IMAGE_MODE || 'base').trim()
}
function defaultSteps(): number {
  const n = Number(process.env.STABILITY_IMAGE_STEPS)
  return Number.isInteger(n) && n > 0 && n <= 100 ? n : 50
}
function defaultCfgScale(): number {
  const n = Number(process.env.STABILITY_IMAGE_CFG_SCALE)
  return Number.isFinite(n) && n >= 0 && n <= 20 ? n : 5
}
function defaultNegativePrompt(): string {
  return process.env.STABILITY_IMAGE_NEGATIVE_PROMPT ?? ''
}

const CAPABILITIES: ProviderCapabilities = {
  // Pure text-to-image — cannot edit a supplied photo, cannot judge.
  edit: false,
  textToImage: true,
  vision: false,
}

// ── Internal response shapes ────────────────────────────────────────
type StabilityArtifact = {
  base64?: string
  finishReason?: string
  finish_reason?: string
  seed?: number
}
type StabilityResponse = {
  // Self-hosted NIM + NVIDIA-hosted genai
  artifacts?: StabilityArtifact[]
  // Single-image variant (e.g. hosted SD3-medium)
  image?: string
  finish_reason?: string
}

/** Build the single prompt SD consumes from the provider-agnostic
 *  system/user/extraStrict fields. PURE. */
export function buildStabilityPrompt(req: RenderImageRequest): string {
  const user = req.extraStrict ? `${req.user}\n\n${req.extraStrict}` : req.user
  return [req.system, user].filter((s) => s && s.trim() !== '').join('\n\n')
}

/** Detect the image mime from a base64 payload's magic bytes. Defaults
 *  to image/jpeg (the NIM's default output format). PURE. */
export function detectMimeFromBase64(b64: string): string {
  const head = (b64 || '').slice(0, 16)
  if (head.startsWith('/9j/')) return 'image/jpeg'
  if (head.startsWith('iVBORw0KGgo')) return 'image/png'
  if (head.startsWith('UklGR')) return 'image/webp'
  if (head.startsWith('R0lGOD')) return 'image/gif'
  return 'image/jpeg'
}

/** PURE — pull the image base64 out of either response shape, throwing a
 *  descriptive error when the response carries no image (e.g. a content
 *  filter or inference error). */
export function extractImage(data: StabilityResponse): ImageBytes {
  const artifact = data.artifacts?.find((a) => a?.base64)
  const b64 = artifact?.base64 ?? (typeof data.image === 'string' ? data.image : undefined)
  if (!b64) {
    const reason =
      data.artifacts?.[0]?.finishReason ??
      data.artifacts?.[0]?.finish_reason ??
      data.finish_reason ??
      'no artifacts'
    throw new Error(`Stability returned no image data — ${String(reason).slice(0, 200)}`)
  }
  // A non-success finish reason with no image is a hard failure; with an
  // image present we keep it (SUCCESS, or a soft note alongside a render).
  return { base64: b64, mime: detectMimeFromBase64(b64) }
}

// ── renderImage ─────────────────────────────────────────────────────
async function renderImage(req: RenderImageRequest): Promise<ImageBytes> {
  const url = nimUrl()
  if (!url) throw new Error('STABILITY_NIM_URL not set')

  // Text-to-image: prompt only. sourceImage / reference are intentionally
  // NOT sent — SD 3.5 Large (base mode) cannot consume them.
  const body: Record<string, unknown> = {
    prompt: buildStabilityPrompt(req),
    mode: defaultMode(),
    cfg_scale: defaultCfgScale(),
    seed: 0, // 0 = random seed
    steps: defaultSteps(),
    negative_prompt: defaultNegativePrompt(),
  }
  // aspect_ratio is text-to-image only; forward it when the caller derived
  // one from the customer's source photo so framing stays sensible.
  if (req.aspectRatio) body.aspect_ratio = req.aspectRatio

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  const key = apiKey()
  if (key) headers.Authorization = `Bearer ${key}`

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = (await res.text()).slice(0, 500)
    throw new Error(`Stability HTTP ${res.status}: ${errText}`)
  }
  const data = (await res.json()) as StabilityResponse
  return extractImage(data)
}

export const stabilityProvider: ImageProvider = {
  name: 'stability',
  capabilities: CAPABILITIES,
  renderImage,
  // No generateText — SD has no vision. The judge/verify QA paths stay on
  // their own (Gemini/Claude) providers; they are not image generation.
}
