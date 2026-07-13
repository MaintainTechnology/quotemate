// PATCH /api/quote/[id]/tier
//
// Set which single tier (good/better/best) a quote sends as. The tradie picks
// on the dashboard quote viewer BEFORE sending; roofing defaults to 'better'
// (Re-roof) but the tiers are genuinely different jobs (Patch / Re-roof /
// Upgrade), so the tradie needs to choose.
//
// This is a VIEW choice, not a re-price: the full good/better/best jsonb is
// untouched. In 'single' tier mode (the platform default) resolveVisibleTiers
// renders exactly selected_tier across the SMS, the email PDF, and /q/[token],
// so setting this column is all that's needed. We also recompute the headline
// total_inc_gst (mirrors /api/quote/[id]/edit) and invalidate the cached PDF so
// the next download/send regenerates for the chosen tier; the live HTML preview
// reads the row directly, so it updates immediately.
//
// Auth: bearer token (Clerk or legacy Supabase), owner-only — mirrors /send + /edit.

import { createClient } from '@supabase/supabase-js'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import { resolveTierSelection, type PricedTier } from '@/lib/quote/select-tier'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: quoteId } = await params
  if (!quoteId) {
    return Response.json({ ok: false, error: 'missing_quote_id' }, { status: 400 })
  }

  let body: { tier?: unknown } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    /* malformed body → resolveTierSelection rejects below */
  }

  // ─── Auth (dual-auth: Clerk OR legacy Supabase token) ──
  const resolved = await resolveTenantRequest(supabase, req, 'id')
  if (!resolved) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const tenant = resolved.tenant as { id: string } | null

  // ─── Load quote + verify ownership + editability ──
  const { data: quote, error: qErr } = await supabase
    .from('quotes')
    .select('id, tenant_id, paid_at, needs_inspection, good, better, best')
    .eq('id', quoteId)
    .maybeSingle()
  if (qErr) return Response.json({ ok: false, error: qErr.message }, { status: 500 })
  if (!quote) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  if (!quote.tenant_id) {
    return Response.json({ ok: false, error: 'unscoped_quote' }, { status: 403 })
  }
  if (!tenant || quote.tenant_id !== tenant.id) {
    return Response.json({ ok: false, error: 'not_owner' }, { status: 403 })
  }
  if (quote.paid_at) {
    return Response.json({ ok: false, error: 'quote_already_paid' }, { status: 409 })
  }
  if (quote.needs_inspection) {
    return Response.json(
      {
        ok: false,
        error: 'inspection_quote',
        hint: 'Inspection-required quotes have no tier to choose — they route to the flat $99 site visit.',
      },
      { status: 409 },
    )
  }

  // GST treatment for the recomputed headline. Mirrors the edit route: one
  // pricing_book row per tenant carries gst_registered (defaults to registered).
  const { data: pb } = await supabase
    .from('pricing_book')
    .select('gst_registered')
    .eq('tenant_id', quote.tenant_id)
    .limit(1)
    .maybeSingle()
  const gstRegistered = (pb?.gst_registered ?? true) as boolean

  const result = resolveTierSelection({
    tier: body.tier,
    tiers: {
      good: quote.good as PricedTier,
      better: quote.better as PricedTier,
      best: quote.best as PricedTier,
    },
    gstRegistered,
  })
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: 400 })
  }

  const { error: updErr } = await supabase
    .from('quotes')
    .update({
      selected_tier: result.selectedTier,
      total_inc_gst: result.totalIncGst,
      // Invalidate the cached customer PDF so the next download/send regenerates
      // for the newly chosen tier (the pdf_signature also captures visible tiers,
      // but nulling here is explicit and matches the edit route's invalidation).
      pdf_path: null,
      pdf_signature: null,
    })
    .eq('id', quoteId)
    .eq('tenant_id', tenant.id)
  if (updErr) {
    return Response.json(
      { ok: false, error: 'update_failed', detail: updErr.message },
      { status: 500 },
    )
  }

  return Response.json({ ok: true, selected_tier: result.selectedTier })
}
