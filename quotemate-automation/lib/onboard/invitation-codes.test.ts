import { describe, it, expect } from 'vitest'
import {
  generateInvitationCode,
  slugifyCampaign,
  isPlatformAdmin,
  normalizeCustomCode,
  RANDOM_ALPHABET,
} from './invitation-codes'

describe('slugifyCampaign', () => {
  it('upper-cases and strips non-alphanumerics to single dashes', () => {
    expect(slugifyCampaign('June Flyers!')).toBe('JUNE-FLYERS')
    expect(slugifyCampaign('  fb__promo  ')).toBe('FB-PROMO')
  })
  it('caps length at 24 chars', () => {
    expect(slugifyCampaign('a'.repeat(40)).length).toBeLessThanOrEqual(24)
  })
})

describe('generateInvitationCode', () => {
  it('joins prefix, campaign slug, and a 4-char suffix with dashes', () => {
    const code = generateInvitationCode('JON', 'june_flyers')
    expect(code).toMatch(/^JON-JUNE-FLYERS-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/)
  })
  it('only uses unambiguous suffix characters', () => {
    for (let i = 0; i < 50; i++) {
      const suffix = generateInvitationCode('QM', 'x').split('-').pop()!
      for (const ch of suffix) expect(RANDOM_ALPHABET).toContain(ch)
    }
  })
})

describe('normalizeCustomCode', () => {
  it('upper-cases and keeps a clean alphanumeric code', () => {
    expect(normalizeCustomCode('mate2026')).toBe('MATE2026')
    expect(normalizeCustomCode('  June-Special  ')).toBe('JUNE-SPECIAL')
  })
  it('collapses runs of non-alphanumerics to a single dash and trims edge dashes', () => {
    expect(normalizeCustomCode('june__flyers!!')).toBe('JUNE-FLYERS')
    expect(normalizeCustomCode('--mate--2026--')).toBe('MATE-2026')
    expect(normalizeCustomCode('a b   c')).toBe('A-B-C')
  })
  it('rejects codes that are too short or empty after stripping', () => {
    expect(normalizeCustomCode('')).toBeNull()
    expect(normalizeCustomCode('!!')).toBeNull()
    expect(normalizeCustomCode('ab')).toBeNull()
  })
  it('rejects codes longer than 40 chars', () => {
    expect(normalizeCustomCode('A'.repeat(41))).toBeNull()
    expect(normalizeCustomCode('A'.repeat(40))).toBe('A'.repeat(40))
  })
  it('produces a value that check/consume treat the same as a generated code', () => {
    // generated codes are UPPER, alphanumerics + single dashes — a normalised
    // custom code must satisfy the same shape so lookups behave identically.
    const code = normalizeCustomCode('Mate 2026')!
    expect(code).toMatch(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/)
  })
})

describe('isPlatformAdmin', () => {
  it('matches a uuid present in the comma-separated allowlist', () => {
    expect(isPlatformAdmin('u1', 'u1, u2 ,u3')).toBe(true)
    expect(isPlatformAdmin('u9', 'u1,u2')).toBe(false)
    expect(isPlatformAdmin('u1', undefined)).toBe(false)
    expect(isPlatformAdmin('u1', '')).toBe(false)
  })
})
