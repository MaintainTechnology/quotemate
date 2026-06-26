// Public self-serve painting form — the per-request unique-hash link the SMS
// receptionist offers first (/paint-request/[token]). Token =
// painting_lead_requests.token.
//
//   GET  → form context (business name + whether it's already submitted).
//   POST → validate the painting inputs, run the estimate + save the job,
//          mark the lead submitted, and text the customer their quote
//          ("your quote is on its way") from the tenant's number.
//
// No auth: the unguessable token IS the capability, exactly like the public
// quote pages. One-shot: a submitted link can't be re-run.

import { createClient } from '@supabase/supabase-js'
import { EstimateRequestSchema } from '@/lib/painting/request-schema'
import { composePaintingQuoteDelivery, runAndSavePaintingQuote } from '@/lib/painting/quote-dispatch'
import { notifyPaintingTradie } from '@/lib/painting/release'
import { buildPaintingHoldingSms } from '@/lib/sms/painting-compose'
import { sendSms } from '@/lib/sms/twilio'
import { dispatchQuoteMessage } from '@/lib/sms/dispatch'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60 // the estimate runs a provider lookup

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const APP_BASE_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://quote-mate-rho.vercel.app'
).replace(/\/$/, '')

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const { data: lead } = await supabase
    .from('painting_lead_requests')
    .select('token, tenant_id, status')
    .eq('token', token)
    .maybeSingle()
  if (!lead) {
    return Response.json({ ok: false, error: 'Invalid or expired link' }, { status: 404 })
  }
  let businessName: string | null = null
  if (lead.tenant_id) {
    const { data: t } = await supabase
      .from('tenants')
      .select('business_name')
      .eq('id', lead.tenant_id)
      .maybeSingle()
    businessName = (t?.business_name as string | undefined) ?? null
  }
  return Response.json({ ok: true, status: lead.status as string, business_name: businessName })
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  const { data: lead } = await supabase
    .from('painting_lead_requests')
    .select('token, tenant_id, conversation_id, customer_phone, status')
    .eq('token', token)
    .maybeSingle()
  if (!lead) {
    return Response.json({ ok: false, error: 'Invalid or expired link' }, { status: 404 })
  }
  if ((lead.status as string) === 'submitted') {
    return Response.json({ ok: false, error: 'already_submitted' }, { status: 409 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = EstimateRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const tenantId = (lead.tenant_id as string | null) ?? null
  const customerPhone = (lead.customer_phone as string | null) ?? null

  // Default to the "Other tools" path (footprint / Geoscape / floor plan),
  // never the demo provider — the same default the SMS Q&A path uses.
  const disp = await runAndSavePaintingQuote({
    supabase,
    tenantId,
    customerPhone,
    request: { address: parsed.data.address, inputs: parsed.data.inputs, source: 'auto', use_mock_provider: false },
    appUrl: APP_BASE_URL,
  })

  // One-shot: mark the lead submitted regardless of the estimate outcome.
  await supabase
    .from('painting_lead_requests')
    .update({ status: 'submitted', submitted_at: new Date().toISOString(), quote_token: disp.ok ? disp.token : null })
    .eq('token', token)

  // Post-submit dispatch. A PRICED quote is DRAFTED and held for tradie
  // review: the customer gets a holding message and the tradie is notified to
  // review/edit/send (never the price). An INSPECTION-routed request has no
  // price to audit, so its on-site-measure message goes to the customer
  // directly. Best-effort — never blocks the thank-you response.
  if (disp.ok) {
    try {
      const convId = (lead.conversation_id as string | null) ?? null
      const { data: t } = tenantId
        ? await supabase
            .from('tenants')
            .select('owner_mobile, owner_first_name, twilio_sms_number, business_name')
            .eq('id', tenantId)
            .maybeSingle()
        : { data: null }
      const tenantRow = (t as {
        owner_mobile?: string | null
        owner_first_name?: string | null
        twilio_sms_number?: string | null
        business_name?: string | null
      } | null) ?? null

      let fromNumber: string | null = null
      if (convId) {
        const { data: conv } = await supabase
          .from('sms_conversations')
          .select('to_number')
          .eq('id', convId)
          .maybeSingle()
        fromNumber = (conv?.to_number as string | undefined) ?? null
      }
      if (!fromNumber) fromNumber = tenantRow?.twilio_sms_number ?? null
      const address = parsed.data.address.address

      if (disp.inspection) {
        if (customerPhone && fromNumber) {
          const { text, mmsUrl } = await composePaintingQuoteDelivery({ supabase, disp, address, appUrl: APP_BASE_URL, tenantId })
          await sendSms({ to: customerPhone, from: fromNumber, text, mediaUrl: mmsUrl })
          if (convId) {
            await supabase.from('sms_messages').insert({ conversation_id: convId, direction: 'outbound', body: text })
            await supabase
              .from('sms_conversations')
              .update({ painting_state: { slots: {}, last_step: 'await_booking', pending_quote_token: disp.token }, updated_at: new Date().toISOString() })
              .eq('id', convId)
          }
        }
      } else {
        if (customerPhone && fromNumber) {
          await sendSms({
            to: customerPhone,
            from: fromNumber,
            text: buildPaintingHoldingSms({ businessName: tenantRow?.business_name ?? null }),
          })
        }
        await notifyPaintingTradie({
          tenant: {
            owner_mobile: tenantRow?.owner_mobile ?? null,
            owner_first_name: tenantRow?.owner_first_name ?? null,
            twilio_sms_number: tenantRow?.twilio_sms_number ?? null,
          },
          customerName: null,
          address,
          betterIncGst: disp.estimate.price.tiers.find((tier) => tier.tier === 'better')?.inc_gst ?? null,
          estimateToken: disp.estimateToken,
          appUrl: APP_BASE_URL,
          dispatch: (o) => dispatchQuoteMessage({ to: o.to, text: o.text, from: o.from }),
        })
        if (convId) {
          await supabase
            .from('sms_conversations')
            .update({ painting_state: { slots: {}, last_step: 'quoted', pending_quote_token: disp.token }, updated_at: new Date().toISOString() })
            .eq('id', convId)
        }
      }
    } catch (e) {
      console.warn('[paint-request] post-submit dispatch failed (non-fatal)', e)
    }
  }

  return Response.json(
    {
      ok: disp.ok,
      inspection: disp.ok ? disp.inspection : false,
      error: disp.ok ? undefined : 'estimate_failed',
    },
    { status: 200 },
  )
}
