// GET /api/tenant/solar
//
// Returns the tradie's most recent solar estimates for the dashboard Solar
// tab. Mirrors /api/tenant/chats exactly: Bearer auth → resolve tenant by
// owner_user_id → query solar_estimates scoped to that tenant_id (newest
// first) → two-hop join to intakes for the customer name (which lives in
// intakes.caller JSONB, not on the solar_estimates row).
//
// The deterministic engine output is stored across separate jsonb columns
// (price / sizing); we keep the payload lean by mapping each row to the
// view model the SolarTab renders (token, customer/address, headline kW +
// net price, derived status, guardrail count). Service-role client for
// reads (no tenant-scoped RLS policies shipped yet — app-layer filtering).

import { createClient } from '@supabase/supabase-js'
import {
  mapSolarEstimateRow,
  type SolarEstimateRawRow,
} from '@/lib/solar/dashboard-view'

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

// How many estimates to return per call — recency over archive, matching
// the Chats tab. Hits the solar_estimates_tenant_idx (tenant_id, created_at
// desc) composite index for an efficient scan.
const ESTIMATE_LIMIT = 50

export async function GET(req: Request) {
  const user = await userFromBearer(req)
  if (!user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  // Resolve the caller's tenant — same lookup as /api/tenant/me + /chats.
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id')
    .eq('owner_user_id', user.id)
    .maybeSingle()
  if (tenantErr) {
    return Response.json({ ok: false, error: tenantErr.message }, { status: 500 })
  }
  if (!tenant) {
    return Response.json({ ok: false, error: 'no_tenant' }, { status: 404 })
  }

  const appUrl = process.env.APP_URL ?? 'https://quote-mate-rho.vercel.app'

  // Pull the most recent N estimates for this tenant (newest first).
  const estRes = await supabase
    .from('solar_estimates')
    .select(
      'public_token, address, state, postcode, intake_id, confirmed_at, ' +
        'guardrail_flags, routing, created_at, price, sizing',
    )
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(ESTIMATE_LIMIT)

  if (estRes.error) {
    return Response.json({ ok: false, error: estRes.error.message }, { status: 500 })
  }
  const rows = (estRes.data ?? []) as unknown as SolarEstimateRawRow[]

  if (rows.length === 0) {
    return Response.json({ ok: true, estimates: [], shareUrl: `${appUrl.replace(/\/+$/, '')}/solar/${tenant.id}` })
  }

  // Two-hop join → intakes for the customer name (intakes.caller JSONB),
  // exactly as /api/tenant/me resolves caller names for its quote rows.
  const intakeIds = Array.from(
    new Set(
      rows
        .map((r) => r.intake_id)
        .filter((id): id is string => !!id),
    ),
  )
  const nameByIntake: Record<string, string | null> = {}
  if (intakeIds.length > 0) {
    const { data: intakes } = await supabase
      .from('intakes')
      .select('id, caller')
      .in('id', intakeIds)
    for (const i of intakes ?? []) {
      const caller = (i.caller as { name?: string } | null) ?? null
      nameByIntake[i.id as string] = caller?.name?.trim() || null
    }
  }

  const estimates = rows.map((row) =>
    mapSolarEstimateRow({
      row,
      customerName: row.intake_id ? nameByIntake[row.intake_id] ?? null : null,
      appUrl,
    }),
  )

  return Response.json({
    ok: true,
    estimates,
    // The customer-facing entry-form link the tradie shares.
    shareUrl: `${appUrl.replace(/\/+$/, '')}/solar/${tenant.id}`,
  })
}
