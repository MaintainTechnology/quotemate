// Tradie signup intent tokens — short URL-safe slugs that link a
// tradie's SMS thread to a pending web onboarding session.
//
// Flow:
//   1. createIntentToken({ owner_mobile, sms_conversation_id })
//      → inserts a row, returns the token slug
//   2. SMS welcome message includes /signup?intent=<token>
//   3. /api/onboard/intent/[token] (GET) → resolveActiveIntent(token)
//      hands the prefill payload to the signup page
//   4. /api/onboard/activate → markIntentUsed(token, tenantId) once
//      activation succeeds, also flips the SMS conversation status

import type { SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

export type IntentRow = {
  id: string
  token: string
  owner_mobile: string
  sms_conversation_id: string | null
  expires_at: string
  used_at: string | null
  resulting_tenant_id: string | null
  created_at: string
}

export type IntentInspection =
  | { status: 'verified'; intent: IntentRow }
  | { status: 'used' | 'expired' | 'invalid' }
  | { status: 'unavailable'; error: string }

/** 6-char URL-safe slug (~36 bits, plenty for a 24h-TTL token). */
export function generateIntentToken(): string {
  // 5 bytes → 8 base64url chars; trim to 6 for shorter SMS link.
  return randomBytes(5).toString('base64url').slice(0, 6)
}

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000  // 24 hours

/**
 * Get the active token for a mobile, OR create / refresh one.
 *
 * Behaviour:
 *   • Existing UNUSED + UNEXPIRED row → return its token (reused=true)
 *   • Existing UNUSED + EXPIRED row   → refresh token + extend expiry,
 *                                       return new token (reused=false)
 *   • No row                          → insert new row, return token
 *
 * The unique-per-mobile constraint on (owner_mobile) where used_at IS NULL
 * means at most one unused row ever exists for a given mobile — we
 * either reuse, refresh, or create. Race-safe via re-fetch on
 * unique-violation errors.
 */
export async function createOrGetActiveIntent(
  supabase: SupabaseClient,
  args: { owner_mobile: string; sms_conversation_id: string | null },
): Promise<{ token: string; reused: boolean } | { error: string }> {
  // 1. Look for ANY unused row for this mobile (active or expired).
  const { data: existing } = await supabase
    .from('tradie_signup_intents')
    .select('id, token, expires_at')
    .eq('owner_mobile', args.owner_mobile)
    .is('used_at', null)
    .maybeSingle()

  if (existing) {
    const isActive = new Date(existing.expires_at).getTime() > Date.now()
    if (isActive) {
      return { token: existing.token, reused: true }
    }
    // Expired — refresh with a new token + new expiry. Generates a
    // fresh slug so the old link (potentially already leaked) is invalid.
    for (let i = 0; i < 3; i++) {
      const newToken = generateIntentToken()
      const { error } = await supabase
        .from('tradie_signup_intents')
        .update({
          token: newToken,
          expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
          sms_conversation_id: args.sms_conversation_id ?? existing['sms_conversation_id' as keyof typeof existing] ?? null,
        })
        .eq('id', existing.id)
      if (!error) return { token: newToken, reused: false }
      // 23505 here can only be a token collision — retry.
      if (error.code !== '23505') return { error: error.message }
    }
    return { error: 'Could not refresh expired intent token after 3 attempts' }
  }

  // 2. No existing row — fresh insert. Retry on rare token collisions
  //    or per-mobile race conditions.
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = generateIntentToken()
    const { error } = await supabase
      .from('tradie_signup_intents')
      .insert({
        token,
        owner_mobile: args.owner_mobile,
        sms_conversation_id: args.sms_conversation_id,
      })
    if (!error) return { token, reused: false }
    if (error.code !== '23505') return { error: error.message }
    // Per-mobile race: another concurrent insert won. Re-fetch.
    if ((error.message ?? '').includes('one_active_per_mobile')) {
      const { data: race } = await supabase
        .from('tradie_signup_intents')
        .select('token')
        .eq('owner_mobile', args.owner_mobile)
        .is('used_at', null)
        .maybeSingle()
      if (race?.token) return { token: race.token, reused: true }
    }
    // Otherwise: token collision, loop and try a different slug.
  }
  return { error: 'Could not generate a unique intent token after 3 attempts' }
}

/**
 * Resolve a token to its prefill payload. Returns null if the token
 * doesn't exist, is already used, or has expired.
 */
export async function resolveActiveIntent(
  supabase: SupabaseClient,
  token: string,
): Promise<IntentRow | null> {
  const { data } = await supabase
    .from('tradie_signup_intents')
    .select('*')
    .eq('token', token)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  return (data as IntentRow | null) ?? null
}

/**
 * Resolve an inbound capability without collapsing every failure into a 404.
 * The mobile acquisition adapter needs to distinguish an already-consumed link
 * from an expired one, while database failures must remain retryable rather
 * than being misreported as a bad token.
 */
export async function inspectIntentToken(
  supabase: SupabaseClient,
  token: string,
  now = new Date(),
): Promise<IntentInspection> {
  const { data, error } = await supabase
    .from('tradie_signup_intents')
    .select('*')
    .eq('token', token)
    .maybeSingle()

  if (error) return { status: 'unavailable', error: error.message }
  if (!data) return { status: 'invalid' }

  const intent = data as IntentRow
  if (intent.used_at) return { status: 'used' }
  const expiry = new Date(intent.expires_at).getTime()
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) return { status: 'expired' }
  return { status: 'verified', intent }
}

/**
 * Mark an intent as consumed. Idempotent — already-used intents
 * return ok=false silently so concurrent activate retries don't fail.
 */
export async function markIntentUsed(
  supabase: SupabaseClient,
  args: { token: string; tenantId: string },
): Promise<{ ok: boolean; conversationId: string | null }> {
  const usedAt = new Date().toISOString()
  const { data, error } = await supabase
    .from('tradie_signup_intents')
    .update({
      used_at: usedAt,
      resulting_tenant_id: args.tenantId,
    })
    .eq('token', args.token)
    .is('used_at', null)
    .gt('expires_at', usedAt)
    .select('sms_conversation_id')
    .maybeSingle()

  // PostgREST returns { data: null, error: null } when the guarded update
  // matched no row (already used, expired/deleted, or wrong token). Treat that
  // as a failed claim; otherwise two concurrent activations could both report
  // the same one-time intent as consumed.
  if (error || !data) return { ok: false, conversationId: null }

  // Back-link the originating SMS conversation to the new tenant.
  const conversationId = (data?.sms_conversation_id as string | null) ?? null
  if (conversationId) {
    await supabase
      .from('sms_conversations')
      .update({
        tenant_id: args.tenantId,
        conversation_type: 'converted',
      })
      .eq('id', conversationId)
  }

  return { ok: true, conversationId }
}
