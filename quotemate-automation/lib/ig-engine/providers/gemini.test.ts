// IG Engine — Gemini provider adapter tests. Mock the global fetch
// so we can inspect the exact payload the adapter sends, plus parse
// behaviour on the response. This is the contract Phase 1 promises:
// callers can swap from inline fetch to provider.renderImage() and the
// wire format stays byte-identical to the prior implementation.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { geminiProvider } from './gemini'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

const IMAGE_OK = {
  candidates: [
    {
      content: {
        parts: [
          {
            inline_data: { mime_type: 'image/png', data: 'AAA' },
          },
        ],
      },
    },
  ],
}

const TEXT_OK = {
  candidates: [
    {
      content: { parts: [{ text: 'YES — matches.' }] },
    },
  ],
}

describe('geminiProvider.renderImage', () => {
  const prevKey = process.env.GEMINI_API_KEY
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(IMAGE_OK))
  })
  afterEach(() => {
    fetchSpy.mockRestore()
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = prevKey
  })

  it('sends systemInstruction + user text + deterministic image config (temp 0 + top_p 0 + high thinking + 1K)', async () => {
    await geminiProvider.renderImage({
      system: 'SYS',
      user: 'USER',
    })
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.systemInstruction.parts[0].text).toBe('SYS')
    expect(body.contents[0].role).toBe('user')
    expect(body.contents[0].parts[0]).toEqual({ text: 'USER' })
    // Deterministic preview render: temperature + top_p pinned to 0,
    // thinkingLevel 'high' for adherence, resolution fixed at 1K. No
    // aspect_ratio here (none derived) → model auto-selects framing.
    expect(body.generation_config.temperature).toBe(0)
    expect(body.generation_config.top_p).toBe(0)
    expect(body.generation_config.response_modalities).toEqual(['IMAGE'])
    expect(body.generation_config.thinking_config).toEqual({ thinking_level: 'high' })
    expect(body.generation_config.image_config).toEqual({ image_size: '1K' })
  })

  it('attaches source image then labelled reference image, in order', async () => {
    await geminiProvider.renderImage({
      system: 'SYS',
      user: 'USER',
      sourceImage: { base64: 'SRC', mime: 'image/jpeg' },
      reference: {
        image: { base64: 'REF', mime: 'image/png' },
        label: 'PRODUCT REFERENCE — exact product',
      },
    })
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.contents[0].parts).toEqual([
      { text: 'USER' },
      { inline_data: { mime_type: 'image/jpeg', data: 'SRC' } },
      { text: 'PRODUCT REFERENCE — exact product' },
      { inline_data: { mime_type: 'image/png', data: 'REF' } },
    ])
  })

  it('appends extraStrict feedback to the user message', async () => {
    await geminiProvider.renderImage({
      system: 'SYS',
      user: 'USER',
      extraStrict: 'FIX THE COUNT',
    })
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.contents[0].parts[0].text).toBe('USER\n\nFIX THE COUNT')
  })

  it('omits aspect_ratio by default (auto framing) even when one is passed', async () => {
    // GEMINI_IMAGE_ASPECT defaults to 'auto' → the model self-selects
    // framing, so a caller-derived ratio is intentionally not forwarded.
    await geminiProvider.renderImage({
      system: 'SYS',
      user: 'USER',
      aspectRatio: '16:9',
    })
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.generation_config.image_config).toEqual({ image_size: '1K' })
  })

  it('returns the inline image bytes from the response', async () => {
    const out = await geminiProvider.renderImage({ system: 'SYS', user: 'USER' })
    expect(out).toEqual({ base64: 'AAA', mime: 'image/png' })
  })

  it('throws when GEMINI_API_KEY is missing', async () => {
    delete process.env.GEMINI_API_KEY
    await expect(
      geminiProvider.renderImage({ system: 'SYS', user: 'USER' }),
    ).rejects.toThrow(/GEMINI_API_KEY/)
  })

  it('throws with the status code on a non-200 response', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, false, 500))
    await expect(
      geminiProvider.renderImage({ system: 'SYS', user: 'USER' }),
    ).rejects.toThrow(/Gemini HTTP 500/)
  })

  it('throws when the response carries no image data', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: 'refused' }] } }],
      }),
    )
    await expect(
      geminiProvider.renderImage({ system: 'SYS', user: 'USER' }),
    ).rejects.toThrow(/no image data/)
  })
})

describe('geminiProvider.generateText', () => {
  const prevKey = process.env.GEMINI_API_KEY
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(TEXT_OK))
  })
  afterEach(() => {
    fetchSpy.mockRestore()
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = prevKey
  })

  it('sends prompt + image inputs with TEXT response modality', async () => {
    const out = await geminiProvider.generateText!({
      prompt: 'judge this',
      images: [{ base64: 'IMG', mime: 'image/png' }],
    })
    expect(out).toBe('YES — matches.')
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.contents[0].parts).toEqual([
      { text: 'judge this' },
      { inline_data: { mime_type: 'image/png', data: 'IMG' } },
    ])
    expect(body.generation_config.response_modalities).toEqual(['TEXT'])
    expect(body.generation_config.temperature).toBe(0)
  })

  it('returns empty string when the response has no text', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ candidates: [{ content: { parts: [] } }] }),
    )
    const out = await geminiProvider.generateText!({ prompt: 'x' })
    expect(out).toBe('')
  })

  it('forces application/json + response_schema when responseSchema is set', async () => {
    const schema = {
      type: 'OBJECT',
      properties: { ok: { type: 'BOOLEAN' } },
      required: ['ok'],
    }
    await geminiProvider.generateText!({ prompt: 'classify', responseSchema: schema })
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.generation_config.response_mime_type).toBe('application/json')
    expect(body.generation_config.response_schema).toEqual(schema)
    // JSON mode is text-only — response_modalities must not be sent.
    expect(body.generation_config.response_modalities).toBeUndefined()
  })
})

describe('per-call model override', () => {
  const prevKey = process.env.GEMINI_API_KEY
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(IMAGE_OK))
  })
  afterEach(() => {
    fetchSpy.mockRestore()
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = prevKey
  })

  it('renderImage uses req.model when provided', async () => {
    await geminiProvider.renderImage({
      system: 'SYS',
      user: 'USER',
      model: 'gemini-other-model',
    })
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('gemini-other-model:generateContent')
  })

  it('generateText uses req.model when provided', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(TEXT_OK))
    await geminiProvider.generateText!({
      prompt: 'judge',
      model: 'gemini-judge-model',
    })
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('gemini-judge-model:generateContent')
  })
})

describe('transient-failure retry', () => {
  const prevKey = process.env.GEMINI_API_KEY
  const prevBase = process.env.GEMINI_RETRY_BASE_MS
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
    // Zero backoff so the retry loop runs instantly in tests (no Retry-After
    // header on the mock → delay stays 0).
    process.env.GEMINI_RETRY_BASE_MS = '0'
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })
  afterEach(() => {
    fetchSpy.mockRestore()
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = prevKey
    if (prevBase === undefined) delete process.env.GEMINI_RETRY_BASE_MS
    else process.env.GEMINI_RETRY_BASE_MS = prevBase
  })

  it('retries a 429 then succeeds on the next attempt', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ error: { status: 'RESOURCE_EXHAUSTED' } }, false, 429))
      .mockResolvedValueOnce(jsonResponse(IMAGE_OK))
    const out = await geminiProvider.renderImage({ system: 'SYS', user: 'USER' })
    expect(out).toEqual({ base64: 'AAA', mime: 'image/png' })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('retries a 503 (overloaded) on generateText then succeeds', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({}, false, 503))
      .mockResolvedValueOnce(jsonResponse(TEXT_OK))
    const out = await geminiProvider.generateText!({ prompt: 'classify' })
    expect(out).toBe('YES — matches.')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('gives up after exhausting retries on a persistent 429, including the body', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: 'quota exceeded' }, false, 429))
    await expect(
      geminiProvider.renderImage({ system: 'SYS', user: 'USER' }),
    ).rejects.toThrow(/Gemini HTTP 429.*quota exceeded/)
    expect(fetchSpy).toHaveBeenCalledTimes(3) // default GEMINI_RETRY_ATTEMPTS
  })

  it('does NOT retry a non-transient 400 — fails on the first attempt', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: 'bad request' }, false, 400))
    await expect(
      geminiProvider.renderImage({ system: 'SYS', user: 'USER' }),
    ).rejects.toThrow(/Gemini HTTP 400/)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('geminiProvider.capabilities', () => {
  it('advertises edit, text-to-image and vision', () => {
    expect(geminiProvider.name).toBe('gemini')
    expect(geminiProvider.capabilities).toEqual({
      edit: true,
      textToImage: true,
      vision: true,
    })
  })
})
