// Spec quote-pdf-logo-fix R9 + DoD — prepareImage/prepareLogo must return null
// AND log a warning (not fail silently) when the logo fetch fails, so a missing
// logo is traceable. Covers: fetch rejects (unreachable/timeout) and a non-OK
// HTTP response (404 / not public). The no-URL path must stay silent.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { prepareImage, prepareLogo } from './image'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('prepareImage — silent-failure observability', () => {
  it('returns null and warns when the fetch rejects (unreachable URL)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const out = await prepareImage('https://unreachable.invalid/logo.png')

    expect(out).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toMatchObject({ url: 'https://unreachable.invalid/logo.png' })
  })

  it('returns null and warns on a non-OK response (404 / not public)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    )

    const out = await prepareLogo('https://cdn.example.com/missing.png')

    expect(out).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toMatchObject({
      url: 'https://cdn.example.com/missing.png',
      reason: 'HTTP 404',
    })
  })

  it('returns null without warning when no URL is given', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await prepareImage(null)).toBeNull()
    expect(await prepareImage(undefined)).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })
})

// The tradie photo (mig 180) goes through the JPEG branch, and the upload
// allowlist accepts PNG/WEBP/SVG — so an alpha-bearing headshot reaches it.
// libvips flattens alpha onto BLACK unconditionally on JPEG encode, which would
// print a solid black tile in the PDF's "Your tradie" block while the web page
// shows the cut-out correctly. Flatten onto WHITE instead: matches the PDF's
// warm-paper stock and the .tradie-photo white backing.
describe('prepareImage — alpha handling on the JPEG branch', () => {
  /** Indirect specifier, same trick the source uses, so TS doesn't hard-require sharp. */
  async function loadSharp() {
    const spec: string = 'sharp'
    return (await import(spec)).default
  }

  /** A fully transparent square whose RGB under the alpha is black. */
  async function transparentPng(): Promise<Buffer> {
    const sharp = await loadSharp()
    return sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer()
  }

  function stubFetchWith(buf: Buffer) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      }),
    )
  }

  it('flattens transparency onto white, not black, when encoding JPEG', async () => {
    stubFetchWith(await transparentPng())
    const out = await prepareImage('https://cdn.example.com/cutout.png', { maxEdge: 320 })

    expect(out).toMatch(/^data:image\/jpeg;base64,/)
    const sharp = await loadSharp()
    const bytes = Buffer.from(out!.split(',')[1], 'base64')
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true })
    expect(info.channels).toBe(3) // JPEG has no alpha
    // Top-left pixel must be white-ish, never the black libvips defaults to.
    const [r, g, b] = [data[0], data[1], data[2]]
    expect(r).toBeGreaterThan(240)
    expect(g).toBeGreaterThan(240)
    expect(b).toBeGreaterThan(240)
  })

  it('still keeps transparency on the PNG branch (the logo path is unchanged)', async () => {
    stubFetchWith(await transparentPng())
    const out = await prepareLogo('https://cdn.example.com/logo.png')

    expect(out).toMatch(/^data:image\/png;base64,/)
    const sharp = await loadSharp()
    const bytes = Buffer.from(out!.split(',')[1], 'base64')
    const meta = await sharp(bytes).metadata()
    expect(meta.hasAlpha).toBe(true)
  })
})
