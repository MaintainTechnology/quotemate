import { describe, it, expect } from 'vitest'
import { validateFlyerImage, extForMime, FLYER_IMAGE_MAX_BYTES } from './upload'

describe('validateFlyerImage', () => {
  it('accepts png/jpeg/webp under the size cap', () => {
    expect(validateFlyerImage({ mime: 'image/png', size: 1000 })).toEqual({ ok: true, ext: 'png' })
    expect(validateFlyerImage({ mime: 'image/jpeg', size: 1000 })).toEqual({ ok: true, ext: 'jpg' })
    expect(validateFlyerImage({ mime: 'image/webp', size: 1000 })).toEqual({ ok: true, ext: 'webp' })
  })

  it('rejects unsupported types (incl. svg) (E4)', () => {
    const r = validateFlyerImage({ mime: 'image/svg+xml', size: 1000 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('bad_type')
    expect(validateFlyerImage({ mime: 'application/pdf', size: 1000 }).ok).toBe(false)
  })

  it('rejects empty and oversized files (E4)', () => {
    expect(validateFlyerImage({ mime: 'image/png', size: 0 }).ok).toBe(false)
    const tooBig = validateFlyerImage({ mime: 'image/png', size: FLYER_IMAGE_MAX_BYTES + 1 })
    expect(tooBig.ok).toBe(false)
    if (!tooBig.ok) expect(tooBig.error).toBe('too_large')
  })

  it('extForMime maps known types only', () => {
    expect(extForMime('image/png')).toBe('png')
    expect(extForMime('image/gif')).toBeNull()
  })
})
