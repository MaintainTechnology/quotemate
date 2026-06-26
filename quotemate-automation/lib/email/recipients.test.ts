import { describe, expect, it } from 'vitest'
import {
  isValidEmail,
  normalizeEmail,
  selectRecipients,
  type Contact,
} from '@/lib/email/recipients'

const c = (email: string, first?: string): Contact => ({ email, first_name: first ?? null })

describe('normalizeEmail / isValidEmail', () => {
  it('trims + lowercases', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com')
  })
  it('validates basic shapes', () => {
    expect(isValidEmail('a@b.com')).toBe(true)
    expect(isValidEmail('a@b')).toBe(false)
    expect(isValidEmail('nope')).toBe(false)
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail('two@@b.com')).toBe(false)
  })
})

describe('selectRecipients', () => {
  it('dedups by case-insensitive email', () => {
    const r = selectRecipients({
      contacts: [c('lead@x.com'), c('LEAD@X.com'), c('  lead@x.com  ')],
      unsubscribed: [],
      alreadySent: [],
      mode: 'all',
    })
    expect(r.recipients.map((x) => x.email)).toEqual(['lead@x.com'])
    expect(r.duplicatesRemoved).toBe(2)
  })

  it('always suppresses unsubscribed contacts, even in "all" mode', () => {
    const r = selectRecipients({
      contacts: [c('a@x.com'), c('b@x.com')],
      unsubscribed: ['A@X.com'],
      alreadySent: [],
      mode: 'all',
    })
    expect(r.recipients.map((x) => x.email)).toEqual(['b@x.com'])
    expect(r.suppressedUnsubscribed).toBe(1)
    // suppressed identities are surfaced (normalised) so they can be recorded (R12)
    expect(r.suppressedEmails).toEqual(['a@x.com'])
  })

  it('"unsent" mode skips contacts already sent this campaign', () => {
    const r = selectRecipients({
      contacts: [c('a@x.com'), c('b@x.com'), c('c@x.com')],
      unsubscribed: [],
      alreadySent: ['b@x.com'],
      mode: 'unsent',
    })
    expect(r.recipients.map((x) => x.email)).toEqual(['a@x.com', 'c@x.com'])
    expect(r.skippedAlreadySent).toBe(1)
  })

  it('"all" mode re-sends to already-sent contacts', () => {
    const r = selectRecipients({
      contacts: [c('a@x.com'), c('b@x.com')],
      unsubscribed: [],
      alreadySent: ['a@x.com', 'b@x.com'],
      mode: 'all',
    })
    expect(r.recipients.map((x) => x.email)).toEqual(['a@x.com', 'b@x.com'])
    expect(r.skippedAlreadySent).toBe(0)
  })

  it('drops invalid email addresses and counts them', () => {
    const r = selectRecipients({
      contacts: [c('good@x.com'), c('bad-email'), c('also@bad')],
      unsubscribed: [],
      alreadySent: [],
      mode: 'all',
    })
    expect(r.recipients.map((x) => x.email)).toEqual(['good@x.com'])
    expect(r.invalidRemoved).toBe(2)
  })

  it('unsubscribe takes precedence over already-sent counting', () => {
    // An unsubscribed + previously-sent contact is counted as suppressed, not
    // skipped — unsubscribe is the stronger, non-overridable signal.
    const r = selectRecipients({
      contacts: [c('u@x.com')],
      unsubscribed: ['u@x.com'],
      alreadySent: ['u@x.com'],
      mode: 'unsent',
    })
    expect(r.recipients).toHaveLength(0)
    expect(r.suppressedUnsubscribed).toBe(1)
    expect(r.skippedAlreadySent).toBe(0)
  })

  it('preserves contact name fields on the chosen recipients', () => {
    const r = selectRecipients({
      contacts: [{ email: 'a@x.com', first_name: 'Sam', last_name: 'Lee' }],
      unsubscribed: [],
      alreadySent: [],
      mode: 'all',
    })
    expect(r.recipients[0]).toMatchObject({ email: 'a@x.com', first_name: 'Sam', last_name: 'Lee' })
  })

  it('handles an empty contact list', () => {
    const r = selectRecipients({ contacts: [], unsubscribed: [], alreadySent: [], mode: 'unsent' })
    expect(r).toEqual({
      recipients: [],
      suppressedEmails: [],
      suppressedUnsubscribed: 0,
      skippedAlreadySent: 0,
      duplicatesRemoved: 0,
      invalidRemoved: 0,
    })
  })
})
