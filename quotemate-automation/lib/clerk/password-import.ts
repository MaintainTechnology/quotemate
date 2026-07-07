// Pure rules for importing a Supabase GoTrue password into Clerk WITHOUT a
// reset — so existing subscribers keep their exact password after the auth
// swap. Supabase stores auth.users.encrypted_password as a standard bcrypt
// modular-crypt string; Clerk's Backend API accepts that digest verbatim via
// { passwordDigest, passwordHasher: 'bcrypt' } on createUser AND updateUser.
// No I/O here — scripts/import-clerk-passwords.ts does the DB + Clerk calls;
// this holds the validation so it is unit-testable (same pattern as link.ts).

export type ClerkPasswordParams = { passwordDigest: string; passwordHasher: 'bcrypt' }

// A standard bcrypt digest: $2a|$2b|$2y $ <2-digit cost> $ <22 salt + 31 hash>
// where the trailing block is 53 chars in bcrypt's base64 alphabet. Total 60.
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/

/** True iff `hash` is a bcrypt digest Clerk can import as passwordHasher='bcrypt'. */
export function isSupportedBcrypt(hash: string | null | undefined): boolean {
  return typeof hash === 'string' && BCRYPT_RE.test(hash)
}

/**
 * Map a Supabase `encrypted_password` to the Clerk password-import params, or
 * explain why it can't be imported (passwordless/OAuth/OTP account, or a
 * non-bcrypt hash format we don't transfer verbatim).
 */
export function toClerkPasswordParams(
  encryptedPassword: string | null | undefined,
): { ok: true; params: ClerkPasswordParams } | { ok: false; reason: string } {
  if (!encryptedPassword || encryptedPassword.trim() === '') {
    return { ok: false, reason: 'no password set (passwordless / OAuth / OTP account)' }
  }
  if (!isSupportedBcrypt(encryptedPassword)) {
    return {
      ok: false,
      reason: `unsupported hash format (prefix ${encryptedPassword.slice(0, 7)}) — expected bcrypt $2a/$2b/$2y`,
    }
  }
  return { ok: true, params: { passwordDigest: encryptedPassword, passwordHasher: 'bcrypt' } }
}
