import { describe, expect, it } from 'vitest'
import { validateReportStyle, ALLOWED_ACCENTS } from './style'

describe('validateReportStyle', () => {
  it('accepts a fully valid style', () => {
    const s = { fontFamily: 'serif', accentColor: ALLOWED_ACCENTS[0], headingStyle: 'bar' }
    expect(validateReportStyle(s)).toEqual(s)
  })

  it('returns null for a non-object', () => {
    expect(validateReportStyle(null)).toBeNull()
    expect(validateReportStyle('nope')).toBeNull()
  })

  it('strips unknown keys rather than failing', () => {
    expect(validateReportStyle({ fontFamily: 'mono', evil: '<script>' })).toEqual({
      fontFamily: 'mono',
    })
  })

  it('rejects an off-list font family (whole style invalid → null)', () => {
    expect(validateReportStyle({ fontFamily: 'Comic Sans' })).toBeNull()
  })

  it('rejects an accent colour outside the palette allow-list', () => {
    expect(validateReportStyle({ accentColor: '#123456' })).toBeNull()
  })

  it('rejects a non-hex accent colour', () => {
    expect(validateReportStyle({ accentColor: 'red' })).toBeNull()
  })

  it('rejects a logoPath outside a tenant storage prefix', () => {
    expect(validateReportStyle({ logoPath: 'http://evil/x.png' })).toBeNull()
    expect(validateReportStyle({ logoPath: '../secrets' })).toBeNull()
  })

  it('accepts a logoPath inside the tenant branding prefix', () => {
    expect(validateReportStyle({ logoPath: 'branding/tenant-abc/logo.png' })).toEqual({
      logoPath: 'branding/tenant-abc/logo.png',
    })
  })

  it('returns an empty object for {} (valid, no overrides)', () => {
    expect(validateReportStyle({})).toEqual({})
  })
})
