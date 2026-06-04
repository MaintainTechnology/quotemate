import { describe, expect, it } from 'vitest'
import {
  buildStreetViewMetadataUrl,
  buildStreetViewUrl,
  clampFov,
  clampHeading,
  clampPitch,
  clampSize,
  parseMetadataStatus,
  redactKey,
} from './street-view'

const KEY = { apiKey: 'test-key' }

describe('buildStreetViewUrl', () => {
  it('builds an image URL from an address with sane defaults', () => {
    const url = buildStreetViewUrl({ address: '27 Smith St, Penrith NSW 2750' }, KEY)
    expect(url).toContain('/streetview?')
    expect(url).toContain('location=27+Smith+St%2C+Penrith+NSW+2750')
    expect(url).toContain('size=640x400')
    expect(url).toContain('fov=80')
    expect(url).toContain('pitch=8')
    expect(url).toContain('source=outdoor')
    expect(url).toContain('key=test-key')
    // no heading by default → Google points the camera at the location
    expect(url).not.toContain('heading=')
  })

  it('prefers explicit location over address and includes heading when given', () => {
    const url = buildStreetViewUrl(
      { address: 'ignored', location: { lat: -33.87, lng: 151.21 }, heading: 200 },
      KEY,
    )
    expect(url).toContain('location=-33.87%2C151.21')
    expect(url).toContain('heading=200')
  })

  it('clamps oversized images to the free-tier max', () => {
    const url = buildStreetViewUrl({ address: 'x', size: { width: 5000, height: 5000 } }, KEY)
    expect(url).toContain('size=640x640')
  })

  it('throws without address or location, and without a key', () => {
    expect(() => buildStreetViewUrl({}, KEY)).toThrow()
    expect(() => buildStreetViewUrl({ address: 'x' }, { apiKey: '' })).toThrow()
  })
})

describe('buildStreetViewMetadataUrl', () => {
  it('targets the metadata endpoint and carries location + key', () => {
    const url = buildStreetViewMetadataUrl({ location: { lat: -33.87, lng: 151.21 } }, KEY)
    expect(url).toContain('/streetview/metadata?')
    expect(url).toContain('location=-33.87%2C151.21')
    expect(url).toContain('key=test-key')
    // metadata never needs size/fov/pitch
    expect(url).not.toContain('size=')
  })
})

describe('clamps', () => {
  it('clampSize bounds 64..640', () => {
    expect(clampSize({ width: 10, height: 9000 })).toEqual({ width: 64, height: 640 })
  })
  it('clampFov bounds 10..120', () => {
    expect(clampFov(5)).toBe(10)
    expect(clampFov(200)).toBe(120)
    expect(clampFov(NaN)).toBe(80)
  })
  it('clampPitch bounds -90..90', () => {
    expect(clampPitch(-200)).toBe(-90)
    expect(clampPitch(200)).toBe(90)
  })
  it('clampHeading normalises to 0..359', () => {
    expect(clampHeading(370)).toBe(10)
    expect(clampHeading(-90)).toBe(270)
  })
})

describe('parseMetadataStatus / redactKey', () => {
  it('reads the status field', () => {
    expect(parseMetadataStatus({ status: 'OK' })).toBe('OK')
    expect(parseMetadataStatus({ status: 'ZERO_RESULTS' })).toBe('ZERO_RESULTS')
    expect(parseMetadataStatus(null)).toBe('UNKNOWN_ERROR')
    expect(parseMetadataStatus({})).toBe('UNKNOWN_ERROR')
  })
  it('redacts the key', () => {
    expect(redactKey('https://x/streetview?location=a&key=secret123')).toContain('key=***')
    expect(redactKey('https://x/streetview?location=a&key=secret123')).not.toContain('secret123')
  })
})
