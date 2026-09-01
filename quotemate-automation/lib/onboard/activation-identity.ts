import type { Identity } from '@/lib/tenant/current'

export type ActivationIdentityFields = {
  owner_user_id?: string | null
  clerk_user_id?: string | null
  owner_email?: string | null
}

export type ActivationOwnership =
  | {
      ok: true
      ownerUserId: string | null
      clerkUserId: string | null
    }
  | {
      ok: false
      field: 'owner_user_id' | 'clerk_user_id' | 'owner_email'
      message: string
    }

const present = (value: string | null | undefined) => value?.trim() || null

/**
 * Bind an activation to the verified bearer identity.
 *
 * Identity fields remain accepted in the request schema for compatibility with
 * already-shipped web/mobile clients, but they are assertions only. They never
 * select the owner written to `tenants`: a conflicting assertion fails closed,
 * while an omitted or matching assertion is replaced by the verified subject.
 */
export function deriveActivationOwnership(
  identity: Identity,
  supplied: ActivationIdentityFields,
): ActivationOwnership {
  const suppliedOwnerId = present(supplied.owner_user_id)
  const suppliedClerkId = present(supplied.clerk_user_id)
  const suppliedEmail = present(supplied.owner_email)?.toLowerCase() ?? null
  const verifiedEmail = present(identity.email)?.toLowerCase() ?? null

  if (verifiedEmail && suppliedEmail && suppliedEmail !== verifiedEmail) {
    return {
      ok: false,
      field: 'owner_email',
      message: 'The onboarding email does not match the authenticated account.',
    }
  }

  if (identity.provider === 'clerk') {
    if (suppliedOwnerId) {
      return {
        ok: false,
        field: 'owner_user_id',
        message: 'A Clerk activation cannot claim a legacy owner id.',
      }
    }
    if (suppliedClerkId && suppliedClerkId !== identity.userId) {
      return {
        ok: false,
        field: 'clerk_user_id',
        message: 'The onboarding account does not match the authenticated Clerk session.',
      }
    }
    return { ok: true, ownerUserId: null, clerkUserId: identity.userId }
  }

  if (suppliedClerkId) {
    return {
      ok: false,
      field: 'clerk_user_id',
      message: 'A legacy activation cannot claim a Clerk user id.',
    }
  }
  if (suppliedOwnerId && suppliedOwnerId !== identity.userId) {
    return {
      ok: false,
      field: 'owner_user_id',
      message: 'The onboarding account does not match the authenticated session.',
    }
  }
  return { ok: true, ownerUserId: identity.userId, clerkUserId: null }
}
