import { describe, expect, it } from 'vitest'
import {
  buildStreetViewMetadataUrl,
  buildStreetViewUrl,
  clampSize,
  parseStreetViewMetadata,
  redactKey,
} from './streetview'

describe('buildStreetViewUrl', () => {
  it('builds an image URL from an address with sensible defaults', () => {
    const url = buildStreetViewUrl(
      { location: '28 Greens Rd, Coorparoo, 4151, QLD' },
      { apiKey: 'K' },
    )
    expect(url).toContain('/streetview?')
    expect(url).toContain('location=28+Greens+Rd%2C+Coorparoo%2C+4151%2C+QLD')
    expect(url).toContain('size=640x480')
    expect(url).toContain('fov=85')
    expect(url).toContain('return_error_code=true')
    expect(url).toContain('key=K')
  })

  it('accepts an explicit lat/lng location', () => {
    const url = buildStreetViewUrl({ location: { lat: -27.5, lng: 153.06 } }, { apiKey: 'K' })
    expect(url).toContain('location=-27.5%2C153.06')
  })

  it('clamps size to the 640 free-tier max', () => {
    const url = buildStreetViewUrl(
      { location: 'x', size: { width: 2000, height: 2000 } },
      { apiKey: 'K' },
    )
    expect(url).toContain('size=640x640')
  })

  it('throws without an API key', () => {
    expect(() => buildStreetViewUrl({ location: 'x' }, { apiKey: '' })).toThrow()
  })
})

describe('buildStreetViewMetadataUrl', () => {
  it('targets the metadata endpoint', () => {
    const url = buildStreetViewMetadataUrl({ location: 'x' }, { apiKey: 'K' })
    expect(url).toContain('/streetview/metadata?')
    expect(url).toContain('location=x')
  })
})

describe('parseStreetViewMetadata', () => {
  it('accepts an OK pano', () => {
    const r = parseStreetViewMetadata({ status: 'OK', date: '2022-06', pano_id: 'abc' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.date).toBe('2022-06')
      expect(r.panoId).toBe('abc')
    }
  })

  it('rejects ZERO_RESULTS', () => {
    const r = parseStreetViewMetadata({ status: 'ZERO_RESULTS' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe('ZERO_RESULTS')
  })
})

describe('clampSize', () => {
  it('floors at 64 and caps at 640', () => {
    expect(clampSize({ width: 10, height: 9999 })).toEqual({ width: 64, height: 640 })
  })
})

describe('redactKey', () => {
  it('masks the key', () => {
    expect(redactKey('https://x?location=a&key=SECRET')).toContain('key=***')
    expect(redactKey('https://x?key=SECRET')).not.toContain('SECRET')
  })
})
