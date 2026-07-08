// ════════════════════════════════════════════════════════════════════
// POST /api/painting/edit/[token] — the tradie "edit the full quote" step.
//
// Token = painting_measurements.estimate_token (the tradie review link's
// capability, same trust model as /p/[token] + /api/painting/release: holding
// the unguessable estimate_token authorises the edit; the customer only ever
// has public_token). Lets the painter override each tier's customer-visible
// label, scope text, and inc-GST headline — before sending (the held-draft
// review) or AFTER release (the on-site revision: confirm measurements at the
// property, adjust the numbers, then resend the updated quote).
//
// Edits are applied by the pure lib/painting/edit.ts (ex-GST + band derive
// from the headline), persisted back onto painting_measurements.estimate
// (jsonb) + the denormalised better_inc_gst column. Both the customer page
// (/q/paint/[public_token]) and the customer SMS read estimate.price.tiers
// straight from the jsonb, so the edit flows through immediately; a price
// change re-mints the per-tier Stripe deposit sessions below.
//
// Refuses to edit an inspection-routed job (no priced tiers).
// Next 16: params is a Promise.
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { applyTierEdits, type PaintingTierEdit } from '@/lib/painting/edit'
import type { PaintingEstimate } from '@/lib/painting/types'
import { createPaintingCheckoutSessions } from '@/lib/stripe/painting-checkout'
import { expireCheckoutSession, type StripeLinks } from '@/lib/stripe/checkout'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60 // a priced edit re-mints per-tier Stripe sessions

const APP_BASE_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.quotemax.com.au'
).replace(/\/$/, '')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const TierEditSchema = z.object({
  tier: z.enum(['good', 'better', 'best']),
  label: z.string().trim().max(120).optional(),
  scope: z.string().trim().max(600).optional(),
  inc_gst: z.coerce.number().positive().max(1_000_000).optional(),
})

const BodySchema = z.object({
  tiers: z.array(TierEditSchema).min(1).max(3),
})

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'invalid_token' }, { status: 400 })
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
      { ok: false, error: 'validation_failed', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { data: row } = await supabase
    .from('painting_measurements')
    .select('id, estimate, released_at, paid_at, routing, public_token, address, stripe_links')
    .eq('estimate_token', token)
    .maybeSingle()
  if (!row) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  if (!row.estimate) {
    return Response.json({ ok: false, error: 'no_estimate' }, { status: 409 })
  }
  // Transacted prices are immutable: once a deposit is paid the tiers are the
  // record of what the customer paid against. (The old released_at gate used
  // to block this incidentally; post-release editing made an explicit paid
  // guard necessary.)
  if ((row.paid_at as string | null) != null) {
    return Response.json(
      {
        ok: false,
        error: 'cannot_edit_paid_quote',
        hint: 'The customer has already paid a deposit against these prices.',
      },
      { status: 409 },
    )
  }
  // An inspection-routed job has no priced tiers to edit.
  if ((row.routing as string | null) === 'inspection_required') {
    return Response.json(
      {
        ok: false,
        error: 'cannot_edit_inspection_quote',
        hint: 'This job is routed to an on-site measure — there are no priced tiers to edit.',
      },
      { status: 409 },
    )
  }
  const { estimate: nextEstimate, betterIncGst, changed, priceChanged } = applyTierEdits(
    row.estimate as PaintingEstimate,
    parsed.data.tiers as PaintingTierEdit[],
  )

  if (!changed) {
    return Response.json({ ok: true, changed: false, public_token: row.public_token })
  }

  const updateBody: Record<string, unknown> = {
    estimate: nextEstimate,
    better_inc_gst: betterIncGst,
  }

  // A price change invalidates the per-tier Stripe deposit sessions (their
  // unit_amount was baked from the OLD inc-GST). On a released quote the
  // customer already HOLDS the old links (SMS /r short-links), so besides
  // regenerating we must EXPIRE the replaced sessions — an open Checkout tab
  // must never complete at a price the tradie just changed. A Stripe miss
  // clears the links (the customer page falls back to the "contact to book"
  // placeholder) rather than ever leaving a stale payable amount.
  if (priceChanged) {
    let freshLinks: StripeLinks = {}
    try {
      freshLinks = await createPaintingCheckoutSessions({
        estimate: nextEstimate,
        token: row.public_token as string,
        address: (row.address as string | null) ?? 'your property',
        appUrl: APP_BASE_URL,
      })
    } catch (e) {
      console.warn(
        '[painting/edit] deposit session regen failed — links cleared',
        e instanceof Error ? e.message : e,
      )
      freshLinks = {}
    }
    updateBody.stripe_links = freshLinks

    const oldLinks = (row.stripe_links ?? {}) as StripeLinks
    const replaced = Object.entries(oldLinks)
      .filter(([tier, url]) => typeof url === 'string' && url && url !== freshLinks[tier as keyof StripeLinks])
      .map(([, url]) => url as string)
    // Best-effort (expireCheckoutSession tolerates already-expired/paid).
    await Promise.allSettled(replaced.map((url) => expireCheckoutSession(url)))
  }

  const { error: updErr } = await supabase
    .from('painting_measurements')
    .update(updateBody)
    .eq('id', row.id)
  if (updErr) {
    return Response.json({ ok: false, error: 'update_failed' }, { status: 500 })
  }

  return Response.json({
    ok: true,
    changed: true,
    public_token: row.public_token,
    tiers: nextEstimate.price.tiers,
  })
}
