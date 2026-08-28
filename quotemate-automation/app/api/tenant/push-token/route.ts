// /api/tenant/push-token — mobile app push-token registry (migration 191).
//   POST   → register/refresh this device's Expo push token for the tenant
//   DELETE → forget the token (sign-out / notifications toggled off)
//
// The mobile app calls POST on sign-in and app start, so last_seen_at doubles
// as a liveness stamp. Fan-out happens in lib/push/send.ts; this route only
// maintains the registry. Auth + shape mirror /api/tenant/features.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const ExpoTokenSchema = z
  .string()
  .max(256)
  .regex(/^(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]{10,200}\]$/)

const RegisterSchema = z.object({
  token: ExpoTokenSchema,
  platform: z.enum(['ios', 'android']),
  deviceName: z.string().trim().min(1).max(100).optional(),
})

const RemoveSchema = z.object({
  token: ExpoTokenSchema,
})

async function tenantFromBearer(req: Request) {
  // Dual-auth: Clerk session token (→ clerk_user_id) OR legacy Supabase token
  // (→ owner_user_id). Same resolver as every other /api/tenant/* route.
  const resolved = await resolveTenantRequest(supabase, req, 'id')
  if (!resolved) return { tenant: null, identity: null, response: Response.json({ ok: false, error: 'unauthorized' }, { status: 401 }) }
  const tenant = resolved.tenant as { id: string } | null
  if (!tenant) return { tenant: null, identity: resolved.identity, response: Response.json({ ok: false, error: 'no_tenant' }, { status: 404 }) }
  return { tenant, identity: resolved.identity, response: null }
}

export async function POST(req: Request) {
  const { tenant, identity, response } = await tenantFromBearer(req)
  if (!tenant || !identity) return response as Response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = RegisterSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_payload', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  // Re-registering the same device refreshes platform/device_name/last_seen_at
  // (unique (tenant_id, token), migration 191) rather than duplicating.
  const { error } = await supabase.from('push_tokens').upsert(
    {
      tenant_id: tenant.id,
      user_id: identity.userId,
      token: parsed.data.token,
      platform: parsed.data.platform,
      device_name: parsed.data.deviceName ?? null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,user_id,token' },
  )
  if (error) {
    console.error('[push-token] registration failed', error.message)
    return Response.json({ error: 'registration_failed' }, { status: 500 })
  }

  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { tenant, identity, response } = await tenantFromBearer(req)
  if (!tenant || !identity) return response as Response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = RemoveSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_payload', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  // Scoped to the caller's tenant — a token can only ever remove itself from
  // the tenant that registered it. Deleting a token that's already gone is
  // fine (idempotent sign-out).
  const { error } = await supabase
    .from('push_tokens')
    .delete()
    .eq('tenant_id', tenant.id)
    .eq('user_id', identity.userId)
    .eq('token', parsed.data.token)
  if (error) {
    console.error('[push-token] removal failed', error.message)
    return Response.json({ error: 'removal_failed' }, { status: 500 })
  }

  return Response.json({ ok: true })
}
