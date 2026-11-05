import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { currentSmsWork, smsWorkCheckpoint } from './durable-work'
import { dispatchQuoteMessage } from './dispatch'
import { buildQuoteRequestUrl, buildTradeFormOffer, decideFormOfferTurn, FORM_OFFER_ACK, FORM_OFFER_TRADE } from './form-offer'
import type { ConversationState, FormOfferPin } from './extract-slots'
import { publicWebOrigin } from './public-origin'
import { recordSmsReply } from './reply-publication'

/** One recoverable form decision per SMS work item. Failures escape to the
 * worker; never switch to a second conversational reply after an ambiguous send. */
export async function handlePlumbingFormOffer(args: {
  db: SupabaseClient; tenantId: string; conversationId: string; customerPhone: string; fromNumber: string;
  state: ConversationState; firstName?: string | null; inbound: string; agentHasReplied: boolean;
  suppressed: boolean; initialTurnCount: number;
}): Promise<{ handled: boolean; state: ConversationState }> {
  const work = currentSmsWork()
  if (!work?.jobId || !args.tenantId) throw new Error('Plumbing form requires owned recoverable SMS work')
  const plan = await smsWorkCheckpoint('plumbing_form_plan', async () => {
    const action = decideFormOfferTurn({ pin: args.state.form_offer, agentHasReplied: args.agentHasReplied,
      suppressed: args.suppressed, inbound: args.inbound })
    // Freeze the random bearer token before creating any lead. Do not derive
    // access tokens from work/tenant/conversation identifiers exposed elsewhere.
    const token = action === 'offer'
      ? randomBytes(16).toString('hex')
      : args.state.form_offer?.token ?? null
    const step: FormOfferPin['step'] = action === 'offer' ? 'offer_form' : action === 'acknowledge' ? 'await_form' : 'gather'
    const state = token ? { ...args.state, form_offer: { token, step } } : args.state
    const text = action === 'offer' && token ? buildTradeFormOffer({ trade: FORM_OFFER_TRADE,
      firstName: args.firstName, formUrl: buildQuoteRequestUrl(publicWebOrigin(), token) })
      : action === 'acknowledge' ? FORM_OFFER_ACK : null
    return { action, token, state, text, turnCount: args.initialTurnCount + 1, at: new Date().toISOString() }
  })
  if (plan.action === 'none') return { handled: false, state: args.state }
  if (!plan.token) throw new Error('Plumbing form pin is missing')
  if (plan.action === 'offer') {
    await smsWorkCheckpoint('plumbing_form_lead', async () => {
      // Stable token handles a DB commit followed by a lost checkpoint response.
      // ignoreDuplicates preserves an already submitted lead on replay.
      const created = await args.db.from('trade_lead_requests').upsert({ token: plan.token,
        trade: FORM_OFFER_TRADE, tenant_id: args.tenantId, conversation_id: args.conversationId,
        customer_phone: args.customerPhone, status: 'pending' }, { onConflict: 'token', ignoreDuplicates: true })
      if (created.error) throw new Error('Plumbing form lead could not be saved')
      const saved = await args.db.from('trade_lead_requests').select('token')
        .eq('token', plan.token).eq('trade', FORM_OFFER_TRADE).eq('tenant_id', args.tenantId)
        .eq('conversation_id', args.conversationId).eq('customer_phone', args.customerPhone).maybeSingle()
      if (saved.error || saved.data?.token !== plan.token) throw new Error('Plumbing form ownership could not be confirmed')
      return true
    })
  }
  await smsWorkCheckpoint('plumbing_form_pin', async () => {
    const saved = await args.db.from('sms_conversations').update({ conversation_state: plan.state,
      updated_at: plan.at, ...(plan.text ? { turn_count: plan.turnCount, last_message_at: plan.at } : {}) })
      .eq('id', args.conversationId).eq('tenant_id', args.tenantId).select('id').maybeSingle()
    if (saved.error || saved.data?.id !== args.conversationId) throw new Error('Plumbing form pin could not be saved')
    return true
  })
  if (!plan.text) return { handled: false, state: plan.state }
  await smsWorkCheckpoint('plumbing_form_reply', async () => {
    const reply = await dispatchQuoteMessage({ to: args.customerPhone, from: args.fromNumber, text: plan.text!,
      tenantId: args.tenantId, conversationId: args.conversationId, audience: 'customer',
      deliveryKey: `plumbing-form:${work.jobId}:${plan.action}` })
    if (!reply.ok) throw new Error('Plumbing form reply is awaiting durable delivery recovery')
    await recordSmsReply(args.db, args.conversationId, plan.text!, reply)
    return true
  })
  return { handled: true, state: plan.state }
}
