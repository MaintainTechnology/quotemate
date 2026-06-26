// POST /api/tenant/trades — reconcile a tenant's trade portfolio.
//
// Auth: Bearer <supabase-access-token>, same pattern as /api/tenant/me.
// Resolves the tenant by owner_user_id so the caller can only change
// their own row.
//
// Body: { trades: Array<'electrical' | 'plumbing'> }  (length 1..2)
//
// Behaviour: idempotent reconcile against the current tenants.trades.
//   • Adds   = desired - current  → insert pricing_book row + enable
//                                    easy-5 service offerings for each.
//   • Drops  = current - desired  → delete pricing_book row + disable
//                                    service offerings for each.
//   • Tenant row update           → tenants.trades = desired, and
//                                    tenants.trade = desired[0] (legacy
//                                    scalar back-compat).
//   • Vapi PATCH                  → update first-message + system prompt
//                                    in place (non-fatal: assistant
//                                    keeps working with the old prompt
//                                    if Vapi is down). Stubbed when
//                                    VAPI_PROVISIONING_ENABLED!=true.
//
// Response shape mirrors /api/onboard/activate's success envelope so the
// dashboard can treat the two interchangeably.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { defaultsForTrade } from '@/lib/onboard/schema'
import { updateVapiAssistant } from '@/lib/vapi/update-assistant'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BodySchema = z.object({
  trades: z
    .array(z.enum(['electrical', 'plumbing']))
    .min(1, 'At least one trade is required')
    .max(2, 'Only electrical + plumbing are supported in v1'),
})

async function userFromBearer(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

export async function POST(req: Request) {
  const user = await userFromBearer(req)
  if (!user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: 'validation_failed',
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }
  // Deduplicate in case the client sent ['electrical','electrical'].
  const desired = Array.from(new Set(parsed.data.trades)) as Array<
    'electrical' | 'plumbing'
  >

  // ── 1. Load tenant ───────────────────────────────────────────────
  const { data: tenant, error: tErr } = await supabase
    .from('tenants')
    .select(
      'id, business_name, trade, trades, vapi_assistant_id, state',
    )
    .eq('owner_user_id', user.id)
    .maybeSingle()
  if (tErr) {
    return Response.json({ ok: false, error: tErr.message }, { status: 500 })
  }
  if (!tenant) {
    return Response.json({ ok: false, error: 'no_tenant' }, { status: 404 })
  }

  // The tenant's full trade portfolio — may include non-labour FEATURE
  // trades (painting, roofing, solar, …) the tradie activated via the
  // dashboard feature tabs / plan tier / admin. This endpoint reconciles
  // only the LABOUR trades and must preserve feature trades verbatim, so
  // saving electrical/plumbing never deactivates painting.
  const current: string[] =
    Array.isArray(tenant.trades) && tenant.trades.length > 0
      ? (tenant.trades as string[])
      : tenant.trade
        ? [tenant.trade as string]
        : []

  const LABOUR_TRADES = ['electrical', 'plumbing']
  const isLabour = (t: string) => LABOUR_TRADES.includes(t)
  const preservedFeatureTrades = current.filter((t) => !isLabour(t))

  const desiredSet = new Set<string>(desired)
  const toAdd = desired.filter((t) => !current.includes(t))
  // Remove only the LABOUR trades the tradie deselected — never a feature trade.
  const toRemove = current.filter((t) => isLabour(t) && !desiredSet.has(t))

  // The portfolio we'll persist: the desired labour trades plus every
  // preserved feature trade (deduped, labour trades first for a stable scalar).
  const nextTrades = Array.from(new Set([...desired, ...preservedFeatureTrades]))

  // ── 2. Fast path: no labour-trade change ─────────────────────────
  if (toAdd.length === 0 && toRemove.length === 0) {
    return Response.json({
      ok: true,
      tenantId: tenant.id,
      trades: nextTrades,
      added: [],
      removed: [],
      noop: true,
    })
  }

  // ── 3. Add new trades ────────────────────────────────────────────
  // For each new trade we need a pricing_book row. We seed it by copying
  // the tradie's existing electrical/plumbing rates (so labour stays
  // consistent across trades by default) and falling back to
  // defaultsForTrade when no existing row is available. The dashboard's
  // Pricing tab lets them split rates per trade afterwards.
  let templateRates: {
    hourly_rate: number | null
    call_out_minimum: number | null
    default_markup_pct: number | null
    apprentice_rate: number | null
    senior_rate: number | null
    after_hours_multiplier: number | null
    min_labour_hours: number | null
    risk_buffer_pct: number | null
    gst_registered: boolean | null
    licence_state: string | null
    licence_type: string | null
    licence_number: string | null
    licence_expiry: string | null
  } | null = null
  if (toAdd.length > 0) {
    const { data: existingBook } = await supabase
      .from('pricing_book')
      .select(
        'hourly_rate, call_out_minimum, default_markup_pct, apprentice_rate, senior_rate, after_hours_multiplier, min_labour_hours, risk_buffer_pct, gst_registered, licence_state, licence_type, licence_number, licence_expiry',
      )
      .eq('tenant_id', tenant.id)
      .limit(1)
      .maybeSingle()
    templateRates = existingBook ?? null

    const rows = toAdd.map((t) => {
      const d = defaultsForTrade(t)
      return {
        tenant_id: tenant.id,
        trade: t,
        hourly_rate: templateRates?.hourly_rate ?? null,
        call_out_minimum: templateRates?.call_out_minimum ?? null,
        default_markup_pct: templateRates?.default_markup_pct ?? null,
        apprentice_rate: templateRates?.apprentice_rate ?? d.apprentice_rate,
        senior_rate: templateRates?.senior_rate ?? d.senior_rate,
        after_hours_multiplier:
          templateRates?.after_hours_multiplier ?? d.after_hours_multiplier,
        min_labour_hours: templateRates?.min_labour_hours ?? d.min_labour_hours,
        risk_buffer_pct: templateRates?.risk_buffer_pct ?? d.risk_buffer_pct,
        gst_registered: templateRates?.gst_registered ?? true,
        // Licence fields are per-tradie not per-trade today; copy whatever
        // the existing book has. Future work: dedicated tenant_licences table.
        licence_state: templateRates?.licence_state ?? tenant.state ?? null,
        licence_type: templateRates?.licence_type ?? null,
        licence_number: templateRates?.licence_number ?? null,
        licence_expiry: templateRates?.licence_expiry ?? null,
      }
    })

    // We deliberately do NOT use `.upsert(..., { onConflict: 'tenant_id,trade' })`
    // here. Migration 015 created `pricing_book_tenant_trade_unique` as a
    // PARTIAL index (`WHERE tenant_id is not null`). PostgREST cannot infer
    // a partial unique index for ON CONFLICT (it has no way to emit the
    // matching WHERE predicate), so the upsert fails at runtime with
    // "there is no unique or exclusion constraint matching the ON CONFLICT
    // specification". Migration 024 makes the index non-partial, but this
    // route must keep working even on databases where 024 hasn't run yet.
    //
    // Idempotent strategy without conflict-target inference:
    //   1. Read which of the toAdd trades already have a pricing_book row.
    //   2. Insert only the genuinely-missing rows. An already-present row
    //      (stale state, double-submit, or a prior partial failure) is
    //      LEFT AS-IS — re-adding a trade must never clobber the rates the
    //      tradie already configured for it.
    //   3. Swallow a 23505 unique-violation as success: it just means a
    //      concurrent request inserted the row first. Re-adding the trade
    //      is still satisfied.
    const { data: existingPb } = await supabase
      .from('pricing_book')
      .select('trade')
      .eq('tenant_id', tenant.id)
      .in('trade', toAdd)
    const alreadyHavePb = new Set(
      (existingPb ?? []).map((r) => r.trade as string),
    )
    const rowsToInsert = rows.filter((r) => !alreadyHavePb.has(r.trade))

    if (rowsToInsert.length > 0) {
      const { error: pbErr } = await supabase
        .from('pricing_book')
        .insert(rowsToInsert)
      // 23505 = unique_violation: a concurrent request beat us to it. The
      // row exists, which is exactly the post-condition we wanted.
      if (pbErr && (pbErr as { code?: string }).code !== '23505') {
        return Response.json(
          { ok: false, error: `pricing_book insert failed: ${pbErr.message}` },
          { status: 500 },
        )
      }
    }

    // Seed service offerings for each added trade. Core easy-5 rows
    // (default_enabled = true) land enabled; opt-in extras from
    // migration 021 (default_enabled = false) land disabled so the
    // tradie actively ticks the additional services they perform.
    const { data: assemblies } = await supabase
      .from('shared_assemblies')
      .select('id, default_enabled')
      .in('trade', toAdd)
    if (assemblies && assemblies.length > 0) {
      const offeringRows = assemblies.map((a) => ({
        tenant_id: tenant.id,
        assembly_id: a.id,
        enabled: (a as { default_enabled: boolean | null }).default_enabled ?? true,
      }))
      await supabase
        .from('tenant_service_offerings')
        .upsert(offeringRows, { onConflict: 'tenant_id,assembly_id' })
    }

    // Seed an empty tenant_licences row for each added trade so the
    // dashboard form has somewhere to land the licence details once
    // the tradie fills them in. licence_state defaults to the tenant's
    // primary state — most tradies operate in one state per trade.
    const licenceRows = toAdd.map((t) => ({
      tenant_id: tenant.id,
      trade: t,
      licence_state: tenant.state ?? null,
    }))
    await supabase
      .from('tenant_licences')
      .upsert(licenceRows, { onConflict: 'tenant_id,trade' })
  }

  // ── 4. Remove dropped trades ─────────────────────────────────────
  // Pricing book row: delete. It's pure configuration — re-adding the
  // trade later just inserts a fresh row (defaults will rebuild it).
  // Quotes don't reference pricing_book rows directly today, so this
  // is safe. Future versioning work (`pricing_book_version_id` from
  // CLAUDE.md conventions) would change this to a soft-delete.
  if (toRemove.length > 0) {
    await supabase
      .from('pricing_book')
      .delete()
      .eq('tenant_id', tenant.id)
      .in('trade', toRemove)

    // Disable service offerings for the removed trade's assemblies.
    // Soft-disable (set enabled=false) rather than delete so the tradie
    // can re-add the trade later and find their old toggle state intact.
    const { data: droppedAssemblies } = await supabase
      .from('shared_assemblies')
      .select('id')
      .in('trade', toRemove)
    if (droppedAssemblies && droppedAssemblies.length > 0) {
      const ids = droppedAssemblies.map((a) => a.id)
      await supabase
        .from('tenant_service_offerings')
        .update({ enabled: false })
        .eq('tenant_id', tenant.id)
        .in('assembly_id', ids)
    }

    // Remove the per-trade licence row(s) for the dropped trade. Hard
    // delete here matches pricing_book: licences are pure config, easy
    // to re-enter if the trade comes back.
    await supabase
      .from('tenant_licences')
      .delete()
      .eq('tenant_id', tenant.id)
      .in('trade', toRemove)
  }

  // ── 5. Update tenants row ────────────────────────────────────────
  // Persist the full portfolio (labour + preserved feature trades). Keep
  // `trade` (scalar) in sync with the primary labour trade for back-compat.
  const { error: tenantUpdErr } = await supabase
    .from('tenants')
    .update({
      trades: nextTrades,
      trade: desired[0],
    })
    .eq('id', tenant.id)
  if (tenantUpdErr) {
    return Response.json(
      { ok: false, error: `tenants update failed: ${tenantUpdErr.message}` },
      { status: 500 },
    )
  }

  // ── 6. Refresh the Vapi assistant prompt ─────────────────────────
  // Non-fatal: if Vapi is down or the assistant doesn't exist yet
  // (legacy tenants pre-provision), the data layer changes still hold.
  // We surface the failure in the response so the UI can show "AI
  // receptionist will update on next inbound call" rather than failing
  // the whole request.
  let vapiWarning: string | undefined
  if (tenant.vapi_assistant_id) {
    const vapiRes = await updateVapiAssistant({
      assistantId: tenant.vapi_assistant_id,
      businessName: tenant.business_name,
      trades: nextTrades,
    })
    if (!vapiRes.ok) {
      vapiWarning = `AI assistant prompt refresh failed: ${vapiRes.reason}. Old prompt remains active.`
    }
  } else {
    vapiWarning =
      'No Vapi assistant linked to this tenant yet — prompt refresh skipped. Run retry-provision to create the assistant.'
  }

  return Response.json({
    ok: true,
    tenantId: tenant.id,
    trades: nextTrades,
    added: toAdd,
    removed: toRemove,
    warning: vapiWarning,
  })
}
