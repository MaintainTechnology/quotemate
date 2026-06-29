// Invitation codes — tradie onboarding allowlist + campaign attribution.
// One module reused by every entry point (web Step-0, SMS inbound,
// dashboard generate). Mirrors the helper style of intent-tokens.ts.
//
// Vocabulary:
//   check   — read-only validation (exists / active / not expired / quota left)
//   consume — single idempotent write at activate time (ledger + quota++)

import type { SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

/** Unambiguous suffix alphabet — no 0/O/1/I. */
export const RANDOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export type CodeChannel = 'web' | 'sms'

export type CheckOk = {
  ok: true
  code_id: string
  tenant_id: string | null
  remaining_quota: number
  last_slot: boolean
}
export type CheckErr = {
  ok: false
  error:
    | 'code_not_found'
    | 'code_expired'
    | 'quota_exhausted'
    | 'code_revoked'
    | 'code_paused'
  message: string
}
export type CheckResult = CheckOk | CheckErr

/** Campaign → UPPER dash-slug, alphanumerics only, capped at 24 chars. */
export function slugifyCampaign(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '')
}

/** 4-char random suffix from the unambiguous alphabet. */
function randomSuffix(len = 4): string {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += RANDOM_ALPHABET[bytes[i] % RANDOM_ALPHABET.length]
  return out
}

/** prefix-CAMPAIGN-SUFFIX, e.g. JON-JUNE-FLYERS-7K2P. Canonical UPPER-case. */
export function generateInvitationCode(prefix: string, campaign: string): string {
  const p = prefix.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8) || 'QM'
  const c = slugifyCampaign(campaign || 'CODE')
  return `${p}-${c}-${randomSuffix()}`
}

/**
 * Normalise an admin-supplied custom (static) invitation code to the same
 * canonical UPPER-case form as a generated one: alphanumerics with runs of
 * any other character collapsed to a single dash, no leading/trailing dash.
 * Returns null when the result can't be a usable code (fewer than 3 or more
 * than 40 usable chars). Used when a tradie wants a memorable code like
 * MATE2026 or JUNE-SPECIAL instead of an auto-generated random suffix.
 */
export function normalizeCustomCode(raw: string): string | null {
  const c = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (c.length < 3 || c.length > 40) return null
  return c
}

/** Membership test against a comma-separated env allowlist. */
export function isPlatformAdmin(userId: string, allowlist = process.env.PLATFORM_ADMIN_USER_IDS): boolean {
  if (!allowlist) return false
  return allowlist
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(userId)
}

const FRIENDLY: Record<CheckErr['error'], string> = {
  code_not_found: "We don't recognise that code. Check the spelling or ask whoever sent it.",
  code_expired: 'That code has expired. Ask whoever sent it for a new one.',
  quota_exhausted: 'That code has reached its sign-up limit. Ask for a new one.',
  code_revoked: 'That code is no longer valid.',
  code_paused: 'That code is paused right now. Try again later or ask for a new one.',
}

/**
 * Read-only validation. Trims + upper-cases, looks up by lower(code).
 * NEVER writes. Safe to call repeatedly (on blur, at Step 0).
 */
export async function checkInvitationCode(
  supabase: SupabaseClient,
  rawCode: string,
): Promise<CheckResult> {
  const code = rawCode.trim().toUpperCase()
  if (!code) return { ok: false, error: 'code_not_found', message: FRIENDLY.code_not_found }

  const { data } = await supabase
    .from('onboarding_codes')
    .select('id, tenant_id, status, expires_at, quota_total, quota_used')
    .ilike('code', code) // case-insensitive exact (no % wildcards in `code`)
    .maybeSingle()

  if (!data) return { ok: false, error: 'code_not_found', message: FRIENDLY.code_not_found }
  if (data.status === 'revoked') return { ok: false, error: 'code_revoked', message: FRIENDLY.code_revoked }
  if (data.status === 'paused') return { ok: false, error: 'code_paused', message: FRIENDLY.code_paused }
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: 'code_expired', message: FRIENDLY.code_expired }
  }
  const used = data.quota_used as number
  const total = data.quota_total as number
  if (used >= total) return { ok: false, error: 'quota_exhausted', message: FRIENDLY.quota_exhausted }

  return {
    ok: true,
    code_id: data.id as string,
    tenant_id: (data.tenant_id as string | null) ?? null,
    remaining_quota: total - used,
    last_slot: used === total - 1,
  }
}

export type ConsumeResult =
  | { ok: true; alreadyRedeemed: boolean }
  | { ok: false; error: 'quota_exhausted' | 'db_error'; message: string }

/**
 * Single idempotent consume, called inside /api/onboard/activate AFTER
 * the tenant row exists. Steps:
 *   1. insert code_redemptions (unique(code_id,tenant_id) → retries no-op)
 *   2. guarded quota++ (where quota_used < quota_total) — 0 rows = exhausted
 *   3. stamp tenants.used_onboarding_code_id
 * Not a DB transaction (supabase-js has no multi-statement txn); the
 * unique ledger row + guarded update together prevent double-burn and
 * over-quota under concurrency.
 */
export async function consumeInvitationCode(
  supabase: SupabaseClient,
  args: { codeId: string; tenantId: string; channel: CodeChannel },
): Promise<ConsumeResult> {
  // 1. Ledger row — idempotency key.
  const { error: insErr } = await supabase
    .from('code_redemptions')
    .insert({ code_id: args.codeId, tenant_id: args.tenantId, channel: args.channel })

  if (insErr) {
    // 23505 = unique violation → this tenant already redeemed this code.
    if (insErr.code === '23505') {
      return { ok: true, alreadyRedeemed: true }
    }
    return { ok: false, error: 'db_error', message: insErr.message }
  }

  // 2. Guarded increment. RPC keeps the read-compare-write atomic.
  const { data: bumped, error: bumpErr } = await supabase.rpc('increment_code_quota', {
    p_code_id: args.codeId,
  })
  if (bumpErr) return { ok: false, error: 'db_error', message: bumpErr.message }
  if (bumped === false) {
    // Quota just exhausted by a concurrent signup — roll back the ledger row.
    await supabase
      .from('code_redemptions')
      .delete()
      .eq('code_id', args.codeId)
      .eq('tenant_id', args.tenantId)
    return { ok: false, error: 'quota_exhausted', message: FRIENDLY.quota_exhausted }
  }

  // 3. Convenience pointer (non-fatal).
  await supabase
    .from('tenants')
    .update({ used_onboarding_code_id: args.codeId })
    .eq('id', args.tenantId)

  return { ok: true, alreadyRedeemed: false }
}
