import { describe, it, expect, afterEach } from 'vitest'
import { pickEditImageProvider, editProviderEnv, resolveEditImageProvider, NO_EDIT_PROVIDER } from './edit-select'

const ORIG = { ...process.env }
afterEach(() => {
  process.env = { ...ORIG }
})

const ALL = { hasHuggingFace: true, hasReplicate: true, hasGemini: true }

describe('pickEditImageProvider', () => {
  it('prefers Hugging Face when its token is set (the primary provider)', () => {
    expect(pickEditImageProvider(ALL)).toBe('huggingface')
    expect(
      pickEditImageProvider({ hasHuggingFace: true, hasReplicate: false, hasGemini: false }),
    ).toBe('huggingface')
  })

  it('falls back to Replicate, then Gemini, as tokens drop out', () => {
    expect(
      pickEditImageProvider({ hasHuggingFace: false, hasReplicate: true, hasGemini: true }),
    ).toBe('replicate')
    expect(
      pickEditImageProvider({ hasHuggingFace: false, hasReplicate: false, hasGemini: true }),
    ).toBe('gemini')
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
    expect(pickEditImageProvider({ override: 'dall-e', ...ALL })).toBe('huggingface')
    expect(pickEditImageProvider({ override: '  ', ...ALL })).toBe('huggingface')
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
  it('returns the Hugging Face provider instance by default when its token is set', () => {
    process.env.HUGGING_FACE_API_TOKEN = 'hf_x'
    process.env.REPLICATE_API_TOKEN = 'r8_x'
    process.env.GEMINI_API_KEY = 'g_x'
    expect(resolveEditImageProvider()?.name).toBe('huggingface')
    expect(resolveEditImageProvider('replicate')?.name).toBe('replicate')
  })

  it('returns null when nothing is configured', () => {
    delete process.env.HUGGING_FACE_API_TOKEN
    delete process.env.HF_TOKEN
    delete process.env.REPLICATE_API_TOKEN
    delete process.env.GEMINI_API_KEY
    expect(resolveEditImageProvider()).toBeNull()
    expect(NO_EDIT_PROVIDER).toContain('HUGGING_FACE_API_TOKEN')
  })
})
