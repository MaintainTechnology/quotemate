// ════════════════════════════════════════════════════════════════════
// POST /api/solar/confirm/[token] — the forced tradie review step.
//
// No solar estimate auto-sends. The tradie reviews the drafted tiers and
// confirms; that stamps confirmed_at on the solar_estimates row, which is
// what canShowPrices() + solarPayRedirectTarget() unlock against. A
// flagged estimate (guardrail_flags non-empty) cannot be confirmed — the
// tradie must adjust the numbers (clearing the flags on re-draft) first.
//
// Next 16: params is a Promise (await it). Bearer auth required.
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export type ConfirmEligibilityInput = {
  guardrailFlags: string[]
  alreadyConfirmedAt: string | null
}

export type ConfirmEligibilityResult =
  | { ok: true; stamp: boolean }
  | { ok: false; status: number; error: string }

/**
 * PURE — decide whether this estimate may be confirmed.
 *  • guardrail flags present → 409, cannot confirm
 *  • already confirmed       → ok, stamp:false (idempotent no-op)
 *  • clean + unconfirmed     → ok, stamp:true
 */
export function confirmEligibility(
  input: ConfirmEligibilityInput,
): ConfirmEligibilityResult {
  if (input.guardrailFlags.length > 0) {
    return {
      ok: false,
      status: 409,
      error:
        'This estimate has open checks (guardrail flags). Adjust the tiers and re-draft before confirming.',
    }
  }
  if (input.alreadyConfirmedAt) return { ok: true, stamp: false }
  return { ok: true, stamp: true }
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
    .select('id, tenant_id, confirmed_at, guardrail_flags')
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
    return Response.json({ ok: true, confirmed_at: confirmedAt })
  }

  return Response.json({ ok: true, confirmed_at: row.confirmed_at })
}
