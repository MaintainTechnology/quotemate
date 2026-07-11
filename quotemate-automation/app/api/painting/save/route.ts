// POST /api/painting/save — persist a confirmed painting estimate into
// public.painting_measurements (one row per saved job). Requires migration
// 089. Mirrors /api/roofing/save.
//
// GET /api/painting/save — list THIS tenant's saved painting jobs, newest
// first, powering the "Saved paint jobs" history in the dashboard Paint
// tab. Returns denormalised summary columns only.
//
// Auth: same bearer-token pattern as the rest of the painting surface.

import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import { SavePaintingSchema } from '@/lib/painting/request-schema'
import { buildSavedPaintingRow } from '@/lib/painting/save-row'
import { generatePaintAfterImage } from '@/lib/painting/paint-after'

export const dynamic = 'force-dynamic'
// after(): the AI repaint pre-warm below takes 10–20 s.
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Dual-auth: Clerk session token (→ clerk_user_id) OR legacy Supabase token
// (→ owner_user_id). Tenant is optional — GET/POST fall back to the caller's
// user id (created_by) when no tenant row exists.
async function userAndTenantFromBearer(
  req: Request,
): Promise<{ userId: string | null; tenantId: string | null } | null> {
  const resolved = await resolveTenantRequest(supabase, req, 'id, owner_user_id')
  if (!resolved) return null
  const tenant = resolved.tenant as { id?: string; owner_user_id?: string | null } | null
  // created_by is a uuid → auth.users FK, and the GET fallback filters on it,
  // so use the SUPABASE auth id (tenant.owner_user_id for a Clerk caller; the
  // caller's own id for a Supabase caller). Never a Clerk `user_…` string.
  const supabaseUserId =
    tenant?.owner_user_id ?? (resolved.identity.provider === 'supabase' ? resolved.identity.userId : null)
  return {
    userId: supabaseUserId,
    tenantId: (tenant?.id as string | undefined) ?? null,
  }
}

export async function POST(req: Request) {
  const auth = await userAndTenantFromBearer(req)
  if (!auth) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = SavePaintingSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const row = buildSavedPaintingRow({
    tenantId: auth.tenantId,
    userId: auth.userId,
    data: parsed.data,
    // A dashboard save is tradie-authored + reviewed inline, so release it
    // immediately — the customer quote page shows prices straight away.
    releasedAt: new Date().toISOString(),
  })

  const { data, error } = await supabase
    .from('painting_measurements')
    .insert(row)
    .select('id, public_token, estimate_token')
    .single()

  if (error) {
    return Response.json(
      { ok: false, error: 'save_failed', detail: error.message },
      { status: 200 },
    )
  }

  // Pre-warm the AI repaint preview AFTER the response (a dashboard save is
  // released immediately, so this row is render-eligible) — by the time the
  // tradie or customer opens the quote the "after" image is already cached.
  // Best-effort and CAS-guarded; never throws.
  const publicToken = data.public_token as string
  after(() => generatePaintAfterImage(publicToken))

  return Response.json(
    {
      ok: true,
      id: data.id as string,
      public_token: data.public_token as string,
      estimate_token: data.estimate_token as string,
    },
    { status: 200 },
  )
}

export async function GET(req: Request) {
  const auth = await userAndTenantFromBearer(req)
  if (!auth) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let q = supabase
    .from('painting_measurements')
    .select(
      // estimate_token is the tradie capability link (/p/…) — safe here
      // because this list is bearer-authed and tenant-scoped (the owner is
      // exactly who the token belongs to).
      'id, address, postcode, state, customer_name, source, scopes, floor_area_m2, total_area_m2, confidence, better_inc_gst, routing, public_token, estimate_token, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(100)

  q = auth.tenantId ? q.eq('tenant_id', auth.tenantId) : q.eq('created_by', auth.userId)

  const { data, error } = await q
  if (error) {
    return Response.json({ ok: false, error: 'list_failed', detail: error.message }, { status: 200 })
  }
  return Response.json({ ok: true, jobs: data ?? [] }, { status: 200 })
}
