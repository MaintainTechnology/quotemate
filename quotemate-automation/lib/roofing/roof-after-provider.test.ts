import { describe, it, expect } from 'vitest'
import { pickRoofingImageProvider } from './roof-after-provider'

describe('pickRoofingImageProvider', () => {
  it('prefers Replicate when its token is set (avoids the Gemini 429)', () => {
    expect(pickRoofingImageProvider({ hasReplicate: true, hasGemini: true })).toBe('replicate')
    expect(pickRoofingImageProvider({ hasReplicate: true, hasGemini: false })).toBe('replicate')
  })

  it('falls back to Gemini when Replicate is not configured', () => {
    expect(pickRoofingImageProvider({ hasReplicate: false, hasGemini: true })).toBe('gemini')
  })

  it('returns null when neither provider is configured', () => {
    expect(pickRoofingImageProvider({ hasReplicate: false, hasGemini: false })).toBeNull()
  })

  it('honours an explicit override, but only if that provider is configured', () => {
    expect(pickRoofingImageProvider({ override: 'gemini', hasReplicate: true, hasGemini: true })).toBe('gemini')
    expect(pickRoofingImageProvider({ override: 'replicate', hasReplicate: true, hasGemini: true })).toBe('replicate')
    // override to an unconfigured provider → null (never silently use the other)
    expect(pickRoofingImageProvider({ override: 'gemini', hasReplicate: true, hasGemini: false })).toBeNull()
    expect(pickRoofingImageProvider({ override: 'replicate', hasReplicate: false, hasGemini: true })).toBeNull()
  })

  it('ignores an unknown override and uses the preference order', () => {
    expect(pickRoofingImageProvider({ override: 'dall-e', hasReplicate: true, hasGemini: true })).toBe('replicate')
  })

  it('HuggingFace is opt-in ONLY via override (never the silent default)', () => {
    // Not chosen by default even when its token is present.
    expect(
      pickRoofingImageProvider({ hasReplicate: true, hasGemini: true, hasHuggingFace: true }),
    ).toBe('replicate')
    // Explicit override (or 'hf') selects it when configured.
    expect(
      pickRoofingImageProvider({ override: 'huggingface', hasReplicate: true, hasGemini: true, hasHuggingFace: true }),
    ).toBe('huggingface')
    expect(
      pickRoofingImageProvider({ override: 'hf', hasReplicate: false, hasGemini: false, hasHuggingFace: true }),
    ).toBe('huggingface')
    // Override to HF but no HF token → null (never silently use another).
    expect(
      pickRoofingImageProvider({ override: 'huggingface', hasReplicate: true, hasGemini: true, hasHuggingFace: false }),
    ).toBeNull()
  })
})
