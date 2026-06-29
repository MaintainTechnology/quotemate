// ════════════════════════════════════════════════════════════════════
// IG Engine — image-generation provider selector.
//
// The SMS-receptionist image stage (electrical + plumbing): preview
// (generate.ts) and the sample gallery (samples.ts) call through this
// selector so the underlying generator can be swapped by config alone.
//
// Selection order:
//   1. IG_IMAGE_PROVIDER env override ('stability' | 'gemini') — wins.
//   2. STABILITY_NIM_URL set  → 'stability' (SD 3.5 Large, text-to-image).
//   3. otherwise               → 'gemini' (legacy behaviour).
//
// This makes the Stability swap a safe, config-gated rollout: until the
// SD 3.5 Large NIM is deployed and STABILITY_NIM_URL points at it, the
// engine keeps using Gemini — nothing breaks. Set the URL (and the
// optional STABILITY_API_KEY) and the el/plumbing image stage switches
// to Stability automatically.
//
// NOTE: this only governs IMAGE GENERATION for the SMS receptionist
// preview/samples. The judge/verify QA paths (off by default) and the
// dedicated painting/roofing/solar routes pick their own providers and
// are intentionally not routed through here.
// ════════════════════════════════════════════════════════════════════

import type { ImageProvider } from './base'
import { geminiProvider } from './gemini'
import { stabilityProvider } from './stability'

export type ImageGenProvider = 'stability' | 'gemini'

/** PURE-ish (reads env): which generator the engine should use. */
export function imageProviderName(): ImageGenProvider {
  const override = (process.env.IG_IMAGE_PROVIDER || '').trim().toLowerCase()
  if (override === 'stability') return 'stability'
  if (override === 'gemini') return 'gemini'
  return process.env.STABILITY_NIM_URL?.trim() ? 'stability' : 'gemini'
}

/** The selected image-generation provider instance. */
export function selectImageProvider(): ImageProvider {
  return imageProviderName() === 'stability' ? stabilityProvider : geminiProvider
}

/**
 * Is the selected generator actually configured to run? Mirrors the
 * per-provider credential the generators previously guarded on:
 *   · stability → STABILITY_NIM_URL must be set
 *   · gemini    → GEMINI_API_KEY must be set
 * Returns the missing-config reason when not ready (for a clean skip).
 */
export function imageGenReadiness(): { ready: boolean; provider: ImageGenProvider; reason: string } {
  const provider = imageProviderName()
  if (provider === 'stability') {
    return process.env.STABILITY_NIM_URL?.trim()
      ? { ready: true, provider, reason: '' }
      : { ready: false, provider, reason: 'STABILITY_NIM_URL missing' }
  }
  return process.env.GEMINI_API_KEY?.trim()
    ? { ready: true, provider, reason: '' }
    : { ready: false, provider, reason: 'GEMINI_API_KEY missing' }
}
