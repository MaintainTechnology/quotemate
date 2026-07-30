// Spec: specs/clerk-signup-parity.md R2/R3 — the Clerk port of
// resumeAbandonedSignup (app/api/auth/signup/route.ts:66-100).

import { describe, it, expect } from 'vitest'
import {
  isIdentifierTakenError,
  isAlreadySignedInError,
  classifySignUpFailure,
  decideDuplicateEmail,
} from './resume-decision'

describe('classifySignUpFailure', () => {
  // Clerk's SignUpFutureResource exposes two first-class signals that are more
  // reliable than sniffing error text: `existingSession` ("could not create a
  // session because the identifier already exists in an existing session") and
  // `isTransferable` ("there is a matching user for the provided identifier").
  // Prefer those; keep the string heuristics as the fallback.
  it('prefers the existingSession signal over any error text', () => {
    expect(
      classifySignUpFailure({ existingSession: true, isTransferable: true, error: null }),
    ).toBe('already_signed_in')
  })

  it('treats a transferable sign-up as a taken identifier', () => {
    expect(classifySignUpFailure({ isTransferable: true, error: null })).toBe('identifier_taken')
  })

  it('falls back to the error text when no resource signal is set', () => {
    expect(classifySignUpFailure({ error: { code: 'form_identifier_exists' } })).toBe(
      'identifier_taken',
    )
    expect(classifySignUpFailure({ error: { code: 'session_exists' } })).toBe('already_signed_in')
  })

  it('ranks a session conflict above a taken identifier when both are indicated', () => {
    // Order matters: a live session must be resolved first, otherwise the
    // duplicate-email resume would sign in on top of an existing session.
    expect(
      classifySignUpFailure({ isTransferable: true, error: { code: 'session_exists' } }),
    ).toBe('already_signed_in')
  })

  it('reports anything else as other, so the raw Clerk message is shown', () => {
    expect(classifySignUpFailure({ error: { code: 'form_password_pwned' } })).toBe('other')
    expect(classifySignUpFailure({ error: null })).toBe('other')
  })
})

describe('isIdentifierTakenError', () => {
  it('matches the documented Clerk code', () => {
    expect(isIdentifierTakenError({ code: 'form_identifier_exists' })).toBe(true)
  })

  it('matches the same code nested under errors[0] (Clerk wraps it there too)', () => {
    expect(isIdentifierTakenError({ errors: [{ code: 'form_identifier_exists' }] })).toBe(true)
  })

  it('matches the identifier_exists family, not just the exact code', () => {
    // R3: a Clerk rename must degrade to /signup's wording, not raw Clerk copy.
    expect(isIdentifierTakenError({ code: 'form_email_identifier_exists' })).toBe(true)
  })

  it('falls back to the message when no code is present', () => {
    expect(isIdentifierTakenError({ message: 'That email has already been registered' })).toBe(true)
    expect(isIdentifierTakenError({ longMessage: 'This email address is already taken.' })).toBe(true)
  })

  it('does not match unrelated Clerk errors', () => {
    expect(isIdentifierTakenError({ code: 'form_password_pwned' })).toBe(false)
    expect(isIdentifierTakenError({ message: 'Password is too short' })).toBe(false)
  })

  it('is safe on null, undefined and non-objects', () => {
    expect(isIdentifierTakenError(null)).toBe(false)
    expect(isIdentifierTakenError(undefined)).toBe(false)
    expect(isIdentifierTakenError('form_identifier_exists')).toBe(false)
  })
})

describe('isAlreadySignedInError', () => {
  // Reachable dead end: a duplicate-email attempt that authenticates leaves a
  // live Clerk session. If the tradie then edits the email and resubmits,
  // signUp.password() is called while signed in and Clerk refuses. Without this
  // the tradie sees a raw SDK string with no way forward.
  it('matches the session-exists family by code', () => {
    expect(isAlreadySignedInError({ code: 'session_exists' })).toBe(true)
    expect(isAlreadySignedInError({ errors: [{ code: 'identifier_already_signed_in' }] })).toBe(true)
  })

  it('matches the message when no code is present', () => {
    expect(isAlreadySignedInError({ message: "You're already signed in." })).toBe(true)
    expect(isAlreadySignedInError({ longMessage: 'You are already signed in' })).toBe(true)
  })

  it('does not match a plain duplicate-email error', () => {
    expect(isAlreadySignedInError({ code: 'form_identifier_exists' })).toBe(false)
  })

  it('is safe on null, undefined and non-objects', () => {
    expect(isAlreadySignedInError(null)).toBe(false)
    expect(isAlreadySignedInError(undefined)).toBe(false)
    expect(isAlreadySignedInError('session_exists')).toBe(false)
  })
})

describe('decideDuplicateEmail', () => {
  it('sends the tradie to sign in when the password did not authenticate', () => {
    // Mirrors /signup's 409: a wrong password is indistinguishable from a
    // takeover attempt, so it must never reveal whether a tenant exists.
    expect(decideDuplicateEmail({ signInFailed: true, tenantStatus: null })).toBe('needs_signin')
  })

  it('resumes when the account authenticates but owns no tenant', () => {
    // 404 from /api/tenant/me is the authed-but-no-tenant signal the dashboard
    // already relies on (app/dashboard/page.tsx:715).
    expect(decideDuplicateEmail({ signInFailed: false, tenantStatus: 404 })).toBe('resume')
  })

  it('reports an existing account when a tenant is already activated', () => {
    expect(decideDuplicateEmail({ signInFailed: false, tenantStatus: 200 })).toBe('existing_account')
  })

  it('never resumes on an ambiguous tenant lookup', () => {
    // Only a clean 404 may resume. Anything else could be someone else's
    // account or an outage, so the wizard must not be entered.
    for (const status of [401, 403, 500, 502, 0]) {
      expect(decideDuplicateEmail({ signInFailed: false, tenantStatus: status })).not.toBe('resume')
    }
    expect(decideDuplicateEmail({ signInFailed: false, tenantStatus: null })).not.toBe('resume')
  })

  it('never tells an authenticated tradie to sign in', () => {
    // Once the password has authenticated we have finalised a real Clerk
    // session. "Sign in instead" would then be a lie AND a dead end (the link
    // bounces a signed-in user straight back out). Send them to the dashboard,
    // which already self-routes to /onboard when no tenant exists
    // (app/dashboard/page.tsx:714-717).
    for (const status of [200, 401, 403, 500, 502, 0, null]) {
      expect(decideDuplicateEmail({ signInFailed: false, tenantStatus: status })).not.toBe(
        'needs_signin',
      )
    }
  })

  it('routes an authenticated tradie with an ambiguous answer to the dashboard', () => {
    expect(decideDuplicateEmail({ signInFailed: false, tenantStatus: 500 })).toBe('existing_account')
    expect(decideDuplicateEmail({ signInFailed: false, tenantStatus: null })).toBe('existing_account')
  })
})
