// WP9 — customer product-choice record API.
// Reached from the SMS link  {APP_URL}/q/choose/{token}  (and its
// page). Same trust model as /upload/[token]: the token is unguessable
// and scopes everything; no auth.
//
//   GET  → the two options + current status (for the page to render)
//   POST → record { catalogue_id } as the customer's pick (idempotent)
//
// Inert until WP9 is in use: a conversation only has product_choice
// once the (flag-gated) inbound route offers options.

import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import {
  applyChoiceSelection,
  type ProductChoiceState,
} from '@/lib/sms/product-options'
import { dispatchQuoteMessage } from '@/lib/sms/dispatch'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function loadByToken(token: string) {
  const { data } = await supabase
    .from('sms_conversations')
    .select('id, product_choice')
    .eq('product_choice->>token', token)
    .maybeSingle()
  if (!data || !data.product_choice) return null
  return {
    id: data.id as string,
    choice: data.product_choice as ProductChoiceState,
  }
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params
  const row = await loadByToken(token)
  if (!row) return Response.json({ error: 'not_found' }, { status: 404 })
  const c = row.choice
  return Response.json({
    ok: true,
    category: c.category,
    status: c.status,
    chosen_catalogue_id: c.chosen_catalogue_id ?? null,
    options: (c.options ?? []).map((o) => ({
      catalogue_id: o.catalogue_id,
      name: o.name,
      brand: o.brand,
      range_series: o.range_series,
      price_ex_gst: o.price_ex_gst,
      image_path: o.image_path,
      description: o.description,
      tier: o.tier,
    })),
  })
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params
  let body: { catalogue_id?: string } = {}
  try {
    body = (await req.json()) as { catalogue_id?: string }
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const row = await loadByToken(token)
  if (!row) return Response.json({ error: 'not_found' }, { status: 404 })

  const next = applyChoiceSelection(row.choice, {
    catalogueId: body.catalogue_id ?? null,
  })
  if (!next) {
    return Response.json({ error: 'invalid_choice' }, { status: 400 })
  }

  // Did THIS call transition pending → chosen? (idempotent: a re-tap
  // returns the same object, so this is false and no SMS/quote re-fires)
  const justChosen = next !== row.choice && next.status === 'chosen'

  if (justChosen) {
    const { error } = await supabase
      .from('sms_conversations')
      .update({ product_choice: next, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    // The customer picked ON THE PAGE — there's no inbound SMS to drive
    // the conversation forward, so the page must close the loop itself:
    // confirm by SMS and trigger the quote build. Runs in after() so the
    // page gets an instant response. Best-effort + guarded so it can
    // never double-build a quote.
    after(async () => {
      try {
        const { data: conv } = await supabase
          .from('sms_conversations')
          .select('id, from_number, to_number, intake_id, status')
          .eq('id', row.id)
          .maybeSingle()
        if (!conv?.from_number) return
        // Quote already built / building (e.g. the SMS-reply path got
        // here first) → do nothing, never double-quote.
        if (conv.intake_id || conv.status === 'structuring' || conv.status === 'done') {
          console.log('[q/choose] pick recorded but quote already in progress — skipping', {
            conversationId: row.id,
          })
          return
        }

        const name = next.chosen_name ?? 'your selection'
        const confirmBody =
          `Great choice — ${name}. I'm finalising your quote now; ` +
          `it'll land here in a couple of minutes.`
        // MUST send from the SAME tradie number the customer has been
        // texting (conv.to_number), not dispatch's default voice
        // number — otherwise the confirmation arrives from a stranger.
        const d = await dispatchQuoteMessage({
          to: conv.from_number,
          from: (conv.to_number as string | null) ?? undefined,
          text: confirmBody,
        })
        await supabase.from('sms_messages').insert({
          conversation_id: row.id,
          direction: 'outbound',
          body: d.ok && d.channel === 'whatsapp' ? `[WhatsApp fallback] ${confirmBody}` : confirmBody,
          twilio_message_sid: d.ok ? d.sid : null,
        })

        // Mark structuring BEFORE the handoff so any racing inbound /
        // double-tap hits the guard above instead of re-triggering.
        await supabase
          .from('sms_conversations')
          .update({ status: 'structuring', updated_at: new Date().toISOString() })
          .eq('id', row.id)

        const res = await fetch(`${process.env.APP_URL}/api/intake/structure`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: row.id, sourceChannel: 'sms' }),
        })
        if (!res.ok) {
          console.error('[q/choose] intake/structure handoff failed', {
            conversationId: row.id,
            status: res.status,
          })
          // Reopen so the customer can re-engage via SMS (CAPTURE sees
          // the 'chosen' choice and the normal finish flow recovers).
          await supabase
            .from('sms_conversations')
            .update({ status: 'open', updated_at: new Date().toISOString() })
            .eq('id', row.id)
        } else {
          console.log('[q/choose] pick → confirmation SMS + quote build triggered', {
            conversationId: row.id,
            chosen: name,
          })
        }
      } catch (e: any) {
        console.error('[q/choose] page-pick completion failed (non-fatal)', {
          conversationId: row.id,
          error: e?.message ?? String(e),
        })
      }
    })
  }

  return Response.json({
    ok: true,
    status: next.status,
    chosen_catalogue_id: next.chosen_catalogue_id ?? null,
    chosen_name: next.chosen_name ?? null,
  })
}
