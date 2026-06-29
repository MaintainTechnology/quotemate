// IG Engine — Stability SD 3.5 Large (NVIDIA NIM) provider adapter tests.
// Mock the global fetch to inspect the exact payload sent and the parse
// behaviour on the response. This is the wire contract the el/plumbing
// preview + samples paths rely on when STABILITY_NIM_URL is configured.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  stabilityProvider,
  buildStabilityPrompt,
  detectMimeFromBase64,
  extractImage,
} from './stability'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

// A real-ish JPEG base64 head ("/9j/") so mime detection has something
// to read; the rest is arbitrary.
const JPEG_OK = { artifacts: [{ base64: '/9j/AAAA', finishReason: 'SUCCESS', seed: 42 }] }

describe('stabilityProvider.renderImage', () => {
  const prevUrl = process.env.STABILITY_NIM_URL
  const prevKey = process.env.STABILITY_API_KEY
  const prevNvidia = process.env.NVIDIA_API_KEY
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    process.env.STABILITY_NIM_URL = 'http://nim.test/v1/infer'
    delete process.env.STABILITY_API_KEY
    delete process.env.NVIDIA_API_KEY
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(JPEG_OK))
  })
  afterEach(() => {
    fetchSpy.mockRestore()
    process.env.STABILITY_NIM_URL = prevUrl
    if (prevKey === undefined) delete process.env.STABILITY_API_KEY
    else process.env.STABILITY_API_KEY = prevKey
    if (prevNvidia === undefined) delete process.env.NVIDIA_API_KEY
    else process.env.NVIDIA_API_KEY = prevNvidia
    delete process.env.STABILITY_IMAGE_STEPS
    delete process.env.STABILITY_IMAGE_CFG_SCALE
    delete process.env.STABILITY_IMAGE_MODE
  })

  it('POSTs the configured NIM URL with the text-to-image body', async () => {
    await stabilityProvider.renderImage({ system: 'SYS', user: 'USER' })
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://nim.test/v1/infer')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    // system + user folded into one prompt.
    expect(body.prompt).toBe('SYS\n\nUSER')
    expect(body.mode).toBe('base')
    expect(body.cfg_scale).toBe(5)
    expect(body.steps).toBe(50)
    expect(body.seed).toBe(0)
    expect(body.negative_prompt).toBe('')
  })

  it('does NOT send sourceImage or reference (text-to-image only)', async () => {
    await stabilityProvider.renderImage({
      system: 'SYS',
      user: 'USER',
      sourceImage: { base64: 'SRC', mime: 'image/jpeg' },
      reference: { image: { base64: 'REF', mime: 'image/png' }, label: 'PRODUCT' },
    })
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const raw = init.body as string
    expect(raw).not.toContain('SRC')
    expect(raw).not.toContain('REF')
    const body = JSON.parse(raw)
    expect(body.image).toBeUndefined()
    expect(body.prompt).toBe('SYS\n\nUSER')
  })

  it('appends extraStrict feedback to the prompt', async () => {
    await stabilityProvider.renderImage({ system: 'SYS', user: 'USER', extraStrict: 'FIX COUNT' })
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.prompt).toBe('SYS\n\nUSER\n\nFIX COUNT')
  })

  it('forwards aspect_ratio only when provided', async () => {
    await stabilityProvider.renderImage({ system: 'S', user: 'U', aspectRatio: '16:9' })
    let body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.aspect_ratio).toBe('16:9')

    fetchSpy.mockClear()
    await stabilityProvider.renderImage({ system: 'S', user: 'U' })
    body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.aspect_ratio).toBeUndefined()
  })

  it('honours STABILITY_IMAGE_* tuning env vars', async () => {
    process.env.STABILITY_IMAGE_STEPS = '30'
    process.env.STABILITY_IMAGE_CFG_SCALE = '7'
    process.env.STABILITY_IMAGE_MODE = 'base+canny'
    await stabilityProvider.renderImage({ system: 'S', user: 'U' })
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.steps).toBe(30)
    expect(body.cfg_scale).toBe(7)
    expect(body.mode).toBe('base+canny')
  })

  it('sends Authorization bearer only when a key is set', async () => {
    await stabilityProvider.renderImage({ system: 'S', user: 'U' })
    let headers = (fetchSpy.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()

    fetchSpy.mockClear()
    process.env.STABILITY_API_KEY = 'nvapi-xyz'
    await stabilityProvider.renderImage({ system: 'S', user: 'U' })
    headers = (fetchSpy.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer nvapi-xyz')
  })

  it('returns the artifact image bytes with detected mime', async () => {
    const out = await stabilityProvider.renderImage({ system: 'S', user: 'U' })
    expect(out).toEqual({ base64: '/9j/AAAA', mime: 'image/jpeg' })
  })

  it('throws with the status code on a non-200 response', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ detail: 'boom' }, false, 422))
    await expect(
      stabilityProvider.renderImage({ system: 'S', user: 'U' }),
    ).rejects.toThrow(/Stability HTTP 422/)
  })

  it('throws when the response carries no image data', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ artifacts: [{ finishReason: 'CONTENT_FILTERED' }] }),
    )
    await expect(
      stabilityProvider.renderImage({ system: 'S', user: 'U' }),
    ).rejects.toThrow(/no image data — CONTENT_FILTERED/)
  })
})

describe('stabilityProvider.capabilities', () => {
  it('is a text-to-image-only provider (no edit, no vision)', () => {
    expect(stabilityProvider.name).toBe('stability')
    expect(stabilityProvider.capabilities).toEqual({
      edit: false,
      textToImage: true,
      vision: false,
    })
    expect(stabilityProvider.generateText).toBeUndefined()
  })
})

describe('pure helpers', () => {
  it('buildStabilityPrompt folds system + user + extraStrict, dropping blanks', () => {
    expect(buildStabilityPrompt({ system: 'SYS', user: 'USER' })).toBe('SYS\n\nUSER')
    expect(buildStabilityPrompt({ system: '', user: 'USER' })).toBe('USER')
    expect(buildStabilityPrompt({ system: 'SYS', user: 'USER', extraStrict: 'X' })).toBe(
      'SYS\n\nUSER\n\nX',
    )
  })

  it('detectMimeFromBase64 reads magic bytes, defaults to jpeg', () => {
    expect(detectMimeFromBase64('/9j/4AAQ')).toBe('image/jpeg')
    expect(detectMimeFromBase64('iVBORw0KGgoAAAA')).toBe('image/png')
    expect(detectMimeFromBase64('UklGRiQAAAB')).toBe('image/webp')
    expect(detectMimeFromBase64('zzzz')).toBe('image/jpeg')
  })

  it('extractImage prefers artifacts[].base64 and falls back to image', () => {
    expect(extractImage({ artifacts: [{ base64: '/9j/AA' }] })).toEqual({
      base64: '/9j/AA',
      mime: 'image/jpeg',
    })
    expect(extractImage({ image: 'iVBORw0KGgoAA' })).toEqual({
      base64: 'iVBORw0KGgoAA',
      mime: 'image/png',
    })
  })

  it('extractImage throws with the finish reason when no image present', () => {
    expect(() => extractImage({ artifacts: [{ finishReason: 'ERROR' }] })).toThrow(/ERROR/)
    expect(() => extractImage({ finish_reason: 'Filter reason: prompt' })).toThrow(
      /Filter reason: prompt/,
    )
  })
})
