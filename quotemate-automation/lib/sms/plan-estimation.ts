// SMS plan-estimation branch (migration 104).
//
// Runs inside the inbound SMS webhook for tenants with the Account-tab
// "SMS electrical estimation" toggle ON. When the inbound text reads like a
// plan-estimation request ("can you quote my electrical plan?"), this branch
// short-circuits the normal quote dialog and replies with a tokenised link to
// the customer plan-upload page (/upload/plan/<token>).
//
// Link lifecycle lives in plan_upload_requests:
//   awaiting_upload → analysing → complete | failed
// A repeat request while a link is live resends the SAME link (no token churn);
// while a run is analysing it sends a hold-on instead of a second link.
//
// Pure intent/template logic is in lib/estimation/plan-request.ts (unit
// tested); this module is the thin side-effectful layer, mirroring the
// tradie-registration branch in the inbound route.

import { randomBytes } from 'node:crypto'
import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendSms } from './twilio'
import { wantsPlanEstimation, buildPlanUploadSms } from '@/lib/estimation/plan-request'
import type { TenantRow } from '@/lib/tenant/lookup'

const APP_URL = (process.env.APP_URL ?? 'https://www.quotemax.com.au').replace(/\/$/, '')

export function planUploadUrl(token: string): string {
  return `${APP_URL}/upload/plan/${token}`
}

export function planResultsUrl(shareToken: string): string {
  return `${APP_URL}/q/plan/${shareToken}`
}

export function planReportPdfUrl(shareToken: string): string {
  return `${APP_URL}/api/q/plan/${shareToken}/pdf`
}

/**
 * Handle a possible plan-estimation request. Returns true when the message
 * was handled (caller acks Twilio and stops); false to let the normal
 * customer-quote pipeline take over.
 */
export async function maybeHandlePlanEstimation(args: {
  supabase: SupabaseClient
  tenant: TenantRow
  fromNumber: string
  toNumber: string
  inboundBody: string
  messageSid: string | null
  customerFirstName?: string | null
}): Promise<boolean> {
  const { supabase, tenant } = args
  if (!tenant.sms_estimator_enabled) return false
  if (!wantsPlanEstimation(args.inboundBody)) return false

  console.log('[sms/plan-estimation] intent matched', {
    tenantId: tenant.id,
    fromNumber: args.fromNumber,
  })

  // 1. Reuse a live request for this customer+tenant so a repeat text
  //    resends the same link instead of minting a new token.
  const { data: existing } = await supabase
    .from('plan_upload_requests')
    .select('id, token, status, sms_conversation_id')
    .eq('tenant_id', tenant.id)
    .eq('customer_phone', args.fromNumber)
    .in('status', ['awaiting_upload', 'analysing', 'failed'])
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // 2. Get-or-create the conversation row (its own conversation_type so the
  //    quote-dialog reuse logic never tries to continue a dialog on it).
  let conversationId = (existing?.sms_conversation_id as string | null) ?? null
  if (!conversationId) {
    const { data: created, error: createErr } = await supabase
      .from('sms_conversations')
      .insert({
        from_number: args.fromNumber,
        to_number: args.toNumber,
        status: 'done',
        conversation_type: 'plan_estimation',
        tenant_id: tenant.id,
      })
      .select('id')
      .single()
    if (createErr || !created) {
      console.error('[sms/plan-estimation] conversation create failed', createErr)
      return false // fall through to the normal pipeline rather than dropping the text
    }
    conversationId = created.id as string
  }

  // 3. Persist the inbound message on the thread.
  await supabase.from('sms_messages').insert({
    conversation_id: conversationId,
    direction: 'inbound',
    body: args.inboundBody,
    twilio_message_sid: args.messageSid,
  })

  // 4. Resolve the token: reuse the live one, else mint a fresh request.
  let token: string
  let analysing = false
  if (existing) {
    token = existing.token as string
    analysing = existing.status === 'analysing'
    if (!existing.sms_conversation_id) {
      await supabase
        .from('plan_upload_requests')
        .update({ sms_conversation_id: conversationId, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    }
  } else {
    token = randomBytes(16).toString('hex')
    const { error: reqErr } = await supabase.from('plan_upload_requests').insert({
      token,
      tenant_id: tenant.id,
      sms_conversation_id: conversationId,
      customer_phone: args.fromNumber,
      twilio_number: args.toNumber,
      status: 'awaiting_upload',
    })
    if (reqErr) {
      console.error('[sms/plan-estimation] request insert failed', reqErr)
      return false
    }
  }

  const body = analysing
    ? `${args.customerFirstName ? `Hi ${args.customerFirstName}!` : 'Hi!'} We're still reading your plan — results land here in a couple of minutes.`
    : buildPlanUploadSms({
        firstName: args.customerFirstName ?? null,
        businessName: tenant.business_name,
        uploadUrl: planUploadUrl(token),
      })

  // 5. Reply in after() so Twilio gets its fast ack.
  const convId = conversationId
  after(async () => {
    try {
      const result = await sendSms({ to: args.fromNumber, from: args.toNumber, text: body })
      if (result.ok) {
        await supabase.from('sms_messages').insert({
          conversation_id: convId,
          direction: 'outbound',
          body,
          twilio_message_sid: result.sid,
        })
        await supabase
          .from('sms_conversations')
          .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', convId)
      } else {
        console.error('[sms/plan-estimation] outbound SMS failed', {
          conversationId: convId,
          code: result.code,
          reason: result.reason,
        })
      }
    } catch (e) {
      console.error('[sms/plan-estimation] outbound SMS threw', {
        conversationId: convId,
        message: e instanceof Error ? e.message : String(e),
      })
    }
  })

  return true
}
