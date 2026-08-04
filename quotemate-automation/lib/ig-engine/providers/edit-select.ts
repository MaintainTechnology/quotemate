// ════════════════════════════════════════════════════════════════════
// IG Engine — image-EDIT provider selector (the "after" renders).
//
// Shared by roofing ("after re-roof" on the satellite aerial) and painting
// ("after repaint" on the Street View photo / site photo). Every one of those
// renders is image-to-image: a real photo in, the same photo with the roof or
// paint changed out.
//
// Gemini is the PRIMARY provider (2026-08-04) — one provider for every trade,
// so a render looks the same whichever funnel produced it. Hugging Face
// (FLUX.1-Kontext-dev) then Replicate remain fallbacks, used only when
// GEMINI_API_KEY is absent.
//
// ⚠ Was huggingface-first until 2026-08-04. If Gemini image renders start
// 429ing on a free-tier key ("limit: 0" — the reason HF was primary before),
// the revert is per-trade and needs no deploy:
// ROOFING_IMAGE_PROVIDER=huggingface / PAINTING_IMAGE_PROVIDER=huggingface.
//
// Preference order: gemini → huggingface → replicate. Force one per trade with
// ROOFING_IMAGE_PROVIDER / PAINTING_IMAGE_PROVIDER (an override to a provider
// with no credential resolves to null, so we never silently use another one).
//
// NOTE: this governs the trade "after" renders only. The SMS-receptionist
// preview/samples (electrical + plumbing) keep their own text-to-image
// selector in ./select.ts — HF here is an EDIT model and needs a source image.
// ════════════════════════════════════════════════════════════════════

import type { ImageProvider } from './base'
import { geminiProvider } from './gemini'
import { replicateProvider } from './replicate'
import { huggingfaceProvider } from './huggingface'

export type EditImageProviderName = 'huggingface' | 'replicate' | 'gemini'

export type EditProviderEnv = {
  /** ROOFING_IMAGE_PROVIDER / PAINTING_IMAGE_PROVIDER, when set. */
  override?: string | null
  hasHuggingFace: boolean
  hasReplicate: boolean
  hasGemini: boolean
}

/**
 * PURE — resolve the provider from config. Returns null when NO provider is
 * configured (caller skips generation and the page falls back to the plain
 * photo). An explicit override wins, but only if that provider is actually
 * configured; an unknown override is ignored and the preference order applies.
 */
export function pickEditImageProvider(env: EditProviderEnv): EditImageProviderName | null {
  const o = (env.override ?? '').trim().toLowerCase()
  if (o === 'huggingface' || o === 'hf') return env.hasHuggingFace ? 'huggingface' : null
  if (o === 'replicate') return env.hasReplicate ? 'replicate' : null
  if (o === 'gemini') return env.hasGemini ? 'gemini' : null

  if (env.hasGemini) return 'gemini'
  if (env.hasHuggingFace) return 'huggingface'
  if (env.hasReplicate) return 'replicate'
  return null
}

/** READS ENV — which credentials are present. */
export function editProviderEnv(override?: string | null): EditProviderEnv {
  return {
    override: override ?? null,
    hasHuggingFace: !!(process.env.HUGGING_FACE_API_TOKEN ?? process.env.HF_TOKEN)?.trim(),
    hasReplicate: !!process.env.REPLICATE_API_TOKEN?.trim(),
    hasGemini: !!process.env.GEMINI_API_KEY?.trim(),
  }
}

const INSTANCES: Record<EditImageProviderName, ImageProvider> = {
  huggingface: huggingfaceProvider,
  replicate: replicateProvider,
  gemini: geminiProvider,
}

/** READS ENV — the provider instance to render with, or null when none is configured. */
export function resolveEditImageProvider(override?: string | null): ImageProvider | null {
  const name = pickEditImageProvider(editProviderEnv(override))
  return name ? INSTANCES[name] : null
}

/** The skip reason to log/return when no provider is configured. */
export const NO_EDIT_PROVIDER =
  'no image provider (GEMINI_API_KEY / HUGGING_FACE_API_TOKEN / REPLICATE_API_TOKEN)'
