import type { SupabaseClient } from '@supabase/supabase-js'

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
export const EXPO_MESSAGE_BATCH_SIZE = 100
export const EXPO_REQUEST_TIMEOUT_MS = 30_000
export const RECEIPT_DELAY_MS = 15 * 60 * 1000
export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000

export type PushContent = { title: string; body: string; url: string }
export type PushRecipient = { id: string; user_id: string; token: string }
export type PushSendOptions = { eventId?: string; claimToken?: string }
type ExpoTicket = {
  status?: string
  id?: string
  message?: string
  details?: { error?: string }
}

export function chunkPushRecipients(
  recipients: PushRecipient[],
  size = EXPO_MESSAGE_BATCH_SIZE,
): PushRecipient[][] {
  const chunks: PushRecipient[][] = []
  for (let i = 0; i < recipients.length; i += size) chunks.push(recipients.slice(i, i + size))
  return chunks
}

async function postExpoMessages(messages: unknown[]): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('Expo push request timed out')), EXPO_REQUEST_TIMEOUT_MS)
  try {
    return await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(messages),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

/** Best-effort tenant fan-out. Push plumbing never throws into a business flow. */
export async function sendPushToTenant(
  supabase: SupabaseClient,
  tenantId: string,
  content: PushContent,
  options: PushSendOptions = {},
): Promise<boolean> {
  try {
    if (options.eventId && !options.claimToken) return false

    if (options.eventId) {
      const { data: initialised, error: initialiseError } = await supabase.rpc(
        'initialise_push_event_deliveries',
        { p_event_id: options.eventId, p_claim_token: options.claimToken },
      )
      if (initialiseError || initialised !== true) {
        console.warn('[push] event fan-out initialisation failed (non-fatal)', initialiseError?.message)
        return false
      }
    }

    const recipientQuery = options.eventId
      ? null
      : supabase
          .from('push_tokens')
          .select('id, user_id, token')
          .eq('tenant_id', tenantId)
    let batches: PushRecipient[][] = []
    if (recipientQuery) {
      const { data: rows, error } = await recipientQuery
      if (error) {
        console.warn('[push] token read failed (non-fatal)', error.message)
        return false
      }
      const recipients = (rows ?? []).filter(
        (row): row is PushRecipient =>
          typeof row.id === 'string' && typeof row.user_id === 'string' && typeof row.token === 'string',
      )
      batches = chunkPushRecipients(recipients)
    }
    let allBatchesDurable = true
    for (;;) {
      let batch = batches.shift()
      if (options.eventId) {
        const { data, error } = await supabase.rpc('claim_push_event_delivery_batch', {
          p_event_id: options.eventId,
          p_claim_token: options.claimToken,
          p_limit: EXPO_MESSAGE_BATCH_SIZE,
        })
        if (error || data?.claimed !== true || !Array.isArray(data.recipients)) {
          console.warn('[push] event recipient claim failed (non-fatal)', error?.message)
          return false
        }
        batch = data.recipients.filter(
          (row: unknown): row is PushRecipient => {
            const recipient = row as Partial<PushRecipient>
            return typeof recipient.id === 'string'
              && typeof recipient.user_id === 'string'
              && typeof recipient.token === 'string'
          },
        )
        if (batch.length !== data.recipients.length) return false
      }
      if (!batch || batch.length === 0) break

      let response: Response
      try {
        response = await postExpoMessages(batch.map(recipient => ({
          to: recipient.token,
          title: content.title,
          body: content.body,
          data: { url: content.url },
          sound: 'default',
        })))
      } catch (error: unknown) {
        console.warn('[push] Expo request threw (non-fatal)', error instanceof Error ? error.message : String(error))
        allBatchesDurable = false
        if (options.eventId) break
        continue
      }
      if (!response.ok) {
        console.warn('[push] Expo request failed (non-fatal)', response.status)
        allBatchesDurable = false
        if (options.eventId) break
        continue
      }

      const json = (await response.json()) as { data?: ExpoTicket[] }
      const tickets = Array.isArray(json.data) ? json.data : []
      if (tickets.length !== batch.length) {
        console.warn('[push] Expo ticket count did not match recipient count (non-fatal)')
        allBatchesDurable = false
        if (options.eventId) break
        continue
      }
      const sentAt = Date.now()

      if (options.eventId) {
        const results = tickets.flatMap((ticket, index) => {
          const recipient = batch[index]
          if (!recipient) return []
          if (ticket.status === 'ok' && ticket.id) {
            return [{
              delivery_id: recipient.id,
              outcome: 'ticket',
              expo_ticket_id: ticket.id,
            }]
          }
          if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
            return [{ delivery_id: recipient.id, outcome: 'device_not_registered' }]
          }
          if (ticket.status === 'error') {
            return [{
              delivery_id: recipient.id,
              outcome: 'terminal_error',
              error: ticket.details?.error ?? null,
              message: ticket.message ?? null,
            }]
          }
          return []
        })
        if (results.length !== batch.length) {
          allBatchesDurable = false
          continue
        }
        const { data: recorded, error: recordError } = await supabase.rpc(
          'record_push_delivery_results',
          {
            p_event_id: options.eventId,
            p_claim_token: options.claimToken,
            p_results: results,
            p_sent_at: new Date(sentAt).toISOString(),
            p_next_check_at: new Date(sentAt + RECEIPT_DELAY_MS).toISOString(),
            p_expires_at: new Date(sentAt + RECEIPT_TTL_MS).toISOString(),
          },
        )
        if (recordError || recorded !== true) {
          console.warn('[push] event delivery persistence failed (non-fatal)', recordError?.message)
          allBatchesDurable = false
          break
        }
        continue
      }

      const durable = tickets.flatMap((ticket, index) => {
        const recipient = batch[index]
        if (!recipient || ticket.status !== 'ok' || !ticket.id) return []
        return [{
          expo_ticket_id: ticket.id,
          tenant_id: tenantId,
          user_id: recipient.user_id,
          token: recipient.token,
          sent_at: new Date(sentAt).toISOString(),
          next_check_at: new Date(sentAt + RECEIPT_DELAY_MS).toISOString(),
          expires_at: new Date(sentAt + RECEIPT_TTL_MS).toISOString(),
        }]
      })
      if (durable.length > 0) {
        const { error: ticketError } = await supabase.from('push_tickets').insert(durable)
        if (ticketError) {
          console.warn('[push] ticket persistence failed (non-fatal)', ticketError.message)
          allBatchesDurable = false
        }
      }

      for (let index = 0; index < tickets.length; index++) {
        const ticket = tickets[index]
        const recipient = batch[index]
        if (!recipient || ticket?.details?.error !== 'DeviceNotRegistered') continue
        const { error: deleteError } = await supabase
          .from('push_tokens')
          .delete()
          .eq('tenant_id', tenantId)
          .eq('user_id', recipient.user_id)
          .eq('token', recipient.token)
        if (deleteError) {
          console.warn('[push] dead-token delete failed (non-fatal)', deleteError.message)
          allBatchesDurable = false
        }
      }
    }
    return allBatchesDurable
  } catch (error: unknown) {
    console.warn('[push] send failed (non-fatal)', error instanceof Error ? error.message : String(error))
    return false
  }
}
