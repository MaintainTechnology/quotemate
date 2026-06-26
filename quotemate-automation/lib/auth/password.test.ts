import { describe, expect, it } from 'vitest'
import { checkPassword, passwordSchema, PASSWORD_MIN, PASSWORD_MAX } from './password'

describe('passwordSchema / checkPassword', () => {
  it('accepts a password at the minimum length', () => {
    expect(checkPassword('a'.repeat(PASSWORD_MIN))).toEqual({ ok: true })
  })

  it('accepts a password at the maximum length', () => {
    expect(checkPassword('a'.repeat(PASSWORD_MAX))).toEqual({ ok: true })
  })

  it('rejects a password below the minimum with a friendly message', () => {
    const result = checkPassword('a'.repeat(PASSWORD_MIN - 1))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/at least 8/i)
  })

  it('rejects a password above the maximum', () => {
    const result = checkPassword('a'.repeat(PASSWORD_MAX + 1))
    expect(result.ok).toBe(false)
  })

  it('rejects non-string input', () => {
    expect(checkPassword(undefined).ok).toBe(false)
    expect(checkPassword(12345678).ok).toBe(false)
  })

  it('exposes the same rules via the raw schema', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false)
    expect(passwordSchema.safeParse('longenough').success).toBe(true)
  })
})
