// Rolling booking-slot generator.
//
// `tenants.available_slots` is a static jsonb list of ISO timestamps a
// tradie curates (or that a one-off seed script wrote). The problem: it
// DECAYS. Once every stored slot is in the past — e.g. a pilot seeded a
// fixed fortnight that has since fully elapsed — the booking page renders
// the picker with zero future times and dead-ends at "NO UPCOMING SLOTS
// ARE OPEN". That's exactly what happened to Atomic / Sparky / Peppers
// once the May 2026 seed window passed (every one had 30 slots, all in
// the past, 0 in the future).
//
// Fix: a forward-looking default. When a tenant has no FUTURE curated
// slots, generate a rolling window (next N weekdays × fixed Sydney
// business hours) so the picker always offers real, bookable times —
// self-renewing, never stale. A tenant's own future slots, when present,
// still take priority (curation wins over the default).
//
// Pure + deterministic given `now`, so the booking PAGE (which renders
// the picker) and the booking API (which validates the picked slot)
// derive the IDENTICAL slot list and never disagree on what's bookable.
// DST-correct via Intl — no hardcoded +10:00 (which is wrong Oct–Apr).

import {
  parseAvailability,
  generateAvailabilityWindows,
  bookedWindowKey,
  type Period,
} from './availability'

const TZ = 'Australia/Sydney'

export const DEFAULT_SLOT_OPTS = {
  /** How many calendar days ahead to scan for weekdays. */
  daysAhead: 21,
  /** Cap on returned slots — keeps the picker to a sensible size. */
  maxSlots: 18,
  /** Sydney-local hours offered each weekday (9am, 12pm, 3pm). */
  hours: [9, 12, 15] as number[],
  /** Lead time: a generated slot must be at least this many hours away. */
  minLeadHours: 18,
}

export type SlotOpts = Partial<typeof DEFAULT_SLOT_OPTS>

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// Minutes that `timeZone` is ahead of UTC at the instant `date`.
// Standard Intl round-trip: format the instant as wall-clock in the zone,
// re-read it as if UTC, and diff. DST-correct for any date.
function tzOffsetMinutes(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const m: Record<string, string> = {}
  for (const p of dtf.formatToParts(date)) m[p.type] = p.value
  // Some engines emit '24' for midnight — normalise to '00'.
  const hour = m.hour === '24' ? '00' : m.hour
  const asUTC = Date.UTC(
    +m.year,
    +m.month - 1,
    +m.day,
    +hour,
    +m.minute,
    +m.second,
  )
  return (asUTC - date.getTime()) / 60000
}

// ISO timestamp for a Sydney wall-clock (y, mo, d, h) carrying the correct
// DST offset, e.g. "2026-06-10T09:00:00+10:00" (standard) or
// "2026-01-12T09:00:00+11:00" (daylight saving).
function sydneyIso(y: number, mo: number, d: number, h: number): string {
  // The offset is locally constant except inside the ~1h DST transition,
  // which never lands on a 9/12/15:00 slot — so an initial UTC guess gives
  // the right offset for that calendar date.
  const guess = Date.UTC(y, mo - 1, d, h, 0, 0)
  const offMin = tzOffsetMinutes(TZ, new Date(guess))
  const sign = offMin >= 0 ? '+' : '-'
  const abs = Math.abs(offMin)
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:00:00${sign}${pad(
    Math.floor(abs / 60),
  )}:${pad(abs % 60)}`
}

// The Sydney calendar date (y, mo, d) for an instant.
function sydneyDate(date: Date): { y: number; mo: number; d: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const m: Record<string, string> = {}
  for (const p of dtf.formatToParts(date)) m[p.type] = p.value
  return { y: +m.year, mo: +m.month, d: +m.day }
}

// Generate a rolling window of future weekday slots at Sydney business
// hours, starting from `now`. Deterministic for a fixed `now`.
export function rollingSlots(now: number = Date.now(), opts: SlotOpts = {}): string[] {
  const o = { ...DEFAULT_SLOT_OPTS, ...opts }
  const earliest = now + o.minLeadHours * 3600_000
  const out: string[] = []

  // Step calendar days off today's Sydney date. A UTC Date pinned to noon
  // is used purely as a calendar counter, so getUTCDay() == the weekday of
  // that Sydney calendar date and day-stepping is immune to DST drift.
  const today = sydneyDate(new Date(now))
  const cursor = new Date(Date.UTC(today.y, today.mo - 1, today.d, 12, 0, 0))

  for (let i = 0; i <= o.daysAhead && out.length < o.maxSlots; i++) {
    const y = cursor.getUTCFullYear()
    const mo = cursor.getUTCMonth() + 1
    const d = cursor.getUTCDate()
    const dow = cursor.getUTCDay() // 0 Sun … 6 Sat
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (dow === 0 || dow === 6) continue // weekdays only
    for (const h of o.hours) {
      if (out.length >= o.maxSlots) break
      const iso = sydneyIso(y, mo, d, h)
      const t = Date.parse(iso)
      if (Number.isFinite(t) && t >= earliest) out.push(iso)
    }
  }
  return out
}

// Future, parseable, de-duplicated, time-sorted slots from a stored list.
export function futureStoredSlots(stored: unknown, now: number = Date.now()): string[] {
  const arr = Array.isArray(stored) ? stored : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of arr) {
    if (typeof s !== 'string' || seen.has(s)) continue
    const t = Date.parse(s)
    if (Number.isFinite(t) && t > now) {
      seen.add(s)
      out.push(s)
    }
  }
  return out.sort((a, b) => Date.parse(a) - Date.parse(b))
}

// The slots a customer can actually book: a tenant's own FUTURE curated
// slots when they have any, otherwise a generated rolling window so the
// picker is never empty. Used by BOTH the booking page and the booking
// API so render and validation always agree on what's bookable.
export function resolveBookableSlots(
  stored: unknown,
  now: number = Date.now(),
  opts: SlotOpts = {},
): string[] {
  const curated = futureStoredSlots(stored, now)
  if (curated.length > 0) return curated
  return rollingSlots(now, opts)
}

// ── Default-availability integration (spec post-payment-scheduling) ──
//
// A single resolver the booking PAGE and the booking API both call so
// render + validation never disagree on what's bookable. When the tenant
// has a valid weekly availability template, the customer picks an AM/PM
// half-day WINDOW generated from it (with already-booked windows excluded);
// otherwise we fall back to the legacy raw-slot list (exact-time picks).

export interface BookingOption {
  /** Canonical instant the customer books (stored on quotes.scheduled_at). */
  iso: string
  /** 'am' | 'pm' for template windows; null for legacy exact-time slots. */
  period: Period | null
  /** Date heading the picker groups by, e.g. 'Mon 7 Jul'. */
  dayLabel: string
  /** Chip text, e.g. 'Morning (7am–12pm)' or '9:00 am'. */
  chipLabel: string
}

// Exact-time label for a legacy raw slot (no availability template).
function exactSlotLabels(iso: string, timeZone: string): { dayLabel: string; chipLabel: string } {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return { dayLabel: iso, chipLabel: iso }
  const d = new Date(t)
  const dayLabel = d
    .toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone })
    .replace(/\s+/g, ' ')
    .trim()
  const chipLabel = d
    .toLocaleString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone })
    .replace(/\s+/g, ' ')
    .trim()
  return { dayLabel, chipLabel }
}

/**
 * The customer-bookable options for a tenant. With a valid availability
 * template → generated AM/PM windows (already-booked windows in `bookedKeys`
 * excluded). Without one → the legacy curated/rolling slot list as exact-time
 * options. Pure + deterministic given `now`.
 */
export function resolveBookingOptions(args: {
  availability: unknown
  availableSlots: unknown
  /** Tenant timezone for legacy exact-time labels; defaults to Sydney. */
  timezone?: string
  bookedKeys?: ReadonlySet<string>
  now?: number
  opts?: SlotOpts
}): BookingOption[] {
  const now = args.now ?? Date.now()
  const av = parseAvailability(args.availability)
  if (av) {
    return generateAvailabilityWindows(av, now, args.bookedKeys ?? new Set()).map((w) => ({
      iso: w.iso,
      period: w.period,
      dayLabel: w.dayLabel,
      chipLabel: w.chipLabel,
    }))
  }
  const tz = args.timezone || TZ
  return resolveBookableSlots(args.availableSlots, now, args.opts).map((iso) => {
    const { dayLabel, chipLabel } = exactSlotLabels(iso, tz)
    return { iso, period: null as Period | null, dayLabel, chipLabel }
  })
}

/**
 * Build the set of already-booked window keys for a tenant from existing
 * active bookings, so generated windows can exclude them (one booking per
 * window, spec R16). Rows are other quotes with a chosen slot.
 */
export function buildBookedKeys(
  rows: Array<{ scheduled_at: string | null; scheduled_window: string | null }>,
  timeZone: string,
): Set<string> {
  const keys = new Set<string>()
  for (const r of rows) {
    const k = bookedWindowKey(
      r.scheduled_at,
      (r.scheduled_window as Period | null) ?? null,
      timeZone,
    )
    if (k) keys.add(k)
  }
  return keys
}
