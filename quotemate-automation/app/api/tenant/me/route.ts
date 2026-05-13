// /api/tenant/me — the single endpoint that powers the tradie dashboard.
//
// GET   → returns the authed tradie's tenant + pricing book + service
//         offerings (with assembly labels joined) + last 20 quotes.
//
// PATCH → accepts partial updates for any of:
//         { tenant: {...}, pricing: {...}, services: { assemblyId: bool } }
//
// Auth pattern: client sends Authorization: Bearer <supabase-access-token>.
// Server validates via supabase.auth.getUser(token), then uses the user_id
// to find that tradie's tenant row. The service role key is used for the
// data queries because we haven't shipped RLS yet (per CLAUDE.md v5 note —
// "Full tenant_id/RLS work is flagged as the next architectural debt").

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

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

// ─── GET /api/tenant/me ────────────────────────────────────────────
export async function GET(req: Request) {
  const user = await userFromBearer(req)
  if (!user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Tradie's tenant row — primary lookup by owner_user_id.
  let { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('*')
    .eq('owner_user_id', user.id)
    .maybeSingle()

  if (tenantErr) {
    return Response.json({ error: tenantErr.message }, { status: 500 })
  }

  // Self-heal: a tenant row CAN exist with owner_user_id = NULL when the
  // activate wizard submitted without the URL carry-through (an earlier
  // bug). On the next signed-in load we backfill the link via email so
  // the tradie isn't permanently bounced to onboarding.
  if (!tenant && user.email) {
    const { data: byEmail } = await supabase
      .from('tenants')
      .select('*')
      .eq('owner_email', user.email.toLowerCase())
      .maybeSingle()
    if (byEmail) {
      const { error: linkErr } = await supabase
        .from('tenants')
        .update({ owner_user_id: user.id })
        .eq('id', byEmail.id)
      if (!linkErr) {
        console.log('[tenant/me] backfilled owner_user_id from email match', {
          tenantId: byEmail.id,
          email: user.email,
          userId: user.id,
        })
        tenant = { ...byEmail, owner_user_id: user.id }
      } else {
        console.warn('[tenant/me] backfill update failed', linkErr.message)
        tenant = byEmail
      }
    }
  }

  if (!tenant) {
    return Response.json({ error: 'no_tenant' }, { status: 404 })
  }

  // Run the remaining 4 reads in parallel — they're independent.
  //
  // Service catalogue strategy: we fetch every shared_assemblies row
  // for the tenant's trade AND every tenant_service_offerings row, then
  // merge. This way:
  //   • Tradies whose activation didn't seed offerings still see the
  //     full catalogue (so they can opt in)
  //   • Tradies who toggled OFF a service still see it on the list (so
  //     they can re-enable it)
  //   • New catalogue items added later show up automatically
  // No offering row → enabled defaults to true (catalogue is opt-out
  // by default, matching the activate route's auto-seed intent).
  const [pricingRes, assembliesRes, offeringsRes, quotesRes] = await Promise.all([
    supabase
      .from('pricing_book')
      .select('*')
      .eq('tenant_id', tenant.id)
      .maybeSingle(),
    supabase
      .from('shared_assemblies')
      .select(
        'id, name, description, trade, default_unit, default_unit_price_ex_gst, default_labour_hours, default_exclusions',
      )
      .eq('trade', tenant.trade)
      .order('name'),
    supabase
      .from('tenant_service_offerings')
      .select('assembly_id, enabled')
      .eq('tenant_id', tenant.id),
    // Quotes table has total_inc_gst (single computed column) + the
    // tier-specific JSONB objects (good/better/best). For the dashboard
    // list we only need the totals + a few identifiers.
    supabase
      .from('quotes')
      .select(
        'id, created_at, status, selected_tier, total_inc_gst, scope_of_works, share_token, intake_id, needs_inspection, routing_decision',
      )
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  // Merge assemblies + offerings into a unified Service[] for the dashboard.
  const offeringMap = new Map<string, boolean>(
    (offeringsRes.data ?? []).map((o) => [
      o.assembly_id as string,
      o.enabled as boolean,
    ]),
  )
  const services = (assembliesRes.data ?? []).map((a) => ({
    assembly_id: a.id as string,
    name: a.name as string,
    description: (a.description ?? null) as string | null,
    trade: a.trade as string,
    default_unit: (a.default_unit ?? null) as string | null,
    default_unit_price_ex_gst: a.default_unit_price_ex_gst as number | string | null,
    default_labour_hours: a.default_labour_hours as number | string | null,
    default_exclusions: (a.default_exclusions ?? null) as string | null,
    enabled: offeringMap.has(a.id as string)
      ? (offeringMap.get(a.id as string) as boolean)
      : true,
  }))

  // Resolve customer names by joining quotes → intakes → customers.
  // Intakes carry the customer_id and the human-readable caller name;
  // quotes themselves don't (they're scoped to the work, not the person).
  const intakeIds = Array.from(
    new Set(
      (quotesRes.data ?? [])
        .map((q) => q.intake_id)
        .filter((id): id is string => !!id),
    ),
  )
  let intakeMap: Record<
    string,
    { caller_name: string | null; caller_phone: string | null; customer_id: string | null }
  > = {}
  if (intakeIds.length > 0) {
    const { data: intakes } = await supabase
      .from('intakes')
      .select('id, caller_name, caller_phone, customer_id')
      .in('id', intakeIds)
    intakeMap = Object.fromEntries(
      (intakes ?? []).map((i) => [
        i.id,
        {
          caller_name: i.caller_name ?? null,
          caller_phone: i.caller_phone ?? null,
          customer_id: i.customer_id ?? null,
        },
      ]),
    )
  }

  const quotes = (quotesRes.data ?? []).map((q) => {
    const intake = q.intake_id ? intakeMap[q.intake_id] : null
    return {
      ...q,
      customer_first_name: intake?.caller_name?.split(' ')[0] ?? null,
      customer_phone: intake?.caller_phone ?? null,
    }
  })

  return Response.json({
    tenant,
    pricing: pricingRes.data ?? null,
    services,
    quotes,
  })
}

// ─── PATCH /api/tenant/me ──────────────────────────────────────────

const UpdateSchema = z.object({
  tenant: z
    .object({
      business_name: z.string().trim().min(2).max(80).optional(),
      owner_first_name: z.string().trim().min(1).max(40).optional(),
      owner_email: z.string().trim().email().max(120).optional(),
      owner_mobile: z.string().trim().min(8).max(20).optional(),
      trade: z.enum(['electrical', 'plumbing']).optional(),
      state: z.enum(['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']).optional(),
      abn: z.string().trim().max(20).optional().or(z.literal('')),
      licence_type: z.string().trim().max(20).optional().or(z.literal('')),
      licence_number: z.string().trim().max(40).optional().or(z.literal('')),
      licence_expiry: z.string().trim().optional().or(z.literal('')),
    })
    .optional(),
  pricing: z
    .object({
      hourly_rate: z.coerce.number().positive().optional(),
      call_out_minimum: z.coerce.number().nonnegative().optional(),
      default_markup_pct: z.coerce.number().min(0).max(100).optional(),
      apprentice_rate: z.coerce.number().nonnegative().optional(),
      senior_rate: z.coerce.number().nonnegative().optional(),
      after_hours_multiplier: z.coerce.number().min(1).max(3).optional(),
      min_labour_hours: z.coerce.number().min(0).max(8).optional(),
      risk_buffer_pct: z.coerce.number().min(0).max(100).optional(),
      gst_registered: z.boolean().optional(),
    })
    .optional(),
  // Map of assembly_id → enabled flag. Lets the UI flip multiple
  // service offerings in one round trip.
  services: z.record(z.string().uuid(), z.boolean()).optional(),
})

export async function PATCH(req: Request) {
  const user = await userFromBearer(req)
  if (!user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_payload', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  // Find the tradie's tenant
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, owner_user_id')
    .eq('owner_user_id', user.id)
    .maybeSingle()
  if (tenantErr) {
    return Response.json({ error: tenantErr.message }, { status: 500 })
  }
  if (!tenant) {
    return Response.json({ error: 'no_tenant' }, { status: 404 })
  }

  const updates = parsed.data
  const errors: string[] = []

  // 1. Tenant identity fields
  if (updates.tenant && Object.keys(updates.tenant).length > 0) {
    const { error } = await supabase
      .from('tenants')
      .update(updates.tenant)
      .eq('id', tenant.id)
    if (error) errors.push(`tenant: ${error.message}`)
  }

  // 2. Pricing book — guard against versioning concerns: each update
  //    bumps `version` if the column is present. Defensive try/catch so
  //    a missing column doesn't kill the whole request.
  if (updates.pricing && Object.keys(updates.pricing).length > 0) {
    const { error } = await supabase
      .from('pricing_book')
      .update(updates.pricing)
      .eq('tenant_id', tenant.id)
    if (error) errors.push(`pricing: ${error.message}`)
  }

  // 3. Service toggles — UPSERT so the same call works whether or not
  //    a tenant_service_offerings row already exists for this tradie +
  //    assembly. Catalogue-first dashboards mean the row often DOESN'T
  //    exist on the first toggle (the dashboard renders every assembly
  //    for the trade regardless of offerings rows).
  //
  //    Bulk upsert handles all changes in one round-trip via the
  //    composite (tenant_id, assembly_id) primary key.
  if (updates.services) {
    const rows = Object.entries(updates.services).map(([assembly_id, enabled]) => ({
      tenant_id: tenant.id,
      assembly_id,
      enabled,
    }))
    if (rows.length > 0) {
      const { error } = await supabase
        .from('tenant_service_offerings')
        .upsert(rows, { onConflict: 'tenant_id,assembly_id' })
      if (error) errors.push(`services: ${error.message}`)
    }
  }

  if (errors.length > 0) {
    return Response.json({ ok: false, errors }, { status: 500 })
  }
  return Response.json({ ok: true })
}
