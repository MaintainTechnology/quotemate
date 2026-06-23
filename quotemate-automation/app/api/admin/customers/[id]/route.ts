// /api/admin/customers/[id] — per-tenant detail + non-Stripe mutations
// for the admin customer console. Admin-only on every method.
//
// GET   → full tenant profile (file_store_id stripped — server-only) plus
//         the tenant's admin_audit_log history, newest first (R8, R9).
// PATCH → discriminated mutations on the existing schema (R10/R11/R12):
//           { action: 'set_status',         status: 'active'|'suspended' }
//           { action: 'set_billing_exempt', exempt: boolean }
//           { action: 'update_trades',      trades: string[] }
//         Each writes an admin_audit_log row with before→after on success.
//
// Subscription/Stripe changes live in ./subscription/route.ts — they touch
// the money path and must NOT write the mirror columns directly.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { resolveAdminUserId } from '@/lib/admin-loader/route-auth'
import { writeAuditLog, listAuditForTenant } from '@/lib/admin/audit'
import { isKnownTrade } from '@/lib/admin/trades'
import { stampFeatureProvenance, clearFeatureProvenance } from '@/lib/features/access'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ─── GET /api/admin/customers/[id] ─────────────────────────────────
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const adminId = await resolveAdminUserId(supabase, req)
  if (!adminId) {
    return Response.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  const { id } = await params

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }
  if (!tenant) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  // file_store_id is server-only (mirrors /api/tenant/me) — never wire it out.
  const customer: Record<string, unknown> = { ...(tenant as Record<string, unknown>) }
  delete customer.file_store_id
  const audit = await listAuditForTenant(supabase, id)

  return Response.json({ ok: true, customer, audit })
}

// ─── PATCH /api/admin/customers/[id] ───────────────────────────────
const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set_status'), status: z.enum(['active', 'suspended']) }),
  z.object({ action: z.literal('set_billing_exempt'), exempt: z.boolean() }),
  z.object({
    action: z.literal('update_trades'),
    trades: z
      .array(z.string())
      .max(20)
      .refine((arr) => arr.every(isKnownTrade), { message: 'unknown trade slug' }),
  }),
])

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const adminId = await resolveAdminUserId(supabase, req)
  if (!adminId) {
    return Response.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  const { id } = await params

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = ActionSchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'validation_failed', fieldErrors: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

  const { data: tenant, error: loadErr } = await supabase
    .from('tenants')
    .select('id, business_name, status, billing_exempt, trade, trades')
    .eq('id', id)
    .maybeSingle()
  if (loadErr) {
    return Response.json({ ok: false, error: loadErr.message }, { status: 500 })
  }
  if (!tenant) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  // ── Suspend / reactivate ──────────────────────────────────────────
  if (body.action === 'set_status') {
    const before = (tenant.status as string | null) ?? null
    const next = body.status
    if (next === before) {
      return Response.json({ ok: true, status: next }) // no-op, no audit row
    }
    const { error } = await supabase
      .from('tenants')
      .update({ status: next })
      .eq('id', id)
    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 500 })
    }
    await writeAuditLog(supabase, {
      adminUserId: adminId,
      tenantId: id,
      action: next === 'suspended' ? 'suspend' : 'reactivate',
      before: { status: before },
      after: { status: next },
    })
    return Response.json({ ok: true, status: next })
  }

  // ── Toggle billing_exempt (comp / un-comp) ────────────────────────
  if (body.action === 'set_billing_exempt') {
    const before = (tenant.billing_exempt as boolean | null) ?? false
    const next = body.exempt
    const { error } = await supabase
      .from('tenants')
      .update({ billing_exempt: next })
      .eq('id', id)
    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 500 })
    }
    await writeAuditLog(supabase, {
      adminUserId: adminId,
      tenantId: id,
      action: 'set_billing_exempt',
      before: { billing_exempt: before },
      after: { billing_exempt: next },
    })
    return Response.json({ ok: true, billing_exempt: next })
  }

  // ── Enable / disable trades (R12) ─────────────────────────────────
  // trades[] is the unconstrained text[] that drives dashboard tabs.
  // The scalar `trade` is a FK to trades(name) (mig 051) and is NOT NULL,
  // so we only ever set it to a value confirmed in the trades registry —
  // never null, never an unregistered slug. If the current scalar is still
  // selected we keep it; otherwise we point it at the first selected trade
  // that exists in the registry; if none qualify (e.g. trades cleared to
  // empty) we leave the existing (already-valid) scalar untouched.
  const beforeTrades = Array.isArray(tenant.trades) ? (tenant.trades as string[]) : []
  const currentScalar = (tenant.trade as string | null) ?? null
  const newTrades: string[] = Array.from(new Set(body.trades))

  let newScalar = currentScalar
  if (!(currentScalar && newTrades.includes(currentScalar)) && newTrades.length > 0) {
    const { data: reg } = await supabase
      .from('trades')
      .select('name')
      .in('name', newTrades)
    const registry = new Set((reg ?? []).map((r) => r.name as string))
    const candidate = newTrades.find((t) => registry.has(t))
    newScalar = candidate ?? currentScalar
  }

  const updatePayload: Record<string, unknown> = { trades: newTrades }
  if (newScalar) updatePayload.trade = newScalar

  const { error } = await supabase.from('tenants').update(updatePayload).eq('id', id)
  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }
  await writeAuditLog(supabase, {
    adminUserId: adminId,
    tenantId: id,
    action: 'update_trades',
    before: { trades: beforeTrades, trade: currentScalar },
    after: { trades: newTrades, trade: newScalar },
  })

  // Record feature provenance (migration 138) so the plan-tier seeding layer
  // never strips a slug an admin granted by hand. Newly-added slugs become
  // sticky 'manual' grants; removed slugs lose their provenance row. Best-
  // effort — a provenance write must not fail the (committed) trades update.
  const addedSlugs = newTrades.filter((t) => !beforeTrades.includes(t))
  const removedSlugs = beforeTrades.filter((t) => !newTrades.includes(t))
  await stampFeatureProvenance(supabase, {
    tenantId: id,
    features: addedSlugs,
    source: 'manual',
    updatedBy: adminId,
  })
  await clearFeatureProvenance(supabase, id, removedSlugs)

  return Response.json({ ok: true, trades: newTrades, trade: newScalar })
}
