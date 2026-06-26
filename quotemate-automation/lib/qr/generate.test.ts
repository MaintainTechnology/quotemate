import { describe, expect, it } from 'vitest'
import { generateQrDataUrl } from '@/lib/qr/generate'

describe('lib/qr/generate', () => {
  it('renders an absolute URL to a PNG data URI', async () => {
    const uri = await generateQrDataUrl('https://quote-mate-rho.vercel.app/start/abc')
    expect(uri.startsWith('data:image/png;base64,')).toBe(true)
    expect(uri.length).toBeGreaterThan(100)
  })

  it('respects a custom width', async () => {
    const small = await generateQrDataUrl('https://example.com/start/x', { width: 120 })
    expect(small.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('rejects non-URL data so we never embed a broken/relative target', async () => {
    await expect(generateQrDataUrl('')).rejects.toThrow(/absolute http/)
    await expect(generateQrDataUrl('/start/abc')).rejects.toThrow(/absolute http/)
    await expect(generateQrDataUrl('ftp://example.com')).rejects.toThrow(/absolute http/)
  })
})
