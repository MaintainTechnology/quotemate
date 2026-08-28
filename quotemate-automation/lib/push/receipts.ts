import type { SupabaseClient } from '@supabase/supabase-js'
import { RECEIPT_DELAY_MS } from './send'

export const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts'
export const EXPO_RECEIPT_BATCH_SIZE = 1000

export type PushTicketRow = {
  id: string
  expo_ticket_id: string
  tenant_id: string
  user_id: string
  token: string
  sent_at: string
  next_check_at: string
  expires_at: string
}

export type ExpoReceipt = {
  status?: string
  message?: string
  details?: { error?: string }
}

export type ReceiptAction =
  | { ticket: PushTicketRow; kind: 'retry' }
  | {
      ticket: PushTicketRow
      kind: 'terminal'
      status: 'ok' | 'error' | 'expired'
      error: string | null
      message: string | null
      prune: boolean
    }

export function chunkReceiptTickets(
  tickets: PushTicketRow[],
  size = EXPO_RECEIPT_BATCH_SIZE,
): PushTicketRow[][] {
  const chunks: PushTicketRow[][] = []
  for (let i = 0; i < tickets.length; i += size) chunks.push(tickets.slice(i, i + size))
  return chunks
}

export function reconcileReceiptBatch(
  tickets: PushTicketRow[],
  receipts: Record<string, ExpoReceipt>,
  now: Date,
): ReceiptAction[] {
  return tickets.map(ticket => {
    if (new Date(ticket.expires_at).getTime() <= now.getTime()) {
      return { ticket, kind: 'terminal', status: 'expired', error: null, message: null, prune: false }
    }
    const receipt = receipts[ticket.expo_ticket_id]
    if (!receipt) return { ticket, kind: 'retry' }
    const error = receipt.details?.error ?? null
    return {
      ticket,
      kind: 'terminal',
      status: receipt.status === 'ok' ? 'ok' : 'error',
      error,
      message: receipt.message ?? null,
      prune: error === 'DeviceNotRegistered',
    }
  })
}

type SweepResult = {
  scanned: number
  checked: number
  retryable: number
  pruned: number
  expired: number
  error?: string
}

export async function sweepPushReceipts(
  supabase: SupabaseClient,
  options: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<SweepResult> {
  const now = options.now ?? new Date()
  const fetchImpl = options.fetchImpl ?? fetch
  const { data, error } = await supabase
    .from('push_tickets')
    .select('id, expo_ticket_id, tenant_id, user_id, token, sent_at, next_check_at, expires_at')
    .is('checked_at', null)
    .lte('next_check_at', now.toISOString())
    .order('next_check_at', { ascending: true })
    .limit(5000)
  if (error) return { scanned: 0, checked: 0, retryable: 0, pruned: 0, expired: 0, error: error.message }

  const tickets = (data ?? []) as PushTicketRow[]
  const expired = tickets.filter(ticket => new Date(ticket.expires_at).getTime() <= now.getTime())
  const active = tickets.filter(ticket => new Date(ticket.expires_at).getTime() > now.getTime())
  const result: SweepResult = {
    scanned: tickets.length,
    checked: 0,
    retryable: 0,
    pruned: 0,
    expired: 0,
  }

  async function apply(actions: ReceiptAction[]) {
    for (const action of actions) {
      if (action.kind === 'retry') {
        const { error: retryError } = await supabase
          .from('push_tickets')
          .update({ next_check_at: new Date(now.getTime() + RECEIPT_DELAY_MS).toISOString() })
          .eq('id', action.ticket.id)
        if (!retryError) result.retryable++
        continue
      }

      const { error: updateError } = await supabase
        .from('push_tickets')
        .update({
          checked_at: now.toISOString(),
          receipt_status: action.status,
          receipt_error: action.error,
          receipt_message: action.message,
        })
        .eq('id', action.ticket.id)
      if (updateError) continue
      result.checked++
      if (action.status === 'expired') result.expired++

      if (action.prune) {
        const { error: pruneError } = await supabase
          .from('push_tokens')
          .delete()
          .eq('tenant_id', action.ticket.tenant_id)
          .eq('user_id', action.ticket.user_id)
          .eq('token', action.ticket.token)
        if (!pruneError) result.pruned++
      }
    }
  }

  await apply(reconcileReceiptBatch(expired, {}, now))
  for (const batch of chunkReceiptTickets(active)) {
    let response: Response
    try {
      response = await fetchImpl(EXPO_RECEIPTS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ ids: batch.map(ticket => ticket.expo_ticket_id) }),
      })
    } catch {
      result.retryable += batch.length
      continue
    }
    if (!response.ok) {
      result.retryable += batch.length
      continue
    }
    const payload = (await response.json()) as { data?: Record<string, ExpoReceipt> }
    await apply(reconcileReceiptBatch(batch, payload.data ?? {}, now))
  }
  return result
}
