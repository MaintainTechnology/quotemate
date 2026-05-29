import { describe, expect, it } from 'vitest'
import {
  buildStaticMapUrl,
  clampSize,
  clampZoom,
  redactKey,
} from './google-maps'

const KEY = 'AIza-test-key'

describe('buildStaticMapUrl', () => {
  it('builds a URL with sensible defaults from an address', () => {
    const url = buildStaticMapUrl(
      { address: '27 Smith Street, Penrith NSW 2750' },
      { apiKey: KEY },
    )
    expect(url).toContain('https://maps.googleapis.com/maps/api/staticmap')
    expect(url).toContain('size=640x480')
    expect(url).toContain('zoom=20')
    expect(url).toContain('maptype=satellite')
    expect(url).toContain('scale=2')
    expect(url).toContain(`key=${KEY}`)
    // URLSearchParams encodes spaces as '+'; just check the words made it through.
    expect(url).toMatch(/27[+%20]Smith[+%20]Street/)
  })

  it('prefers center coords over address when both are supplied', () => {
    const url = buildStaticMapUrl(
      {
        address: 'ignored',
        center: { lat: -33.85, lng: 151.21 },
      },
      { apiKey: KEY },
    )
    expect(url).toContain('center=-33.85%2C151.21')
    expect(url).not.toContain('center=ignored')
  })

  it('encodes markers correctly', () => {
    const url = buildStaticMapUrl(
      {
        center: { lat: -33.8688, lng: 151.2093 },
        markers: [
          { lat: -33.8688, lng: 151.2093, label: 'home', color: 'red' },
          { lat: -33.87, lng: 151.21 },
        ],
      },
      { apiKey: KEY },
    )
    expect(decodeURIComponent(url)).toContain('markers=color:red|label:H|-33.8688,151.2093')
    expect(decodeURIComponent(url)).toContain('markers=color:orange|-33.87,151.21')
  })

  it('throws when neither address nor center supplied', () => {
    expect(() => buildStaticMapUrl({}, { apiKey: KEY })).toThrow(/address or center/i)
  })

  it('throws when apiKey is empty', () => {
    expect(() =>
      buildStaticMapUrl({ address: '27 Smith St' }, { apiKey: '' }),
    ).toThrow(/apiKey/i)
  })

  it('uses a custom base URL when supplied', () => {
    const url = buildStaticMapUrl(
      { address: '27 Smith St' },
      { apiKey: KEY, baseUrl: 'https://example.test/staticmap' },
    )
    expect(url).toMatch(/^https:\/\/example\.test\/staticmap/)
  })
})

describe('clampSize', () => {
  it('caps at 640×640 (free-tier max)', () => {
    expect(clampSize({ width: 2000, height: 999 })).toEqual({ width: 640, height: 640 })
  })
  it('keeps in-range values', () => {
    expect(clampSize({ width: 320, height: 200 })).toEqual({ width: 320, height: 200 })
  })
  it('floors fractional inputs', () => {
    expect(clampSize({ width: 320.7, height: 200.2 })).toEqual({ width: 320, height: 200 })
  })
  it('enforces a minimum of 64 to avoid the unusable 1-pixel images', () => {
    expect(clampSize({ width: 8, height: 1 })).toEqual({ width: 64, height: 64 })
  })
})

describe('clampZoom', () => {
  it('clamps to 0..21', () => {
    expect(clampZoom(25)).toBe(21)
    expect(clampZoom(-1)).toBe(0)
  })
  it('keeps in-range values', () => {
    expect(clampZoom(20)).toBe(20)
  })
  it('falls back to 20 on NaN / Infinity', () => {
    expect(clampZoom(Number.NaN)).toBe(20)
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(20)
  })
})

describe('redactKey', () => {
  it('replaces the key in a built URL with ***', () => {
    const url = buildStaticMapUrl({ address: '27 Smith St' }, { apiKey: KEY })
    expect(redactKey(url)).not.toContain(KEY)
    expect(redactKey(url)).toContain('key=***')
  })
})
