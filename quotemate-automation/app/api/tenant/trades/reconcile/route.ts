// POST /api/tenant/trades/reconcile — set a tenant's job-trade portfolio in
// ONE call from the Account-tab Trades section. This is the unified Save
// path: the dashboard sends the full set of trades the tradie wants ON, and
// this route reconciles against what they currently have.
//
// Auth: Bearer <supabase-access-token>; resolves the tenant by
// owner_user_id so a caller can only change their own row.
//
// Body: { trades: string[] }  — registry slugs (electrical, plumbing,
// painting, solar, commercial_painting, …), length >= 1.
//
// Behaviour:
//   • desired - current  → ACTIVATE via activate_trade_for_tenant() (the
//     same atomic RPC the per-trade Activate button uses): appends to
//     tenants.trades[], seeds pricing_book from trade_pricing_defaults, and
//     seeds tenant_service_offerings. This is what makes the trade's job
//     type genuinely live, not just a label.
//   • current - desired  → DEACTIVATE: disable that trade's service
//     offerings + drop its pricing_book / licence rows, then remove the slug
//     from tenants.trades[].
//   • Slugs NOT in the registry (legacy / non-job-based) are PRESERVED
//     untouched — this route only manages registered job-based trades.
//
// Only registered, active, job-based trades that carry a
// trade_pricing_defaults row are accepted (mirrors /available) — a trade
// the activation RPC would reject is refused up front with a clear error.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { updateVapiAssistant } from '@/lib/vapi/update-assistant'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BodySchema = z.object({
  trades: z
    .array(
      z
        .string()
        .trim()
        .min(2)
        .max(40)
        .regex(/^[a-z][a-z0-9_]*$/, 'invalid trade slug'),
    )
    .min(1, 'At least one trade is required')
    .max(20),
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

/** The set of trades a tenant may manage from the dashboard: registered,
 *  active, job-based, and carrying a trade_pricing_defaults row (without
 *  which activate_trade_for_tenant cannot seed the pricing_book). */
async function loadManageableTrades(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('trades')
    .select('name, trade_pricing_defaults(trade_id)')
    .eq('active', true)
    .eq('is_job_based', true)
  if (error) throw new Error(error.message)
  const set = new Set<string>()
  for (const t of data ?? []) {
    const defs = (t as { trade_pricing_defaults?: unknown[] }).trade_pricing_defaults
    if (Array.isArray(defs) && defs.length > 0) set.add((t as { name: string }).name)
  }
  return set
}

/** Disable offerings + drop pricing/licence config for a deactivated trade.
 *  Soft-disables service offerings (re-add later restores the toggles) and
 *  hard-deletes the pure-config pricing_book + licence rows, mirroring the
 *  v1 labour-reconcile route's removal path. */
async function deactivateTrade(tenantId: string, trade: string): Promise<void> {
  const { data: assemblies } = await supabase
    .from('shared_assemblies')
    .select('id')
    .eq('trade', trade)
  if (assemblies && assemblies.length > 0) {
    await supabase
      .from('tenant_service_offerings')
      .update({ enabled: false })
      .eq('tenant_id', tenantId)
      .in('assembly_id', assemblies.map((a) => (a as { id: string }).id))
  }
  await supabase.from('pricing_book').delete().eq('tenant_id', tenantId).eq('trade', trade)
  await supabase.from('tenant_licences').delete().eq('tenant_id', tenantId).eq('trade', trade)
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
  const desired = Array.from(new Set(parsed.data.trades))

  // ── Resolve tenant + the manageable registry ─────────────────────
  const { data: tenant, error: tErr } = await supabase
    .from('tenants')
    .select('id, business_name, trade, trades, vapi_assistant_id')
    .eq('owner_user_id', user.id)
    .maybeSingle()
  if (tErr) {
    return Response.json({ ok: false, error: tErr.message }, { status: 500 })
  }
  if (!tenant) {
    return Response.json({ ok: false, error: 'no_tenant' }, { status: 404 })
  }

  let manageable: Set<string>
  try {
    manageable = await loadManageableTrades()
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'registry_unavailable' },
      { status: 500 },
    )
  }

  // Every desired slug must be a manageable (activatable) trade.
  const unknown = desired.filter((t) => !manageable.has(t))
  if (unknown.length > 0) {
    return Response.json(
      {
        ok: false,
        error: 'unknown_trade',
        message: `Not activatable: ${unknown.join(', ')}. A trade must be registered, active, job-based and carry pricing defaults.`,
        unknown,
      },
      { status: 400 },
    )
  }

  const current: string[] = Array.isArray(tenant.trades)
    ? (tenant.trades as string[])
    : tenant.trade
      ? [tenant.trade as string]
      : []
  const desiredSet = new Set(desired)

  // Reconcile ONLY the managed (registry) trades; preserve everything else
  // (legacy / non-job-based slugs) verbatim.
  const managedOwned = current.filter((t) => manageable.has(t))
  const preserved = current.filter((t) => !manageable.has(t))
  const toActivate = desired.filter((t) => !current.includes(t))
  const toDeactivate = managedOwned.filter((t) => !desiredSet.has(t))

  // Persisted portfolio: desired managed trades + preserved non-managed ones.
  const nextTrades = Array.from(new Set([...desired, ...preserved]))

  // ── Fast path: nothing to change ─────────────────────────────────
  if (toActivate.length === 0 && toDeactivate.length === 0) {
    return Response.json({
      ok: true,
      tenantId: tenant.id,
      trades: nextTrades,
      activated: [],
      deactivated: [],
      noop: true,
    })
  }

  // ── Activate new trades (atomic RPC, the genuine activation) ──────
  for (const t of toActivate) {
    const { error: rpcErr } = await supabase.rpc('activate_trade_for_tenant', {
      p_tenant_id: tenant.id,
      p_trade: t,
    })
    if (rpcErr) {
      return Response.json(
        { ok: false, error: 'activation_failed', trade: t, message: rpcErr.message },
        { status: 400 },
      )
    }
  }

  // ── Deactivate removed trades ────────────────────────────────────
  for (const t of toDeactivate) {
    await deactivateTrade(tenant.id, t)
  }

  // ── Persist the authoritative portfolio ──────────────────────────
  // `trade` (scalar, FK to the trades registry) tracks the first desired
  // trade — always a registry-valid name since desired ⊆ manageable.
  const { error: updErr } = await supabase
    .from('tenants')
    .update({ trades: nextTrades, trade: desired[0] })
    .eq('id', tenant.id)
  if (updErr) {
    return Response.json(
      { ok: false, error: `tenants update failed: ${updErr.message}` },
      { status: 500 },
    )
  }

  // ── Refresh the Vapi assistant prompt (non-fatal) ────────────────
  let warning: string | undefined
  if (tenant.vapi_assistant_id) {
    const vapiRes = await updateVapiAssistant({
      assistantId: tenant.vapi_assistant_id as string,
      businessName: tenant.business_name as string,
      trades: nextTrades,
    })
    if (!vapiRes.ok) {
      warning = `AI assistant prompt refresh failed: ${vapiRes.reason}. Your trades are live for quotes; the Voice agent updates on the next provision.`
    }
  } else {
    warning =
      'No Vapi assistant linked yet — Voice prompt refresh skipped. Your trades are live for SMS + quote drafting.'
  }

  return Response.json({
    ok: true,
    tenantId: tenant.id,
    trades: nextTrades,
    activated: toActivate,
    deactivated: toDeactivate,
    warning,
  })
}
