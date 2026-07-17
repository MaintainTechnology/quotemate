import { describe, it, expect } from 'vitest'
import { businessInitials } from './monogram'

describe('businessInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(businessInitials('Bobs Plumbing')).toBe('BP')
  })

  it('strips apostrophes rather than splitting on them', () => {
    // The regression this guards: splitting would read "Bob" + "s" → BS.
    expect(businessInitials("Bob's Plumbing")).toBe('BP')
    expect(businessInitials('Bob’s Plumbing')).toBe('BP')
  })

  it('drops legal suffixes and articles', () => {
    expect(businessInitials('Bobs Plumbing Pty Ltd')).toBe('BP')
    expect(businessInitials('The Roof Doctor')).toBe('RD')
  })

  it('uses the first two letters of a single-word name', () => {
    expect(businessInitials('Sparky')).toBe('SP')
  })

  it('keeps digits', () => {
    expect(businessInitials('4 Season Roofing')).toBe('4S')
    expect(businessInitials('A1 Electrical')).toBe('AE')
  })

  it('falls back to the raw words when every word is noise', () => {
    expect(businessInitials('The Group')).toBe('TG')
  })

  it('returns empty string when there are no letters or digits', () => {
    expect(businessInitials('')).toBe('')
    expect(businessInitials(null)).toBe('')
    expect(businessInitials(undefined)).toBe('')
    expect(businessInitials('   ---   ')).toBe('')
  })
})
