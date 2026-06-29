// /api/dashboard/invites/codes
//   GET  → list the caller's codes (tenant-scoped). Platform admins also
//          see platform-wide (tenant_id IS NULL) codes.
//   POST → generate a code. Tenant admins may ONLY create tenant-scoped
//          codes; platform-wide requires PLATFORM_ADMIN_USER_IDS membership.
//
// Auth: Authorization: Bearer <supabase access token> (same as /api/tenant/me).

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { generateInvitationCode, isPlatformAdmin, normalizeCustomCode } from '@/lib/onboard/invitation-codes'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function userFromBearer(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

async function tenantForUser(userId: string) {
  const { data } = await supabase
    .from('tenants')
    .select('id, business_name')
    .eq('owner_user_id', userId)
    .maybeSingle()
  return data
}

export async function GET(req: Request) {
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = await tenantForUser(user.id)
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  const admin = isPlatformAdmin(user.id)
  let query = supabase
    .from('onboarding_codes')
    .select('id, code, tenant_id, campaign, description, quota_total, quota_used, status, expires_at, created_at')
    .order('created_at', { ascending: false })

  // Tenant admins: own codes only. Platform admins: own + platform-wide.
  query = admin
    ? query.or(`tenant_id.eq.${tenant.id},tenant_id.is.null`)
    : query.eq('tenant_id', tenant.id)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ codes: data ?? [], is_platform_admin: admin })
}

const GenerateBody = z.object({
  scope: z.enum(['tenant', 'platform']).default('tenant'),
  quota_total: z.coerce.number().int().positive().max(100000),
  campaign: z.string().trim().min(1).max(40),
  description: z.string().trim().max(200).optional().or(z.literal('')),
  expires_at: z.string().datetime().optional().or(z.literal('')),
  // Optional admin-supplied static code (e.g. MATE2026). When present the
  // code is used verbatim (normalised) instead of an auto-generated suffix;
  // a clash is a hard 409 rather than a silent re-roll.
  custom_code: z.string().trim().max(60).optional().or(z.literal('')),
})

export async function POST(req: Request) {
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = await tenantForUser(user.id)
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = GenerateBody.safeParse(raw)
  if (!parsed.success) {
    return Response.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 })
  }
  const body = parsed.data

  // R2 authorization: only platform admins may mint platform-wide codes.
  if (body.scope === 'platform' && !isPlatformAdmin(user.id)) {
    return Response.json({ error: 'forbidden_scope' }, { status: 403 })
  }
  const tenantId = body.scope === 'platform' ? null : tenant.id
  const prefix = body.scope === 'platform' ? 'QM' : tenant.business_name

  // Static-code path: admin supplied an exact, memorable code. Use it verbatim
  // (normalised to the canonical form) — no random suffix, no re-roll. A clash
  // against the unique(lower(code)) index is surfaced as 409 so the admin can
  // pick another rather than silently getting a different code than they typed.
  if (body.custom_code) {
    const normalized = normalizeCustomCode(body.custom_code)
    if (!normalized) {
      return Response.json(
        { error: 'invalid_code_format', message: 'Custom code must be 3–40 letters or numbers.' },
        { status: 400 },
      )
    }
    const { data, error } = await supabase
      .from('onboarding_codes')
      .insert({
        code: normalized,
        tenant_id: tenantId,
        campaign: body.campaign,
        description: body.description || null,
        quota_total: body.quota_total,
        expires_at: body.expires_at || null,
        created_by: user.id,
      })
      .select('id, code')
      .single()
    if (error) {
      if (error.code === '23505') {
        return Response.json(
          { error: 'code_taken', message: 'That code is already in use. Pick another.' },
          { status: 409 },
        )
      }
      return Response.json({ error: error.message }, { status: 500 })
    }
    return Response.json({ ok: true, ...data, tenant_id: tenantId })
  }

  // Generate with collision retry against the unique(lower(code)) index.
  let created: { id: string; code: string } | null = null
  for (let i = 0; i < 5 && !created; i++) {
    const code = generateInvitationCode(prefix, body.campaign)
    const { data, error } = await supabase
      .from('onboarding_codes')
      .insert({
        code,
        tenant_id: tenantId,
        campaign: body.campaign,
        description: body.description || null,
        quota_total: body.quota_total,
        expires_at: body.expires_at || null,
        created_by: user.id,
      })
      .select('id, code')
      .single()
    if (!error && data) {
      created = data
      break
    }
    if (error && error.code !== '23505') {
      return Response.json({ error: error.message }, { status: 500 })
    }
    // 23505 → code collision, loop and regenerate.
  }
  if (!created) {
    return Response.json({ error: 'could_not_generate_unique_code' }, { status: 500 })
  }
  return Response.json({ ok: true, ...created, tenant_id: tenantId })
}
