// Shared password rules — one source of truth so signup, in-dashboard
// password change, and the forgot-password reset flow all accept exactly
// the same passwords. Previously the bounds lived inline in
// app/api/auth/signup/route.ts (min 8 / max 72); extracted here so a
// password accepted in one place can never be rejected in another.
//
// Bounds rationale:
//   • min 8  — matches the signup form's minLength and beats Supabase's
//              own default of 6, so we never accept something weaker than
//              the UI promises.
//   • max 72 — bcrypt (Supabase's hasher) silently truncates input at 72
//              bytes; capping here makes the limit explicit instead of
//              surprising.

import { z } from 'zod'

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 72

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Password must be ${PASSWORD_MAX} characters or fewer.`)

export type PasswordCheck = { ok: true } | { ok: false; error: string }

/**
 * Validate a candidate password against the shared rules and return a
 * friendly, ready-to-display result. Used client-side for instant feedback
 * before a round-trip, and server-side as the authoritative gate.
 */
export function checkPassword(candidate: unknown): PasswordCheck {
  const parsed = passwordSchema.safeParse(candidate)
  if (parsed.success) return { ok: true }
  return {
    ok: false,
    error: parsed.error.issues[0]?.message ?? 'Enter a valid password.',
  }
}
