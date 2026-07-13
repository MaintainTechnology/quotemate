import { describe, it, expect, vi } from 'vitest'
import { roofingVisionParsed, resolveVisionChain, type VisionImage } from './vision-provider'

describe('resolveVisionChain (ROOFING_VISION_PROVIDER → ordered provider chain)', () => {
  it('default / huggingface: HF first, then Cloudflare, then Claude', () => {
    expect(resolveVisionChain({ hasHf: true, hasCloudflare: true, hasClaude: true })).toEqual(['hf', 'cloudflare', 'claude'])
    expect(resolveVisionChain({ override: 'huggingface', hasHf: true, hasCloudflare: true, hasClaude: true })).toEqual(['hf', 'cloudflare', 'claude'])
  })
  it("'cloudflare'/'cf'/'workers-ai': Cloudflare first, then HF, then Claude", () => {
    for (const override of ['cloudflare', 'cf', 'workers-ai']) {
      expect(resolveVisionChain({ override, hasHf: true, hasCloudflare: true, hasClaude: true })).toEqual(['cloudflare', 'hf', 'claude'])
    }
  })
  it("'claude'/'anthropic': Claude only", () => {
    expect(resolveVisionChain({ override: 'claude', hasHf: true, hasCloudflare: true, hasClaude: true })).toEqual(['claude'])
    expect(resolveVisionChain({ override: 'anthropic', hasHf: true, hasCloudflare: true, hasClaude: true })).toEqual(['claude'])
  })
  it('drops providers that are not configured, preserving order', () => {
    expect(resolveVisionChain({ override: 'cloudflare', hasHf: false, hasCloudflare: true, hasClaude: true })).toEqual(['cloudflare', 'claude'])
    expect(resolveVisionChain({ hasHf: true, hasCloudflare: false, hasClaude: true })).toEqual(['hf', 'claude'])
    expect(resolveVisionChain({ override: 'claude', hasHf: true, hasCloudflare: true, hasClaude: false })).toEqual([])
    expect(resolveVisionChain({ hasHf: false, hasCloudflare: false, hasClaude: false })).toEqual([])
  })
})

const img: VisionImage = { base64: 'AAAA', mime: 'image/jpeg' }
// A parser that returns a number, or null for the sentinel 'BAD'.
const parseNum = (t: string): number | null => (t === 'BAD' ? null : Number(t))

describe('roofingVisionParsed (HF primary → Claude fallback)', () => {
  const base = {
    prompt: 'p',
    images: [img],
    parse: parseNum,
  }

  it('uses the HF primary when it returns a usable parse', async () => {
    const claude = vi.fn(async () => '99')
    const r = await roofingVisionParsed({
      ...base,
      deps: { hf: async () => '42', claude, hfReady: true, claudeReady: true },
    })
    expect(r).toEqual({ value: 42, source: 'hf' })
    expect(claude).not.toHaveBeenCalled()
  })

  it('uses the Cloudflare primary when it is the selected/configured open provider', async () => {
    const claude = vi.fn(async () => '99')
    const hf = vi.fn(async () => '1')
    const r = await roofingVisionParsed({
      ...base,
      deps: { hf, cf: async () => '42', claude, hfReady: false, cloudflareReady: true, claudeReady: true },
    })
    expect(r).toEqual({ value: 42, source: 'cloudflare' })
    expect(hf).not.toHaveBeenCalled()
    expect(claude).not.toHaveBeenCalled()
  })

  it('falls back to Claude when the Cloudflare primary is not usable', async () => {
    const r = await roofingVisionParsed({
      ...base,
      isUsable: (n) => n > 10, // Cloudflare's 3 parses but is "not usable"
      deps: { cf: async () => '3', claude: async () => '50', hfReady: false, cloudflareReady: true, claudeReady: true },
    })
    expect(r).toEqual({ value: 50, source: 'claude' })
  })

  it('ROOFING_VISION_PROVIDER=cloudflare: Cloudflare → HF → Claude (HF catches a Cloudflare failure)', async () => {
    const prev = process.env.ROOFING_VISION_PROVIDER
    process.env.ROOFING_VISION_PROVIDER = 'cloudflare'
    try {
      const claude = vi.fn(async () => '99')
      const r = await roofingVisionParsed({
        ...base,
        deps: {
          cf: async () => {
            throw new Error('CF 500')
          },
          hf: async () => '42',
          claude,
          hfReady: true,
          cloudflareReady: true,
          claudeReady: true,
        },
      })
      expect(r).toEqual({ value: 42, source: 'hf' }) // HF is the middle fallback
      expect(claude).not.toHaveBeenCalled()
    } finally {
      process.env.ROOFING_VISION_PROVIDER = prev
    }
  })

  it('falls back to Claude when HF is not usable (isUsable fails)', async () => {
    const r = await roofingVisionParsed({
      ...base,
      isUsable: (n) => n > 10, // HF's 3 is parseable but "not usable"
      deps: { hf: async () => '3', claude: async () => '50', hfReady: true, claudeReady: true },
    })
    expect(r).toEqual({ value: 50, source: 'claude' })
  })

  it('falls back to Claude when HF throws (429 / down)', async () => {
    const onFallback = vi.fn()
    const r = await roofingVisionParsed({
      ...base,
      deps: {
        hf: async () => {
          throw new Error('HF 429')
        },
        claude: async () => '7',
        hfReady: true,
        claudeReady: true,
        onFallback,
      },
    })
    expect(r).toEqual({ value: 7, source: 'claude' })
    expect(onFallback).toHaveBeenCalledWith(expect.stringMatching(/429/))
  })

  it('falls back to Claude when HF returns unparseable text', async () => {
    const r = await roofingVisionParsed({
      ...base,
      deps: { hf: async () => 'BAD', claude: async () => '5', hfReady: true, claudeReady: true },
    })
    expect(r).toEqual({ value: 5, source: 'claude' })
  })

  it('the Claude fallback accepts any parseable answer (no isUsable gate on the backstop)', async () => {
    const r = await roofingVisionParsed({
      ...base,
      isUsable: (n) => n > 100, // Claude's 5 fails this, but it is the last resort
      deps: { hf: async () => 'BAD', claude: async () => '5', hfReady: true, claudeReady: true },
    })
    expect(r).toEqual({ value: 5, source: 'claude' })
  })

  it('skips HF entirely when it is not configured', async () => {
    const hf = vi.fn(async () => '1')
    const r = await roofingVisionParsed({
      ...base,
      deps: { hf, claude: async () => '9', hfReady: false, claudeReady: true },
    })
    expect(r).toEqual({ value: 9, source: 'claude' })
    expect(hf).not.toHaveBeenCalled()
  })

  it('returns null when both providers fail / are unavailable', async () => {
    expect(
      await roofingVisionParsed({
        ...base,
        deps: {
          hf: async () => {
            throw new Error('x')
          },
          claude: async () => {
            throw new Error('y')
          },
          hfReady: true,
          claudeReady: true,
        },
      }),
    ).toBeNull()
    expect(
      await roofingVisionParsed({ ...base, deps: { hfReady: false, claudeReady: false } }),
    ).toBeNull()
  })
})
