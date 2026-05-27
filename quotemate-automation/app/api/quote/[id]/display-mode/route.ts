// PATCH /api/quote/[id]/display-mode
//
// Phase B — per-quote override of the customer-facing display mode (mig 073).
// Sets quotes.display_mode to 'itemised' | 'summary' | null (null = inherit
// the tenant preference on pricing_book.quote_display, mig 071).
//
// Why a dedicated route, not /api/quote/[id]/edit:
//   • Display mode is a pure presentation flag — no money math, no Stripe
//     link regen, no grounding revalidation. The edit route runs all of
//     those because it's designed for line-item edits; for a one-column
//     flip we want a lightweight surgical PATCH.
//   • The tradie has to be able to flip this AFTER a quote is paid (e.g.
//     a tradie reviewing their own copy of a past quote, or fixing a
//     mis-toggled default on an in-flight thread). The edit route refuses
//     once paid_at is set, by design. This route deliberately allows it
//     because flipping the display label doesn't change a single number.
//
// Auth: Bearer <supabase-access-token> on the caller; the route resolves
// the caller's tenant via tenants.owner_user_id and refuses the PATCH
// unless quote.tenant_id matches.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// `null` = clear the override, fall back to the tenant preference.
// 'itemised' / 'summary' = explicit override.
const BodySchema = z.object({
  display_mode: z.union([
    z.enum(['itemised', 'summary']),
    z.null(),
  ]),
})

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: quoteId } = await params
  if (!quoteId) {
    return Response.json({ error: 'missing_quote_id' }, { status: 400 })
  }

  // ─── Auth: who is the caller? ──
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const token = auth.slice(7).trim()
  if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData.user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id

  // ─── Parse body ──
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      {
        error: 'invalid_payload',
        details: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }
  const nextValue = parsed.data.display_mode

  // ─── Ownership check: caller's tenant must match quote.tenant_id ──
  const { data: quote, error: qErr } = await supabase
    .from('quotes')
    .select('id, tenant_id, display_mode')
    .eq('id', quoteId)
    .maybeSingle()
  if (qErr) return Response.json({ error: qErr.message }, { status: 500 })
  if (!quote) return Response.json({ error: 'not_found' }, { status: 404 })
  if (!quote.tenant_id) {
    // Legacy pre-v6 quote with no tenant scoping — nobody owns it in the
    // multi-tenant sense. Refuse the PATCH rather than orphan-edit.
    return Response.json({ error: 'unscoped_quote' }, { status: 403 })
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, owner_user_id')
    .eq('id', quote.tenant_id)
    .maybeSingle()
  if (!tenant) return Response.json({ error: 'tenant_missing' }, { status: 404 })
  if (tenant.owner_user_id !== userId) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  // ─── Apply ──
  const { data: updated, error: uErr } = await supabase
    .from('quotes')
    .update({ display_mode: nextValue })
    .eq('id', quoteId)
    .eq('tenant_id', tenant.id) // belt-and-braces — same condition as the auth check
    .select('id, display_mode')
    .maybeSingle()
  if (uErr) return Response.json({ error: uErr.message }, { status: 500 })
  if (!updated) {
    return Response.json({ error: 'update_failed' }, { status: 500 })
  }

  return Response.json({
    ok: true,
    quote_id: updated.id,
    display_mode: updated.display_mode ?? null,
    previous_display_mode: quote.display_mode ?? null,
  })
}
