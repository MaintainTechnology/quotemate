// POST /api/tenant/trades/activate — a tradie turns ON a new trade from
// the dashboard (Account tab → Trades). Spec §10.
//
// Auth: Bearer <supabase-access-token> — resolves the tenant by
// owner_user_id, so a caller can only activate a trade on their own row.
//
// Body: { trade: string }  — the slug of an active, install/job-based
// trade (electrical, plumbing, or any loader-created trade).
//
// This is additive and SEPARATE from the electrical|plumbing reconcile
// route (POST /api/tenant/trades): that one is the v1 pilot toggle; this
// one activates an arbitrary trades-as-data trade and never removes one
// (§11 covers retirement). Keeping them apart means the new-trade path
// carries zero regression risk to the live pilot toggle.
//
// §10 steps 1-3 (append trades[], seed pricing_book from
// trade_pricing_defaults, seed tenant_service_offerings) run ATOMICALLY
// inside the activate_trade_for_tenant() plpgsql function (migration 055)
// — if any step fails the whole activation rolls back. Step 4 (the Vapi
// re-provision) runs here, after the data layer is committed: it is
// external and non-fatal (§9 rule 14), so a Vapi outage never blocks the
// trade going live in the quote pipeline.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { updateVapiAssistant } from '@/lib/vapi/update-assistant'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BodySchema = z.object({
  trade: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, 'invalid trade slug'),
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
  const trade = parsed.data.trade

  // ── Resolve the caller's tenant ──────────────────────────────────
  const { data: tenant, error: tErr } = await supabase
    .from('tenants')
    .select('id, business_name, vapi_assistant_id')
    .eq('owner_user_id', user.id)
    .maybeSingle()
  if (tErr) {
    return Response.json({ ok: false, error: tErr.message }, { status: 500 })
  }
  if (!tenant) {
    return Response.json({ ok: false, error: 'no_tenant' }, { status: 404 })
  }

  // ── §10 steps 1-3 — atomic activation via the migration-055 fn ───
  const { data: result, error: rpcErr } = await supabase.rpc(
    'activate_trade_for_tenant',
    { p_tenant_id: tenant.id, p_trade: trade },
  )
  if (rpcErr) {
    // The function raises a plain-text reason (unknown/inactive trade, no
    // pricing defaults, etc.) — surface it so the dashboard can show it.
    return Response.json(
      { ok: false, error: 'activation_failed', message: rpcErr.message },
      { status: 400 },
    )
  }

  // ── §10 step 4 — refresh the Vapi assistant (non-fatal) ──────────
  // Re-read the trade list so the Voice prompt covers the new trade.
  let vapiWarning: string | undefined
  const { data: fresh } = await supabase
    .from('tenants')
    .select('trades')
    .eq('id', tenant.id)
    .maybeSingle()
  const trades = (fresh?.trades as string[] | null) ?? [trade]
  if (tenant.vapi_assistant_id) {
    const vapiRes = await updateVapiAssistant({
      assistantId: tenant.vapi_assistant_id,
      businessName: tenant.business_name,
      trades,
    })
    if (!vapiRes.ok) {
      vapiWarning = `AI assistant prompt refresh failed: ${vapiRes.reason}. The trade is live for quotes; the Voice agent updates on the next provision.`
    }
  } else {
    vapiWarning =
      'No Vapi assistant linked yet — Voice prompt refresh skipped. The trade is live for SMS + quote drafting.'
  }

  return Response.json({
    ok: true,
    tenantId: tenant.id,
    trade,
    trades,
    result,
    warning: vapiWarning,
  })
}
