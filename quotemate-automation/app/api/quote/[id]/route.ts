// DELETE /api/quote/[id]
//
// Tradie-only: permanently removes one of the tenant's drafted quotes from
// the dashboard list. Auth mirrors POST /api/quote/[id]/edit — Bearer
// <supabase-access-token>, and the caller's user id must match
// tenants.owner_user_id for the quote's tenant.
//
// Guard rails:
//   • paid quotes (paid_at set) are immutable — 409, same as edit. The check
//     is enforced ATOMICALLY on the delete statement (`.is('paid_at', null)`)
//     so a Stripe webhook landing between the load and the delete can't get
//     a just-paid quote hard-deleted (check-then-act race).
//   • every live Checkout Session in stripe_links (good/better/best/
//     inspection) is expired BEFORE the delete — a 'sent' quote's customer
//     SMS carries those URLs, and without expiry the customer could still
//     pay after the quote row is gone (orphaned charge: the webhook would
//     find no quote and ACK). Mirrors the edit route's expire-on-reprice.
//   • unscoped legacy quotes (tenant_id null) can't prove ownership — 403.
//   • hard delete is safe FK-wise: every FK referencing quotes is `on delete
//     cascade` (payments, quote_followup_events) or `on delete set null`
//     (solar_estimates.quote_id) — see sql/init.sql + migrations 039/100.

import { createClient } from '@supabase/supabase-js'
import { expireCheckoutSession } from '@/lib/stripe/checkout'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: quoteId } = await params

  // ─── Auth ───────────────────────────────────────────────────
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const token = auth.slice(7).trim()
  if (!token) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData.user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id

  // ─── Load + authorise ───────────────────────────────────────
  const { data: quote } = await supabase
    .from('quotes')
    .select('id, tenant_id, paid_at, stripe_links')
    .eq('id', quoteId)
    .maybeSingle()
  if (!quote) return Response.json({ ok: false, error: 'no_quote' }, { status: 404 })
  if (!quote.tenant_id) {
    return Response.json({ ok: false, error: 'unscoped_quote' }, { status: 403 })
  }
  if (quote.paid_at) {
    return Response.json({ ok: false, error: 'quote_already_paid' }, { status: 409 })
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, owner_user_id')
    .eq('id', quote.tenant_id)
    .maybeSingle()
  if (!tenant || tenant.owner_user_id !== userId) {
    return Response.json({ ok: false, error: 'not_owner' }, { status: 403 })
  }

  // ─── Expire live Checkout Sessions ──────────────────────────
  // Best-effort (warn + continue, same as the edit route): an expiry
  // failure shouldn't strand an unpayable-anyway quote, but every session
  // we DO expire closes the pay-after-delete window.
  const links = (quote.stripe_links ?? {}) as Record<string, string | undefined>
  for (const [tier, sessionUrl] of Object.entries(links)) {
    if (!sessionUrl) continue
    const exp = await expireCheckoutSession(sessionUrl)
    if (!exp.ok) {
      console.warn('[quote/delete] expire failed (continuing)', {
        quoteId,
        tier,
        reason: exp.reason,
      })
    }
  }

  // ─── Delete (atomic paid guard) ─────────────────────────────
  // `.is('paid_at', null)` re-checks paid-ness inside the statement itself;
  // `.select('id')` tells us whether a row was actually removed. Zero rows
  // after a successful load ⇒ the quote got paid (or vanished) in the
  // window since — surface it as the same 409 the up-front check uses.
  const { data: deleted, error } = await supabase
    .from('quotes')
    .delete()
    .eq('id', quoteId)
    .eq('tenant_id', tenant.id)
    .is('paid_at', null)
    .select('id')
  if (error) {
    return Response.json({ ok: false, error: 'delete_failed' }, { status: 500 })
  }
  if (!deleted || deleted.length === 0) {
    return Response.json({ ok: false, error: 'quote_already_paid' }, { status: 409 })
  }
  return Response.json({ ok: true })
}
