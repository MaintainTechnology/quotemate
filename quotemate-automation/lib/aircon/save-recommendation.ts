// Air-conditioning — persist a generated recommendation (migration 144).
// Shared by /api/aircon/recommend and /api/aircon/plan so BOTH branches of
// the dashboard tool land on the Quotes tab (trade-jobs cards) and get a
// customer page at /q/aircon/[token]. Callers must fail closed when this
// returns null so an unpersisted in-memory price never becomes an artefact.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'
import { generateShareToken } from '@/lib/stripe/checkout'
import type { AcPricedRecommendation } from './types'

export type SavedAirconRecommendation = { id: string; public_token: string } | null

export function airconIdempotencyToken(args: {
  tenantId: string
  requestId: string
  secret: string
}): string {
  return createHmac('sha256', args.secret)
    .update(`aircon:${args.tenantId}:${args.requestId}`)
    .digest('hex')
    .slice(0, 32)
}

/** created_by is a uuid → auth.users FK, so it must hold the SUPABASE auth id:
 *  tenant.owner_user_id for a Clerk caller, the caller's own id for a Supabase
 *  caller. Never a Clerk `user_…` string (which isn't a valid uuid) — the same
 *  trap app/api/roofing/save/route.ts documents. */
export function supabaseUserIdFor(
  identity: { provider: string; userId: string },
  tenant: { owner_user_id?: string | null } | null,
): string | null {
  return tenant?.owner_user_id ?? (identity.provider === 'supabase' ? identity.userId : null)
}

export async function saveAirconRecommendation(
  supabase: SupabaseClient,
  args: {
    tenantId: string | null
    createdBy: string | null
    address: { address: string; postcode: string; state: string }
    recommendation: AcPricedRecommendation
    requestId?: string
    idempotencySecret?: string
  },
): Promise<SavedAirconRecommendation> {
  // Tenant-less callers (no tenants row yet) still get their in-memory
  // recommendation — nothing to anchor a saved job to.
  if (!args.tenantId) return null
  if (args.requestId && !args.idempotencySecret) return null
  const publicToken =
    args.requestId && args.idempotencySecret
      ? airconIdempotencyToken({
          tenantId: args.tenantId,
          requestId: args.requestId,
          secret: args.idempotencySecret,
        })
      : generateShareToken()
  if (args.requestId) {
    const { data: existing } = await supabase
      .from('aircon_recommendations')
      .select('id, public_token')
      .eq('tenant_id', args.tenantId)
      .eq('public_token', publicToken)
      .maybeSingle()
    if (existing?.id && existing?.public_token) {
      return { id: existing.id as string, public_token: existing.public_token as string }
    }
  }
  const { data: row, error } = await supabase
    .from('aircon_recommendations')
    .insert({
      tenant_id: args.tenantId,
      created_by: args.createdBy,
      address: args.address.address,
      postcode: args.address.postcode,
      state: args.address.state,
      recommendation: args.recommendation,
      routing: args.recommendation.routing.decision,
      public_token: publicToken,
    })
    .select('id')
    .single()
  if (error || !row) {
    if (args.requestId) {
      // A concurrent retry can win the unique public-token insert after the
      // pre-read. Resolve that winner instead of fabricating a second job.
      const { data: existing } = await supabase
        .from('aircon_recommendations')
        .select('id, public_token')
        .eq('tenant_id', args.tenantId)
        .eq('public_token', publicToken)
        .maybeSingle()
      if (existing?.id && existing?.public_token) {
        return { id: existing.id as string, public_token: existing.public_token as string }
      }
    }
    console.warn('[aircon] recommendation save skipped — insert failed', error?.message)
    return null
  }
  return { id: row.id as string, public_token: publicToken }
}
