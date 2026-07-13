import { describe, it, expect, afterEach } from 'vitest'
import { hfImageModel, hfImageProvider, buildHfImagePrompt, detectMime } from './huggingface'

const ORIG = { ...process.env }
afterEach(() => {
  process.env = { ...ORIG }
})

describe('hfImageModel', () => {
  it('defaults to FLUX.1-Kontext-dev', () => {
    delete process.env.HF_IMAGE_MODEL
    expect(hfImageModel()).toBe('black-forest-labs/FLUX.1-Kontext-dev')
  })
  it('honours HF_IMAGE_MODEL', () => {
    process.env.HF_IMAGE_MODEL = 'Qwen/Qwen-Image-Edit'
    expect(hfImageModel()).toBe('Qwen/Qwen-Image-Edit')
  })
  it('accepts a per-call model ONLY when it is an owner/name slug (never a Gemini id)', () => {
    delete process.env.HF_IMAGE_MODEL
    expect(hfImageModel('owner/model')).toBe('owner/model')
    expect(hfImageModel('gemini-3.1-flash-lite-image')).toBe('black-forest-labs/FLUX.1-Kontext-dev')
  })
})

describe('hfImageProvider', () => {
  it("is undefined (=> 'auto') by default or when set to auto", () => {
    delete process.env.HF_IMAGE_PROVIDER
    expect(hfImageProvider()).toBeUndefined()
    process.env.HF_IMAGE_PROVIDER = 'auto'
    expect(hfImageProvider()).toBeUndefined()
  })
  it('returns a specific partner when forced', () => {
    process.env.HF_IMAGE_PROVIDER = 'fal-ai'
    expect(hfImageProvider()).toBe('fal-ai')
  })
})

describe('buildHfImagePrompt', () => {
  it('folds system + user (+ extraStrict) into one flat instruction', () => {
    expect(
      buildHfImagePrompt({ system: 'SYS', user: 'USER', extraStrict: 'STRICT' } as never),
    ).toBe('SYS\n\nUSER\n\nSTRICT')
    expect(buildHfImagePrompt({ system: '', user: 'only user' } as never)).toBe('only user')
  })
})

describe('detectMime', () => {
  it('reads magic bytes', () => {
    expect(detectMime(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg')
    expect(detectMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe('image/png')
    expect(detectMime(new Uint8Array([0, 0]))).toBe('image/png')
  })
})
