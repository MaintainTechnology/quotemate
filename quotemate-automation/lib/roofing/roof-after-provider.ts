// PURE — which image-generation provider roofing's "after re-roof" render uses.
//
// The direct Gemini image API (gemini-*-image) is free-tier quota-limited and
// 429s ("limit: 0"), which fails [roofing/after]. Replicate's google/nano-banana-pro
// is the SAME model quality reached through a paid Replicate token, so roofing
// PREFERS Replicate when REPLICATE_API_TOKEN is set, falling back to Gemini
// otherwise. Force either side with ROOFING_IMAGE_PROVIDER=replicate|gemini.
//
// Kept in its own pure module (no supabase/SDK) so it's unit-testable without
// dragging roof-after.ts's module-level Supabase client into the test.

export type RoofingImageProviderName = 'replicate' | 'gemini' | 'huggingface'

/**
 * PURE — resolve the provider from config. Returns null when NO provider is
 * configured (caller skips generation). An explicit override wins but only if
 * that provider is actually configured. HuggingFace (open FLUX-Kontext editing)
 * is EXPERIMENTAL, so it is opt-in ONLY via ROOFING_IMAGE_PROVIDER=huggingface —
 * never the silent default. Default preference: Replicate → Gemini.
 */
export function pickRoofingImageProvider(env: {
  override?: string | null
  hasReplicate: boolean
  hasGemini: boolean
  hasHuggingFace?: boolean
}): RoofingImageProviderName | null {
  const o = (env.override ?? '').trim().toLowerCase()
  if (o === 'huggingface' || o === 'hf') return env.hasHuggingFace ? 'huggingface' : null
  if (o === 'gemini') return env.hasGemini ? 'gemini' : null
  if (o === 'replicate') return env.hasReplicate ? 'replicate' : null
  if (env.hasReplicate) return 'replicate'
  if (env.hasGemini) return 'gemini'
  return null
}
