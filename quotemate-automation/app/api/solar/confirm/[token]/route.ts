// ════════════════════════════════════════════════════════════════════
// POST /api/solar/confirm/[token] — the manual tradie release step.
//
// As of docs/strategy.md v12 (2026-06-16) a CLEAN solar estimate is
// auto-released to the customer at creation time (Path B — see
// lib/solar/release.ts::autoReleaseSolarEstimate). This route remains for
//   • a FLAGGED estimate that the tradie has re-drafted clean and now
//     wants to release (auto-release skips flagged rows), and
//   • idempotent re-confirms (already-released → no-op).
//
// Confirming stamps confirmed_at on the solar_estimates row, which is what
// canShowPrices() + solarPayRedirectTarget() unlock against. A flagged
// estimate (guardrail_flags non-empty) still cannot be confirmed — the
// tradie must adjust the numbers (clearing the flags on re-draft) first.
//
// Next 16: params is a Promise (await it). Bearer auth required.
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import {
  confirmEligibility,
  sendCustomerSolarQuote,
  pushSolarLeadToPylon,
} from '@/lib/solar/release'
import { pushSolarLeadToOpenSolar } from '@/lib/solar/opensolar-leadpush'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'invalid_token' }, { status: 400 })
  }

  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const accessToken = auth.slice(7).trim()
  const supabase = getSupabase()
  const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: row, error } = await supabase
    .from('solar_estimates')
    .select(
      'id, tenant_id, public_token, intake_id, routing, address, state, postcode, confirmed_at, guardrail_flags',
    )
    .eq('public_token', token)
    .maybeSingle()
  if (error || !row) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  const eligibility = confirmEligibility({
    guardrailFlags: (row.guardrail_flags as string[] | null) ?? [],
    alreadyConfirmedAt: (row.confirmed_at as string | null) ?? null,
  })
  if (!eligibility.ok) {
    return Response.json(
      { ok: false, error: eligibility.error },
      { status: eligibility.status },
    )
  }

  if (eligibility.stamp) {
    const confirmedAt = new Date().toISOString()
    const { error: updErr } = await supabase
      .from('solar_estimates')
      .update({ confirmed_at: confirmedAt })
      .eq('id', row.id)
    if (updErr) {
      return Response.json(
        { ok: false, error: 'confirm_failed' },
        { status: 500 },
      )
    }
    // First confirmation → text the customer their quote (PDF link +
    // best-effort MMS), after the response so confirm never blocks on the
    // SMS. No-op unless a customer mobile was captured at estimate time.
    after(() =>
      sendCustomerSolarQuote(supabase, {
        tenantId: (row.tenant_id as string | null) ?? null,
        publicToken: row.public_token as string,
        intakeId: (row.intake_id as string | null) ?? null,
        routing: (row.routing as string | null) ?? null,
      }),
    )
    // Pylon CRM lead push (premium quote §4.5) — first confirm only,
    // behind PYLON_ENABLED + the per-tenant allowlist. Fire-and-forget;
    // logged, never blocks confirm.
    after(() =>
      pushSolarLeadToPylon(supabase, {
        tenantId: (row.tenant_id as string | null) ?? null,
        publicToken: row.public_token as string,
        intakeId: (row.intake_id as string | null) ?? null,
        address: (row.address as string | null) ?? null,
        state: (row.state as string | null) ?? null,
        postcode: (row.postcode as string | null) ?? null,
      }),
    )
    // OpenSolar lead push (enrichment build 2026-06-13) — creates a real
    // OpenSolar contact + project for the address (with the customer's
    // quarterly bill as usage), so the tradie can design it in studio and
    // the OpenSolar tab can import it back as the premium proposal.
    // Behind OPENSOLAR_ENRICHMENT_ENABLED + the allowlist; idempotent.
    after(() =>
      pushSolarLeadToOpenSolar(supabase, {
        tenantId: (row.tenant_id as string | null) ?? null,
        publicToken: row.public_token as string,
        intakeId: (row.intake_id as string | null) ?? null,
        address: (row.address as string | null) ?? null,
        state: (row.state as string | null) ?? null,
        postcode: (row.postcode as string | null) ?? null,
      }),
    )
    return Response.json({ ok: true, confirmed_at: confirmedAt })
  }

  return Response.json({ ok: true, confirmed_at: row.confirmed_at })
}
