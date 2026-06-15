import { describe, it, expect } from 'vitest'
import {
  generateInvitationCode,
  slugifyCampaign,
  isPlatformAdmin,
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

describe('isPlatformAdmin', () => {
  it('matches a uuid present in the comma-separated allowlist', () => {
    expect(isPlatformAdmin('u1', 'u1, u2 ,u3')).toBe(true)
    expect(isPlatformAdmin('u9', 'u1,u2')).toBe(false)
    expect(isPlatformAdmin('u1', undefined)).toBe(false)
    expect(isPlatformAdmin('u1', '')).toBe(false)
  })
})
