// Rules for linking accounts to Clerk: every tradie/admin account is recorded
// as the professional plan, is_admin is true only for the admin_users
// allow-list, and a metadata patch never clobbers unrelated Clerk keys.

import { describe, it, expect } from 'vitest'
import {
  PROFESSIONAL_PLAN,
  accountPublicMetadata,
  mergePublicMetadata,
  adminEmailSet,
  deriveUsername,
  isAdminEmail,
  normalizeEmail,
} from './link'

describe('accountPublicMetadata', () => {
  it('records the professional plan for every account', () => {
    expect(accountPublicMetadata({ isAdmin: false }).plan).toBe(PROFESSIONAL_PLAN)
    expect(accountPublicMetadata({ isAdmin: true }).plan).toBe('professional')
  })

  it('sets is_admin true for admins and false otherwise', () => {
    expect(accountPublicMetadata({ isAdmin: true }).is_admin).toBe(true)
    expect(accountPublicMetadata({ isAdmin: false }).is_admin).toBe(false)
  })
})

describe('adminEmailSet / isAdminEmail', () => {
  const admins = adminEmailSet([
    { email: 'daligdig.jephmari@gmail.com' },
    { email: 'jon@maintain.com.au' },
    { email: 'JON11E@hotmail.com' }, // mixed case in DB
    { email: null }, // ignored
  ])

  it('matches designated admins case-insensitively', () => {
    expect(isAdminEmail('daligdig.jephmari@gmail.com', admins)).toBe(true)
    expect(isAdminEmail('Jon11e@Hotmail.com', admins)).toBe(true)
  })

  it('is false for non-admin tradies and blanks', () => {
    expect(isAdminEmail('aidan@keystoneexecutivecoaching.com.au', admins)).toBe(false)
    expect(isAdminEmail('admin@oakcrestelectrical.com.au', admins)).toBe(false)
    expect(isAdminEmail(null, admins)).toBe(false)
    expect(isAdminEmail('', admins)).toBe(false)
  })

  it('drops null emails from the admin set', () => {
    expect(admins.size).toBe(3)
  })
})

describe('mergePublicMetadata', () => {
  it('overrides patched keys but preserves the rest', () => {
    expect(
      mergePublicMetadata({ plan: 'starter', foo: 'bar' }, { plan: 'professional', is_admin: true }),
    ).toEqual({ plan: 'professional', is_admin: true, foo: 'bar' })
  })

  it('handles missing existing metadata', () => {
    expect(mergePublicMetadata(null, { is_admin: false })).toEqual({ is_admin: false })
    expect(mergePublicMetadata(undefined, { plan: 'professional' })).toEqual({
      plan: 'professional',
    })
  })
})

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  JON@Maintain.com.au ')).toBe('jon@maintain.com.au')
    expect(normalizeEmail(null)).toBe('')
  })
})

describe('deriveUsername', () => {
  it('produces a stable, Clerk-valid username from email + seed', () => {
    const u = deriveUsername('aidan@keystoneexecutivecoaching.com.au', '9ba4bade-8fef-49cf-a1b4-fc1549d987d5')
    expect(u).toBe('qm_aidan_9ba4bade')
    expect(u).toMatch(/^[a-z0-9_]{4,64}$/)
    // Deterministic — same inputs, same username (idempotent re-runs).
    expect(deriveUsername('aidan@keystoneexecutivecoaching.com.au', '9ba4bade-8fef-49cf-a1b4-fc1549d987d5')).toBe(u)
  })

  it('sanitises dotted local-parts and stays within char rules', () => {
    const u = deriveUsername('daligdig.jephmari@gmail.com', 'c8578cad-b04c-477f-84e7-464134d0f770')
    expect(u).toBe('qm_daligdig_jephmari_c8578cad')
    expect(u).toMatch(/^[a-z0-9_]+$/)
  })

  it('distinct accounts get distinct usernames via the seed', () => {
    expect(deriveUsername('a@x.com', 'seed-one')).not.toBe(deriveUsername('a@x.com', 'seed-two'))
  })
})
