// IG Engine — Replicate (Nano Banana Pro) provider adapter tests. Mock
// fetch to inspect the exact payload sent and verify the two-call flow
// (POST prediction → GET output image). Also covers the pure helpers.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  replicateProvider,
  buildReplicatePrompt,
  buildImageInput,
  resolveAspectRatio,
  extractOutputUrl,
  replicateModel,
} from './replicate'

// A 1x1 PNG's leading magic bytes are enough for detectMime.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

function predictionResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response
}
function imageResponse(bytes: Uint8Array, ok = true, status = 200): Response {
  return { ok, status, arrayBuffer: async () => bytes.buffer } as unknown as Response
}

describe('replicate pure helpers', () => {
  it('folds system + user + reference legend into one prompt', () => {
    const p = buildReplicatePrompt({
      system: 'RULES',
      user: 'RENDER',
      sourceImage: { base64: 'SRC', mime: 'image/jpeg' },
      reference: { image: { base64: 'REF', mime: 'image/png' }, label: 'PRODUCT REFERENCE' },
    })
    expect(p).toContain('RULES')
    expect(p).toContain('RENDER')
    expect(p).toContain('image 1') // customer photo legend
    expect(p).toContain('PRODUCT REFERENCE') // reference legend
  })

  it('appends extraStrict to the user portion', () => {
    const p = buildReplicatePrompt({ system: 'S', user: 'U', extraStrict: 'FIX COUNT' })
    expect(p).toContain('U\n\nFIX COUNT')
  })

  it('builds ordered data-URI image_input (source then reference)', () => {
    const imgs = buildImageInput({
      system: '', user: '',
      sourceImage: { base64: 'AAA', mime: 'image/jpeg' },
      reference: { image: { base64: 'BBB', mime: 'image/png' }, label: 'x' },
    })
    expect(imgs).toEqual(['data:image/jpeg;base64,AAA', 'data:image/png;base64,BBB'])
  })

  it('uses match_input_image when an image is present, else 1:1', () => {
    expect(resolveAspectRatio({ system: '', user: '', sourceImage: { base64: 'x', mime: 'image/png' } }))
      .toBe('match_input_image')
    expect(resolveAspectRatio({ system: '', user: '' })).toBe('1:1')
  })

  it('extractOutputUrl handles string and array outputs', () => {
    expect(extractOutputUrl('https://x/y.png')).toBe('https://x/y.png')
    expect(extractOutputUrl(['https://x/a.png', 'https://x/b.png'])).toBe('https://x/a.png')
    expect(() => extractOutputUrl(null)).toThrow(/no output image/)
  })

  it('replicateModel ignores Gemini ids but honours a slug override', () => {
    expect(replicateModel('gemini-3.1-flash-lite-image')).toBe('google/nano-banana-pro')
    expect(replicateModel('some-owner/custom-model')).toBe('some-owner/custom-model')
  })
})

describe('replicateProvider.renderImage', () => {
  const prevToken = process.env.REPLICATE_API_TOKEN
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    process.env.REPLICATE_API_TOKEN = 'test-token'
    fetchSpy = vi.spyOn(globalThis, 'fetch')
    // 1st call → prediction succeeded; 2nd call → the output image bytes.
    fetchSpy
      .mockResolvedValueOnce(
        predictionResponse({ status: 'succeeded', output: 'https://replicate.delivery/out.png' }),
      )
      .mockResolvedValueOnce(imageResponse(PNG_BYTES))
  })
  afterEach(() => {
    fetchSpy.mockRestore()
    if (prevToken === undefined) delete process.env.REPLICATE_API_TOKEN
    else process.env.REPLICATE_API_TOKEN = prevToken
  })

  it('POSTs to the model predictions endpoint with a safe, fallback-off payload', async () => {
    await replicateProvider.renderImage({
      system: 'SYS', user: 'USER',
      sourceImage: { base64: 'SRC', mime: 'image/jpeg' },
    })
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.replicate.com/v1/models/google/nano-banana-pro/predictions')
    expect((init.headers as Record<string, string>).Prefer).toBe('wait')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
    const body = JSON.parse(init.body as string)
    expect(body.input.allow_fallback_model).toBe(false) // never silently swap models
    expect(body.input.aspect_ratio).toBe('match_input_image')
    expect(body.input.image_input).toEqual(['data:image/jpeg;base64,SRC'])
    expect(body.input.prompt).toContain('SYS')
  })

  it('returns the fetched output bytes as base64 + detected mime', async () => {
    const out = await replicateProvider.renderImage({ system: 'S', user: 'U' })
    expect(out.mime).toBe('image/png')
    expect(out.base64).toBe(Buffer.from(PNG_BYTES).toString('base64'))
  })

  it('throws when REPLICATE_API_TOKEN is missing', async () => {
    delete process.env.REPLICATE_API_TOKEN
    await expect(replicateProvider.renderImage({ system: 'S', user: 'U' })).rejects.toThrow(/REPLICATE_API_TOKEN/)
  })

  it('throws when the prediction does not succeed', async () => {
    fetchSpy.mockReset()
    fetchSpy.mockResolvedValueOnce(predictionResponse({ status: 'failed', error: 'nsfw block' }))
    await expect(replicateProvider.renderImage({ system: 'S', user: 'U' })).rejects.toThrow(/Replicate prediction failed/)
  })
})
