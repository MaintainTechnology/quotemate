import { describe, it, expect } from 'vitest'
import { chooseBrandSlug } from './brand'

const ALLOWED = ['f45', 'anytime-fitness']

describe('chooseBrandSlug', () => {
  it('returns the requested brand when it is an active brand', () => {
    expect(chooseBrandSlug('anytime-fitness', ALLOWED, 'f45')).toBe('anytime-fitness')
    expect(chooseBrandSlug('f45', ALLOWED, 'anytime-fitness')).toBe('f45')
  })

  it('is case-insensitive on the requested slug but returns canonical casing', () => {
    expect(chooseBrandSlug('ANYTIME-FITNESS', ALLOWED, 'f45')).toBe('anytime-fitness')
    expect(chooseBrandSlug('F45', ALLOWED, 'anytime-fitness')).toBe('f45')
  })

  it('falls back when the requested brand is unknown (no escaping the org brands)', () => {
    expect(chooseBrandSlug('gelatissimo', ALLOWED, 'f45')).toBe('f45')
    expect(chooseBrandSlug("'; drop table brands;--", ALLOWED, 'f45')).toBe('f45')
  })

  it('falls back when nothing is requested', () => {
    expect(chooseBrandSlug(null, ALLOWED, 'f45')).toBe('f45')
    expect(chooseBrandSlug(undefined, ALLOWED, 'anytime-fitness')).toBe('anytime-fitness')
    expect(chooseBrandSlug('   ', ALLOWED, 'f45')).toBe('f45')
  })
})
