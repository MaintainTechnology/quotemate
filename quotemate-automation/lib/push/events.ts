import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPushToTenant, type PushContent } from './send'

export type PushEventInput = PushContent & {
  eventKey: string
  tenantId: string
}

type PushEventRow = {
  id: string
  event_key: string
  tenant_id: string
  title: string
  body: string
  url: string
}

type EventDeps = {
  send?: typeof sendPushToTenant
  now?: Date
}

async function deliverPushEvent(
  supabase: SupabaseClient,
  event: PushEventRow,
  deps: EventDeps = {},
): Promise<boolean> {
  const now = deps.now ?? new Date()
  const claimToken = randomUUID()
  const { data: claimed, error: claimError } = await supabase.rpc('claim_push_event', {
    p_event_id: event.id,
    p_claim_token: claimToken,
  })
  if (claimError || claimed !== true) return false

  const send = deps.send ?? sendPushToTenant
  const delivered = await send(supabase, event.tenant_id, {
    title: event.title,
    body: event.body,
    url: event.url,
  }, { eventId: event.id, claimToken })
  if (!delivered) {
    await supabase.rpc('release_push_event', {
      p_event_id: event.id,
      p_claim_token: claimToken,
      p_error: 'push delivery failed',
      p_next_attempt_at: new Date(now.getTime() + 60_000).toISOString(),
    })
    return false
  }

  const { data: completed, error: completeError } = await supabase.rpc('complete_push_event', {
    p_event_id: event.id,
    p_claim_token: claimToken,
  })
  return !completeError && completed === true
}

/**
 * Durably records one business event before attempting delivery. A concurrent
 * duplicate loses the unique event_key insert and therefore cannot send.
 */
export async function enqueuePushEvent(
  supabase: SupabaseClient,
  input: PushEventInput,
  deps: EventDeps = {},
): Promise<boolean> {
  try {
    const now = deps.now ?? new Date()
    const { data, error } = await supabase
      .from('push_events')
      .upsert({
        event_key: input.eventKey,
        tenant_id: input.tenantId,
        title: input.title,
        body: input.body,
        url: input.url,
        next_attempt_at: now.toISOString(),
      }, { onConflict: 'event_key', ignoreDuplicates: true })
      .select('id, event_key, tenant_id, title, body, url')
      .maybeSingle()
    if (error || !data) return false
    return deliverPushEvent(supabase, data as PushEventRow, { ...deps, now })
  } catch (error: unknown) {
    console.warn('[push/events] enqueue failed (non-fatal)', error instanceof Error ? error.message : String(error))
    return false
  }
}

export async function sweepPushEvents(
  supabase: SupabaseClient,
  deps: EventDeps = {},
): Promise<{ scanned: number; sent: number; retryable: number; error?: string }> {
  const now = deps.now ?? new Date()
  const { data, error } = await supabase
    .from('push_events')
    .select('id, event_key, tenant_id, title, body, url')
    .is('sent_at', null)
    .lte('next_attempt_at', now.toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(500)
  if (error) return { scanned: 0, sent: 0, retryable: 0, error: error.message }

  const rows = (data ?? []) as PushEventRow[]
  let sent = 0
  for (const row of rows) {
    if (await deliverPushEvent(supabase, row, { ...deps, now })) sent++
  }
  return { scanned: rows.length, sent, retryable: rows.length - sent }
}
