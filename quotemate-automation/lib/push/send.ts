import type { SupabaseClient } from '@supabase/supabase-js'

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
export const EXPO_MESSAGE_BATCH_SIZE = 100
export const RECEIPT_DELAY_MS = 15 * 60 * 1000
export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000

export type PushContent = { title: string; body: string; url: string }
export type PushRecipient = { id: string; user_id: string; token: string }
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
): Promise<void> {
  try {
    const { data: rows, error } = await supabase
      .from('push_tokens')
      .select('id, user_id, token')
      .eq('tenant_id', tenantId)
    if (error) {
      console.warn('[push] token read failed (non-fatal)', error.message)
      return
    }
    const recipients = (rows ?? []).filter(
      (row): row is PushRecipient =>
        typeof row.id === 'string' && typeof row.user_id === 'string' && typeof row.token === 'string',
    )

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
        continue
      }
      if (!response.ok) {
        console.warn('[push] Expo request failed (non-fatal)', response.status)
        continue
      }

      const json = (await response.json()) as { data?: ExpoTicket[] }
      const tickets = Array.isArray(json.data) ? json.data : []
      const sentAt = Date.now()
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
        if (ticketError) console.warn('[push] ticket persistence failed (non-fatal)', ticketError.message)
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
        if (deleteError) console.warn('[push] dead-token delete failed (non-fatal)', deleteError.message)
      }
    }
  } catch (error: unknown) {
    console.warn('[push] send failed (non-fatal)', error instanceof Error ? error.message : String(error))
  }
}
