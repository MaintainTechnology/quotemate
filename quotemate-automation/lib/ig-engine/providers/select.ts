// ════════════════════════════════════════════════════════════════════
// IG Engine — image-generation provider selector.
//
// The SMS-receptionist image stage (electrical + plumbing): preview
// (generate.ts) and the sample gallery (samples.ts) call through this
// selector so the underlying generator can be swapped by config alone.
//
// Selection order:
//   1. IG_IMAGE_PROVIDER env override ('gemini' | 'stability' | 'replicate') — wins.
//   2. otherwise → 'gemini'.
//
// ⚠ Gemini is the unconditional default as of 2026-08-04 — one image
// provider across every trade. Until then this auto-switched to Stability
// whenever STABILITY_NIM_URL happened to be set, which silently routed the
// electrical/plumbing image stage away from Gemini as a side effect of an
// unrelated env var. Selecting Stability is now an explicit, deliberate act:
// IG_IMAGE_PROVIDER=stability. STABILITY_NIM_URL is still the credential that
// makes that choice *ready* (see imageGenReadiness), it just no longer
// *makes* the choice.
//
// NOTE: this only governs text-to-image for the SMS receptionist
// preview/samples. The trade "after" renders use ./edit-select.ts (also
// Gemini-first); the judge/verify QA paths pick their own and are
// intentionally not routed through here.
// ════════════════════════════════════════════════════════════════════

import type { ImageProvider } from './base'
import { geminiProvider } from './gemini'
import { stabilityProvider } from './stability'
import { replicateProvider } from './replicate'

export type ImageGenProvider = 'stability' | 'gemini' | 'replicate'

/** PURE-ish (reads env): which generator the engine should use. */
export function imageProviderName(): ImageGenProvider {
  const override = (process.env.IG_IMAGE_PROVIDER || '').trim().toLowerCase()
  if (override === 'replicate') return 'replicate'
  if (override === 'stability') return 'stability'
  return 'gemini'
}

/** The selected image-generation provider instance. */
export function selectImageProvider(): ImageProvider {
  const name = imageProviderName()
  if (name === 'replicate') return replicateProvider
  if (name === 'stability') return stabilityProvider
  return geminiProvider
}

/**
 * Is the selected generator actually configured to run? Mirrors the
 * per-provider credential the generators previously guarded on:
 *   · replicate → REPLICATE_API_TOKEN must be set
 *   · stability → STABILITY_NIM_URL must be set
 *   · gemini    → GEMINI_API_KEY must be set
 * Returns the missing-config reason when not ready (for a clean skip).
 */
export function imageGenReadiness(): { ready: boolean; provider: ImageGenProvider; reason: string } {
  const provider = imageProviderName()
  if (provider === 'replicate') {
    return process.env.REPLICATE_API_TOKEN?.trim()
      ? { ready: true, provider, reason: '' }
      : { ready: false, provider, reason: 'REPLICATE_API_TOKEN missing' }
  }
  if (provider === 'stability') {
    return process.env.STABILITY_NIM_URL?.trim()
      ? { ready: true, provider, reason: '' }
      : { ready: false, provider, reason: 'STABILITY_NIM_URL missing' }
  }
  return process.env.GEMINI_API_KEY?.trim()
    ? { ready: true, provider, reason: '' }
    : { ready: false, provider, reason: 'GEMINI_API_KEY missing' }
}
