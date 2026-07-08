// Self-serve visit booking for the dedicated trade surfaces (roofing +
// painting), whose jobs live in their OWN tables — roofing_measurements /
// painting_measurements — not the quotes table. Electrical/plumbing/solar book
// via quotes.scheduled_at + the /q/[token]/book flow; these tables got the same
// scheduled_at + scheduled_window columns in migration 167, and this module is
// the shared glue so the API route (write) and the trade quote pages (render
// the picker / booked state) resolve slots the SAME way — mirroring how the
// quotes book route + page share resolveBookingOptions.

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveBookingOptions, buildBookedKeys, type BookingOption } from './slots'
import { tzForState } from './availability'

/** trade slug (in the /q/<trade>/<token> URL) → its measurements table. */
export const TRADE_BOOKING_TABLES = {
  roof: 'roofing_measurements',
  paint: 'painting_measurements',
} as const
export type TradeBookingKey = keyof typeof TRADE_BOOKING_TABLES

/** True for a valid trade slug (narrows the string). */
export function isTradeBookingKey(s: string): s is TradeBookingKey {
  return Object.hasOwn(TRADE_BOOKING_TABLES, s)
}

/**
 * The bookable half-day windows for a tenant, derived EXACTLY as the quotes
 * book flow does (resolveBookingOptions) — AM/PM windows from the weekly
 * availability template when set, else the legacy curated/rolling slots, with
 * already-booked windows on the SAME table excluded. `excludeId` drops the
 * caller's own row so a re-pick doesn't collide with its own held window.
 */
export async function loadTenantBookingOptions(
  supabase: SupabaseClient,
  opts: { tenantId: string; table: string; excludeId?: string | null },
): Promise<BookingOption[]> {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('available_slots, default_availability, state')
    .eq('id', opts.tenantId)
    .maybeSingle()
  if (!tenant) return []
  const t = tenant as {
    available_slots?: unknown
    default_availability?: unknown
    state?: string | null
  }
  const tz = tzForState(t.state ?? null)

  let q = supabase
    .from(opts.table)
    .select('scheduled_at, scheduled_window')
    .eq('tenant_id', opts.tenantId)
    .not('scheduled_at', 'is', null)
  if (opts.excludeId) q = q.neq('id', opts.excludeId)
  const { data: bookedRows } = await q
  const bookedKeys = buildBookedKeys(
    (bookedRows as Array<{ scheduled_at: string | null; scheduled_window: string | null }> | null) ?? [],
    tz,
  )

  return resolveBookingOptions({
    availability: (t.default_availability as Parameters<typeof resolveBookingOptions>[0]['availability']) ?? null,
    availableSlots: t.available_slots as Parameters<typeof resolveBookingOptions>[0]['availableSlots'],
    timezone: tz,
    bookedKeys,
  })
}

/** Display label for a booked window: AM/PM half-day ("Fri 11 Jul (morning)")
 *  or a legacy exact time. Australia/Sydney — matches /q/[token]/book + /paid. */
export function formatVisitSlot(iso: string, window?: string | null): string {
  try {
    const day = new Date(iso).toLocaleString('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'Australia/Sydney',
    })
    if (window === 'am' || window === 'pm') {
      return `${day} (${window === 'am' ? 'morning' : 'afternoon'})`
    }
    const time = new Date(iso).toLocaleString('en-AU', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Australia/Sydney',
    })
    return `${day}, ${time}`
  } catch {
    return iso
  }
}
