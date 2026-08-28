import type { SupabaseClient } from '@supabase/supabase-js'

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
export const EXPO_MESSAGE_BATCH_SIZE = 100
export const RECEIPT_DELAY_MS = 15 * 60 * 1000
export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000

export type PushContent = { title: string; body: string; url: string }
export type PushRecipient = { id: string; user_id: string; token: string }
export type PushSendOptions = { eventId?: string }
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

/** Best-effort tenant fan-out. Push plumbing never throws into a business flow. */
export async function sendPushToTenant(
  supabase: SupabaseClient,
  tenantId: string,
  content: PushContent,
  options: PushSendOptions = {},
): Promise<boolean> {
  try {
    if (options.eventId) {
      const { data: initialised, error: initialiseError } = await supabase.rpc(
        'initialise_push_event_deliveries',
        { p_event_id: options.eventId, p_now: new Date().toISOString() },
      )
      if (initialiseError || initialised !== true) {
        console.warn('[push] event fan-out initialisation failed (non-fatal)', initialiseError?.message)
        return false
      }
    }

    const recipientQuery = options.eventId
      ? supabase
          .from('push_event_deliveries')
          .select('id, user_id, token')
          .eq('event_id', options.eventId)
          .eq('status', 'pending')
          .order('id', { ascending: true })
      : supabase
          .from('push_tokens')
          .select('id, user_id, token')
          .eq('tenant_id', tenantId)
    const { data: rows, error } = await recipientQuery
    if (error) {
      console.warn('[push] token read failed (non-fatal)', error.message)
      return false
    }
    const recipients = (rows ?? []).filter(
      (row): row is PushRecipient =>
        typeof row.id === 'string' && typeof row.user_id === 'string' && typeof row.token === 'string',
    )

    if (recipients.length === 0) return true
    let allBatchesDurable = true
    for (const batch of chunkPushRecipients(recipients)) {
      let response: Response
      try {
        response = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(
            batch.map(recipient => ({
              to: recipient.token,
              title: content.title,
              body: content.body,
              data: { url: content.url },
              sound: 'default',
            })),
          ),
        })
      } catch (error: unknown) {
        console.warn('[push] Expo request threw (non-fatal)', error instanceof Error ? error.message : String(error))
        allBatchesDurable = false
        continue
      }
      if (!response.ok) {
        console.warn('[push] Expo request failed (non-fatal)', response.status)
        allBatchesDurable = false
        continue
      }

      const json = (await response.json()) as { data?: ExpoTicket[] }
      const tickets = Array.isArray(json.data) ? json.data : []
      if (tickets.length !== batch.length) {
        console.warn('[push] Expo ticket count did not match recipient count (non-fatal)')
        allBatchesDurable = false
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
            p_results: results,
            p_sent_at: new Date(sentAt).toISOString(),
            p_next_check_at: new Date(sentAt + RECEIPT_DELAY_MS).toISOString(),
            p_expires_at: new Date(sentAt + RECEIPT_TTL_MS).toISOString(),
          },
        )
        if (recordError || recorded !== true) {
          console.warn('[push] event delivery persistence failed (non-fatal)', recordError?.message)
          allBatchesDurable = false
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
