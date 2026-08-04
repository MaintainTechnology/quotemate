// Runnable check for session.ts — assert-based, no framework, same pattern
// as the repo's other *.check.ts files. Run: node dist/web/session.check.js
// Written against the spec BEFORE the implementation was accepted:
// mint→valid, expiry, tampering, wrong password, cookie parsing, disabled
// login, and platform-secret precedence must all hold.

import { strict as assert } from 'node:assert'
import {
  loginEnabled, passwordOk, mintSession, sessionValid, readCookie,
  setCookieHeader, clearCookieHeader, COOKIE,
} from './session'

const SVC = 'qm-check'

// ── disabled state: no password ⇒ nothing authenticates ────────────────
delete process.env.WEB_ADMIN_PASSWORD
delete process.env.WEB_SESSION_SECRET
assert.equal(loginEnabled(), false, 'login must be disabled with no password')
assert.equal(passwordOk('anything'), false)
assert.equal(mintSession(SVC), null, 'no session can be minted when disabled')
assert.equal(sessionValid(SVC, '123.abc'), false)

// ── enabled: password checks ───────────────────────────────────────────
process.env.WEB_ADMIN_PASSWORD = 'correct-horse'
assert.equal(loginEnabled(), true)
assert.equal(passwordOk('correct-horse'), true)
assert.equal(passwordOk('wrong'), false)
assert.equal(passwordOk(''), false)
assert.equal(passwordOk(undefined), false)

// ── mint → valid ───────────────────────────────────────────────────────
const now = 1_700_000_000_000
const cookie = mintSession(SVC, now)
assert.ok(cookie, 'session minted')
assert.equal(sessionValid(SVC, cookie!, now), true, 'fresh session valid')
assert.equal(sessionValid(SVC, cookie!, now + 23 * 3600 * 1000), true, '23h old still valid')
assert.equal(sessionValid(SVC, cookie!, now + 25 * 3600 * 1000), false, '25h old expired')

// ── tampering ──────────────────────────────────────────────────────────
const dot = cookie!.indexOf('.')
const forgedExp = String(Number(cookie!.slice(0, dot)) + 9999999) + cookie!.slice(dot)
assert.equal(sessionValid(SVC, forgedExp, now), false, 'altered expiry rejected')
assert.equal(sessionValid(SVC, cookie!.slice(0, -1) + '0', now), false, 'altered sig rejected')
assert.equal(sessionValid(SVC, 'garbage', now), false)
assert.equal(sessionValid(SVC, '', now), false)
assert.equal(sessionValid('other-service', cookie!, now), false, 'cookie is service-scoped')

// ── password change invalidates old sessions ───────────────────────────
process.env.WEB_ADMIN_PASSWORD = 'rotated'
assert.equal(sessionValid(SVC, cookie!, now), false, 'rotation invalidates sessions')
process.env.WEB_ADMIN_PASSWORD = 'correct-horse'
assert.equal(sessionValid(SVC, cookie!, now), true)

// ── explicit WEB_SESSION_SECRET wins over the derived secret ───────────
process.env.WEB_SESSION_SECRET = 'explicit-secret'
assert.equal(sessionValid(SVC, cookie!, now), false, 'explicit secret replaces derived')
const cookie2 = mintSession(SVC, now)
assert.equal(sessionValid(SVC, cookie2!, now), true)
delete process.env.WEB_SESSION_SECRET

// ── cookie header parsing ──────────────────────────────────────────────
assert.equal(readCookie(`a=1; ${COOKIE}=${encodeURIComponent(cookie!)}; b=2`, COOKIE), cookie)
assert.equal(readCookie('a=1; b=2', COOKIE), undefined)
assert.equal(readCookie(undefined, COOKIE), undefined)
assert.equal(readCookie(`${COOKIE}=plain`, COOKIE), 'plain')

// ── set/clear headers ──────────────────────────────────────────────────
assert.ok(setCookieHeader('v', true).includes('Secure'))
assert.ok(!setCookieHeader('v', false).includes('Secure'))
assert.ok(setCookieHeader('v', true).includes('HttpOnly'))
assert.ok(clearCookieHeader(false).includes('Max-Age=0'))

console.log('session.check: all assertions passed')
