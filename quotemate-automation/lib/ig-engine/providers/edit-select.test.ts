import { describe, it, expect, afterEach } from 'vitest'
import { pickEditImageProvider, editProviderEnv, resolveEditImageProvider, NO_EDIT_PROVIDER } from './edit-select'

const ORIG = { ...process.env }
afterEach(() => {
  process.env = { ...ORIG }
})

const ALL = { hasHuggingFace: true, hasReplicate: true, hasGemini: true }

describe('pickEditImageProvider', () => {
  it('prefers Gemini when its key is set (the primary provider)', () => {
    // The whole point of the 2026-08-04 change: with every credential
    // present, every trade's "after" render goes to Gemini.
    expect(pickEditImageProvider(ALL)).toBe('gemini')
    expect(
      pickEditImageProvider({ hasHuggingFace: true, hasReplicate: true, hasGemini: true }),
    ).toBe('gemini')
    expect(
      pickEditImageProvider({ hasHuggingFace: false, hasReplicate: false, hasGemini: true }),
    ).toBe('gemini')
  })

  it('falls back to Hugging Face, then Replicate, as credentials drop out', () => {
    expect(
      pickEditImageProvider({ hasHuggingFace: true, hasReplicate: true, hasGemini: false }),
    ).toBe('huggingface')
    expect(
      pickEditImageProvider({ hasHuggingFace: false, hasReplicate: true, hasGemini: false }),
    ).toBe('replicate')
  })

  it('returns null when no provider is configured', () => {
    expect(
      pickEditImageProvider({ hasHuggingFace: false, hasReplicate: false, hasGemini: false }),
    ).toBeNull()
  })

  it('honours an explicit override, but only if that provider is configured', () => {
    expect(pickEditImageProvider({ override: 'gemini', ...ALL })).toBe('gemini')
    expect(pickEditImageProvider({ override: 'replicate', ...ALL })).toBe('replicate')
    expect(pickEditImageProvider({ override: 'huggingface', ...ALL })).toBe('huggingface')
    expect(pickEditImageProvider({ override: 'hf', ...ALL })).toBe('huggingface')

    // Override to an unconfigured provider → null (never silently use another).
    expect(
      pickEditImageProvider({ override: 'gemini', hasHuggingFace: true, hasReplicate: true, hasGemini: false }),
    ).toBeNull()
    expect(
      pickEditImageProvider({ override: 'huggingface', hasHuggingFace: false, hasReplicate: true, hasGemini: true }),
    ).toBeNull()
  })

  it('ignores an unknown override and uses the preference order', () => {
    expect(pickEditImageProvider({ override: 'dall-e', ...ALL })).toBe('gemini')
    expect(pickEditImageProvider({ override: '  ', ...ALL })).toBe('gemini')
  })
})

describe('editProviderEnv', () => {
  it('reads either HF token name', () => {
    delete process.env.HUGGING_FACE_API_TOKEN
    delete process.env.HF_TOKEN
    expect(editProviderEnv().hasHuggingFace).toBe(false)

    process.env.HF_TOKEN = 'hf_x'
    expect(editProviderEnv().hasHuggingFace).toBe(true)
  })
})

describe('resolveEditImageProvider', () => {
  it('returns the Gemini provider instance by default when every credential is set', () => {
    process.env.HUGGING_FACE_API_TOKEN = 'hf_x'
    process.env.REPLICATE_API_TOKEN = 'r8_x'
    process.env.GEMINI_API_KEY = 'g_x'
    expect(resolveEditImageProvider()?.name).toBe('gemini')
    // The per-trade escape hatch still works — this is the no-deploy revert.
    expect(resolveEditImageProvider('huggingface')?.name).toBe('huggingface')
    expect(resolveEditImageProvider('replicate')?.name).toBe('replicate')
  })

  it('returns null when nothing is configured', () => {
    delete process.env.HUGGING_FACE_API_TOKEN
    delete process.env.HF_TOKEN
    delete process.env.REPLICATE_API_TOKEN
    delete process.env.GEMINI_API_KEY
    expect(resolveEditImageProvider()).toBeNull()
    expect(NO_EDIT_PROVIDER).toContain('GEMINI_API_KEY')
  })
})
