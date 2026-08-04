// ════════════════════════════════════════════════════════════════════
// Roofing vision provider — Hugging Face open VLM (PRIMARY) → Anthropic
// Claude (FALLBACK).
//
// Used by the two roofing photo-vision tasks (vision-verify + close-up solar
// detection). HF cuts Anthropic usage/cost; Claude backstops the money/liability
// path (asbestos, roof material, existing solar) when HF fails OR returns nothing
// usable. Open VLMs are weaker at these reads than Claude, so the HF answer must
// pass an isUsable gate — otherwise we fall through to Claude.
//
// The open-VLM PRIMARY is pluggable via ROOFING_VISION_PROVIDER (mirrors the
// image side). Two open backends + the Claude fallback:
//   • huggingface (default) — Inference-Providers router (chat/completions,
//     image_url data URIs). HUGGING_FACE_API_TOKEN; model HF_VISION_MODEL
//     (default Qwen2.5-VL-72B). Multi-image.
//   • cloudflare — Workers AI native /ai/run (Llama-3.2-Vision by default).
//     CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_WORKERS_AI_TOKEN (falls back to
//     CLOUDFLARE_CLAUDE_VISION / CLOUDFLARE_API_TOKEN); model
//     CLOUDFLARE_VISION_MODEL. SINGLE-image (sends the first image) — the
//     building-match compare degrades to null; material classification is intact.
//   • ROOFING_VISION_PROVIDER picks the PRIMARY; the other open VLM is the middle
//     fallback and Claude (ANTHROPIC_API_KEY, model ROOFING_VISION_MODEL) is
//     ALWAYS the final backstop. =cloudflare → Cloudflare→HF→Claude; =huggingface
//     or unset → HF→Cloudflare→Claude; =claude → Claude only.
// NOTE: neither Claude nor Google/Gemini models are hosted on HF or Cloudflare
// Workers AI — both "primaries" are OPEN VLMs; the frontier Claude read is the
// fallback backstop for the asbestos/material call.
//
// The raw callers throw on failure; roofingVisionParsed wraps them best-effort.
// ════════════════════════════════════════════════════════════════════

import { deterministicSampling } from '@/lib/llm/sampling'

export type VisionImage = { base64: string; mime: string }

type RawVisionCall = (args: { prompt: string; images: VisionImage[]; model?: string }) => Promise<string>

const HF_ENDPOINT = 'https://router.huggingface.co/v1/chat/completions'
// The most powerful broadly-served open VLM on HF Inference Providers (MMMU ~70;
// strong at roof material / text / object reads). Override with HF_VISION_MODEL —
// e.g. OpenGVLab/InternVL3-78B (highest open MMMU) or a Qwen3-VL id. HF routes
// this via server-side auto provider selection, so no extra provider config.
const DEFAULT_HF_MODEL = 'Qwen/Qwen2.5-VL-72B-Instruct'

// Cloudflare Workers AI — native /ai/run for a broadly-available open VLM.
// Override with CLOUDFLARE_VISION_MODEL. Single-image endpoint.
const DEFAULT_CF_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct'

export function hfToken(): string {
  return (process.env.HUGGING_FACE_API_TOKEN ?? process.env.HF_TOKEN ?? '').trim()
}
export function hfReady(): boolean {
  return hfToken().length > 0
}
export function claudeReady(): boolean {
  return (process.env.ANTHROPIC_API_KEY ?? '').trim().length > 0
}
/** Workers AI token — prefers a dedicated var, falls back to the user's labelled
 *  CLOUDFLARE_CLAUDE_VISION token or the account API token. */
export function cfToken(): string {
  return (
    process.env.CLOUDFLARE_WORKERS_AI_TOKEN ??
    process.env.CLOUDFLARE_CLAUDE_VISION ??
    process.env.CLOUDFLARE_API_TOKEN ??
    ''
  ).trim()
}
export function cfAccountId(): string {
  return (process.env.CLOUDFLARE_ACCOUNT_ID ?? '').trim()
}
export function cfReady(): boolean {
  return cfToken().length > 0 && cfAccountId().length > 0
}

/** Raw HF VLM call — OpenAI-compatible chat completions with image_url data
 *  URIs. Throws on any failure so the caller falls back to Claude. */
export const hfVisionText: RawVisionCall = async ({ prompt, images, model }) => {
  const token = hfToken()
  if (!token) throw new Error('HUGGING_FACE_API_TOKEN not set')
  const mdl = model ?? process.env.HF_VISION_MODEL ?? DEFAULT_HF_MODEL
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
  for (const img of images) {
    content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } })
  }
  const res = await fetch(HF_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: mdl, messages: [{ role: 'user', content }], max_tokens: 1024, temperature: 0 }),
  })
  if (!res.ok) throw new Error(`HF ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> }
  const text = body?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text) throw new Error('HF returned no text')
  return text
}

/** Raw Claude vision call (@ai-sdk/anthropic) — the SAME SDK shape the roofing
 *  vision tasks used before. Throws on failure. */
export const claudeVisionText: RawVisionCall = async ({ prompt, images, model }) => {
  if (!claudeReady()) throw new Error('ANTHROPIC_API_KEY not set')
  const { anthropic } = await import('@ai-sdk/anthropic')
  const { generateText } = await import('ai')
  const mdl = model ?? process.env.ROOFING_VISION_MODEL ?? 'claude-sonnet-4-6'
  const content: Array<
    { type: 'text'; text: string } | { type: 'image'; image: string; mediaType: string }
  > = [{ type: 'text', text: prompt }]
  for (const img of images) content.push({ type: 'image', image: img.base64, mediaType: img.mime })
  const { text } = await generateText({
    model: anthropic(mdl),
    // See lib/llm/sampling.ts — ROOFING_VISION_MODEL is the model id for
    // roof photo analysis, solar photo vision AND vision-verify, so an
    // unguarded `temperature: 0` here 400s three callers at once the moment
    // it points at a model that has dropped the parameter.
    ...deterministicSampling(mdl),
    messages: [{ role: 'user' as const, content }],
  })
  return text
}

/** Raw Cloudflare Workers AI VLM call — native /ai/run. The endpoint takes a
 *  SINGLE image, so only the first image is sent (the building-match compare
 *  degrades to null; material classification is unaffected). Workers AI returns
 *  result.response as either a string OR an already-parsed object — both are
 *  normalised to a string for the shared parsers. Throws on failure so the
 *  caller falls back to Claude. */
export const cfVisionText: RawVisionCall = async ({ prompt, images, model }) => {
  const token = cfToken()
  const account = cfAccountId()
  if (!token) throw new Error('CLOUDFLARE_WORKERS_AI_TOKEN not set')
  if (!account) throw new Error('CLOUDFLARE_ACCOUNT_ID not set')
  const first = images[0]
  if (!first) throw new Error('cloudflare vision: no image')
  const mdl = model ?? process.env.CLOUDFLARE_VISION_MODEL ?? DEFAULT_CF_MODEL
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${mdl}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image: [...Buffer.from(first.base64, 'base64')], max_tokens: 1024 }),
  })
  if (!res.ok) throw new Error(`Cloudflare ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as { result?: { response?: unknown } }
  const r = body?.result?.response
  const text = typeof r === 'string' ? r : r != null ? JSON.stringify(r) : ''
  if (!text) throw new Error('Cloudflare returned no text')
  return text
}

export type VisionDeps = {
  hf?: RawVisionCall
  cf?: RawVisionCall
  claude?: RawVisionCall
  hfReady?: boolean
  cloudflareReady?: boolean
  claudeReady?: boolean
  onFallback?: (reason: string) => void
}

export type VisionProviderName = 'hf' | 'cloudflare' | 'claude'

/**
 * PURE — the ordered vision provider CHAIN, honouring ROOFING_VISION_PROVIDER
 * (mirrors ROOFING_IMAGE_PROVIDER). The selected open VLM goes first, the other
 * open VLM is the middle fallback, and Claude is ALWAYS the final backstop:
 *   • unset / 'huggingface' / 'hf'       → ['hf', 'cloudflare', 'claude']
 *   • 'cloudflare' / 'cf' / 'workers-ai' → ['cloudflare', 'hf', 'claude']
 *   • 'claude' / 'anthropic'             → ['claude']  (skip the open VLMs — keep
 *                                           the asbestos-critical read on Claude)
 * Providers that aren't configured (no token/key) are dropped, order preserved.
 */
export function resolveVisionChain(env: {
  override?: string | null
  hasHf: boolean
  hasCloudflare: boolean
  hasClaude: boolean
}): VisionProviderName[] {
  const o = (env.override ?? '').trim().toLowerCase()
  const order: VisionProviderName[] =
    o === 'claude' || o === 'anthropic'
      ? ['claude']
      : o === 'cloudflare' || o === 'cf' || o === 'workers-ai'
        ? ['cloudflare', 'hf', 'claude']
        : ['hf', 'cloudflare', 'claude']
  const has: Record<VisionProviderName, boolean> = {
    hf: env.hasHf,
    cloudflare: env.hasCloudflare,
    claude: env.hasClaude,
  }
  return order.filter((p) => has[p])
}

/**
 * Roofing vision over the ordered provider chain from ROOFING_VISION_PROVIDER
 * (resolveVisionChain). Walks the chain and returns the first response that
 * PARSES to a usable value:
 *   • an OPEN VLM (hf / cloudflare) is accepted only when it parses AND passes
 *     `isUsable` — a fully-inconclusive read falls through to the next provider.
 *   • Claude (always last in the chain) accepts any parseable answer.
 * Null when no provider in the chain yields a parseable answer; never throws.
 * `deps` is injectable for unit tests.
 */
export async function roofingVisionParsed<T>(args: {
  prompt: string
  images: VisionImage[]
  parse: (text: string) => T | null
  isUsable?: (v: T) => boolean
  model?: { hf?: string; cloudflare?: string; claude?: string }
  deps?: VisionDeps
}): Promise<{ value: T; source: VisionProviderName } | null> {
  const calls: Record<VisionProviderName, RawVisionCall> = {
    hf: args.deps?.hf ?? hfVisionText,
    cloudflare: args.deps?.cf ?? cfVisionText,
    claude: args.deps?.claude ?? claudeVisionText,
  }
  const chain = resolveVisionChain({
    override: process.env.ROOFING_VISION_PROVIDER,
    hasHf: args.deps?.hfReady ?? hfReady(),
    hasCloudflare: args.deps?.cloudflareReady ?? cfReady(),
    hasClaude: args.deps?.claudeReady ?? claudeReady(),
  })

  for (const name of chain) {
    try {
      const text = await calls[name]({ prompt: args.prompt, images: args.images, model: args.model?.[name] })
      const v = text && text.trim() ? args.parse(text) : null
      // Claude (the final backstop) accepts any parse; open VLMs must be `isUsable`.
      if (v !== null && (name === 'claude' || (args.isUsable?.(v) ?? true))) {
        return { value: v, source: name }
      }
      args.deps?.onFallback?.(`${name} returned no usable answer`)
    } catch (e) {
      args.deps?.onFallback?.(e instanceof Error ? e.message : String(e))
    }
  }
  return null
}
