import { describe, it, expect } from 'vitest'
import { proxyTilesUrl, sessionUsable, isValidTileCoord } from './google-tiles'

describe('proxyTilesUrl', () => {
  it('points at our proxy, keeps {z}/{x}/{y} literal, session in the query', () => {
    const url = proxyTilesUrl('SESS123')
    expect(url).toContain('/api/roofing/map-tiles/{z}/{x}/{y}?')
    expect(url).toContain('session=SESS123')
    // MapLibre needs the placeholders unencoded.
    expect(url).not.toContain('%7Bz%7D')
    // The server key is NEVER in the browser tile URL.
    expect(url).not.toContain('key=')
  })

  it('url-encodes the session value', () => {
    expect(proxyTilesUrl('a b/c')).toContain('session=a%20b%2Fc')
  })
})

describe('isValidTileCoord', () => {
  it('accepts real multi-digit tile coords (the z19 x=485204 bug)', () => {
    expect(isValidTileCoord('19', '485204', '303830')).toBe(true)
    expect(isValidTileCoord('0', '0', '0')).toBe(true)
    expect(isValidTileCoord('22', '2097151', '2097151')).toBe(true) // max-zoom range
  })
  it('rejects non-numeric / over-long / empty segments', () => {
    expect(isValidTileCoord('19', '48520x', '303830')).toBe(false)
    expect(isValidTileCoord('190', '1', '1')).toBe(false) // z too many digits
    expect(isValidTileCoord('19', '12345678', '1')).toBe(false) // x 8 digits
    expect(isValidTileCoord('19', '', '1')).toBe(false)
    expect(isValidTileCoord('19', '../etc', '1')).toBe(false)
  })
})

describe('sessionUsable', () => {
  const now = 1_000_000
  it('accepts a session comfortably before expiry', () => {
    expect(sessionUsable({ session: 's', expiry: now + 3600 }, now)).toBe(true)
  })
  it('rejects a session within the 5-min safety margin', () => {
    expect(sessionUsable({ session: 's', expiry: now + 60 }, now)).toBe(false)
  })
  it('rejects an expired, empty, or missing session', () => {
    expect(sessionUsable({ session: 's', expiry: now - 1 }, now)).toBe(false)
    expect(sessionUsable({ session: '', expiry: now + 3600 }, now)).toBe(false)
    expect(sessionUsable(null, now)).toBe(false)
  })
})
