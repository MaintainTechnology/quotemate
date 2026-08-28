// Customer quote acceptance endpoint (Gap #1 / #3).
//
// POST /api/q/[token]/accept  { tier }
//
// Records the customer's EXPLICIT acceptance of a quote before payment — the
// "Accept quote & confirm site visit" block on every customer surface. This
// is the legal record that the customer accepted a specific price/scope
// (customer_accepted_at + customer_accepted_tier, migration 164).
//
// Trust model: the share_token is the capability (unguessable), same as the
// booking route — no bearer auth on a public customer action.
//
// Idempotent + defensive: acceptance is recorded once (first-write wins on
// customer_accepted_at) and the endpoint NEVER hard-fails the customer flow —
// the client proceeds to the payment step regardless, so a transient DB hiccup
// can't strand a customer who's ready to pay. Every trade's surface (solar
// included) has a public.quotes row keyed by share_token, so this one endpoint
// covers them all.

import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { pipelineLog } from '@/lib/log/pipeline'
import { sendPushToTenant } from '@/lib/push/send'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const VALID_TIERS = new Set(['good', 'better', 'best', 'inspection'])

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const log = pipelineLog('dispatch')
  const { token } = await ctx.params

  let body: { tier?: unknown }
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const rawTier = typeof body.tier === 'string' ? body.tier : 'better'
  const tier = VALID_TIERS.has(rawTier) ? rawTier : 'better'

  // Every trade's customer page maps to exactly one row keyed by this token.
  // Try the quotes table first (electrical/plumbing/solar/commercial), then the
  // two dedicated surfaces that aren't quotes-backed (roofing/painting). A
  // missing customer_accepted_* column (pre-migration deploy) surfaces as a
  // read error → we skip that table rather than failing, so acceptance
  // recording is always best-effort and never blocks the pay step.
  const targets = [
    { table: 'quotes', tokenCol: 'share_token' },
    { table: 'roofing_measurements', tokenCol: 'public_token' },
    { table: 'painting_measurements', tokenCol: 'public_token' },
  ] as const

  try {
    for (const t of targets) {
      const { data: row, error: readErr } = await supabase
        .from(t.table)
        .select('id, tenant_id, customer_accepted_at')
        .eq(t.tokenCol, token)
        .maybeSingle()

      if (readErr || !row) continue

      // First-write wins at the database, not in this process. The conditional
      // update's returned row is the sole notification claim winner, so two
      // requests that both read NULL cannot both enqueue a push.
      const firstAcceptance = !(row as { customer_accepted_at?: string | null }).customer_accepted_at
      if (firstAcceptance) {
        const acceptedAt = new Date().toISOString()
        const { data: claimed, error: claimErr } = await supabase
          .from(t.table)
          .update({ customer_accepted_at: acceptedAt, customer_accepted_tier: tier })
          .eq('id', (row as { id: string }).id)
          .is('customer_accepted_at', null)
          .select('id, tenant_id')
          .maybeSingle()

        if (claimErr) {
          log.err('accept: record failed (non-fatal — client proceeds)', claimErr.message, {
            table: t.table,
            id: (row as { id: string }).id,
          })
          return Response.json({ ok: true, recorded: false })
        }

        if (claimed) {
          const claimedRow = claimed as { id: string; tenant_id?: string | null }
          log.ok('customer accepted quote', { table: t.table, id: claimedRow.id, tier })
          if (claimedRow.tenant_id) {
            after(() =>
              sendPushToTenant(supabase, claimedRow.tenant_id!, {
                title: 'Quote accepted',
                body: 'The customer accepted their quote.',
                url: `/quotes?quoteId=${claimedRow.id}`,
              }),
            )
          }
          return Response.json({ ok: true, recorded: true })
        }
      }

      // The acceptance already existed or another concurrent request won the
      // claim. Keep the customer's latest valid tier without touching the
      // original acceptance timestamp or sending a second notification.
      const { error: writeErr } = await supabase
        .from(t.table)
        .update({ customer_accepted_tier: tier })
        .eq('id', (row as { id: string }).id)
      if (writeErr) {
        log.err('accept: tier update failed (non-fatal — client proceeds)', writeErr.message, {
          table: t.table,
          id: (row as { id: string }).id,
        })
        return Response.json({ ok: true, recorded: false })
      }
      log.ok('customer acceptance tier updated', { table: t.table, id: (row as { id: string }).id, tier })
      return Response.json({ ok: true, recorded: true })
    }

    // No matching row anywhere — don't block the client.
    return Response.json({ ok: true, recorded: false })
  } catch (e: unknown) {
    log.err('accept: threw (non-fatal — client proceeds)', e instanceof Error ? e.message : String(e), { token: token.slice(0, 8) + '…' })
    return Response.json({ ok: true, recorded: false })
  }
}
