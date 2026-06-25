// Tradie default schedule availability — the weekly working-hours template
// and the AM/PM half-day window generator the customer booking flow renders.
//
// Why this exists: `tenants.available_slots` is a flat list of ISO instants a
// tradie hand-curates (and which decays to all-past). The default-availability
// model (migration 147) lets a tradie set recurring weekly hours instead, and
// the customer picks a MORNING or AFTERNOON half-day window derived from those
// hours rather than an exact time.
//
// Pure + deterministic given `now` (no DB, no Stripe, no Next), so the booking
// PAGE (renders the picker) and the booking API (validates the picked window)
// derive the IDENTICAL window list and never disagree. DST-correct via Intl —
// no hardcoded offsets.

import { z } from 'zod'

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

// Monday-first; index 0..6. getUTCDay() is Sunday-first (0=Sun), mapped below.
export const DAY_KEYS: readonly DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export type Period = 'am' | 'pm'

export interface AvailabilityDay {
  enabled: boolean
  /** 'HH:MM' 24h local start, or null when disabled. */
  start: string | null
  /** 'HH:MM' 24h local end, or null when disabled. */
  end: string | null
}

export interface WeeklyAvailability {
  version: number
  /** IANA zone, e.g. 'Australia/Sydney'. Drives every window instant. */
  timezone: string
  days: Record<DayKey, AvailabilityDay>
}

// Noon split between morning and afternoon, in minutes-from-midnight.
const NOON_MIN = 12 * 60

// ── State → IANA timezone ───────────────────────────────────────────
// AU has no single zone. Derived from the tenant's `state` (spec R13).
// DST is handled by the IANA zone itself — never fixed offsets.
export const STATE_TIMEZONES: Record<string, string> = {
  NSW: 'Australia/Sydney',
  VIC: 'Australia/Sydney',
  ACT: 'Australia/Sydney',
  TAS: 'Australia/Sydney',
  QLD: 'Australia/Brisbane',
  SA: 'Australia/Adelaide',
  NT: 'Australia/Darwin',
  WA: 'Australia/Perth',
}

/** IANA zone for an AU state; falls back to Sydney for unknown/empty. */
export function tzForState(state: string | null | undefined): string {
  if (!state) return 'Australia/Sydney'
  return STATE_TIMEZONES[state] ?? 'Australia/Sydney'
}

// ── Default template (spec R12: Mon–Fri 07:00–15:00, weekend off) ───
function workday(): AvailabilityDay {
  return { enabled: true, start: '07:00', end: '15:00' }
}
function dayOff(): AvailabilityDay {
  return { enabled: false, start: null, end: null }
}

/** A fresh default weekly template in the given (or Sydney) timezone. */
export function defaultAvailability(timezone = 'Australia/Sydney'): WeeklyAvailability {
  return {
    version: 1,
    timezone,
    days: {
      mon: workday(),
      tue: workday(),
      wed: workday(),
      thu: workday(),
      fri: workday(),
      sat: dayOff(),
      sun: dayOff(),
    },
  }
}

/** Default template with the timezone derived from an AU state. */
export function defaultAvailabilityForState(state: string | null | undefined): WeeklyAvailability {
  return defaultAvailability(tzForState(state))
}

// ── Validation (spec R19: start < end; enabled days need both times) ─
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

const DaySchema = z
  .object({
    enabled: z.boolean(),
    start: z.string().regex(HHMM).nullable(),
    end: z.string().regex(HHMM).nullable(),
  })
  .superRefine((d, ctx) => {
    if (!d.enabled) return
    if (!d.start || !d.end) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enabled day needs a start and end time' })
      return
    }
    if (toMinutes(d.start)! >= toMinutes(d.end)!) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Start must be before end' })
    }
  })

export const AvailabilitySchema = z.object({
  version: z.literal(1).default(1),
  timezone: z.string().min(1).max(64),
  days: z.object({
    mon: DaySchema,
    tue: DaySchema,
    wed: DaySchema,
    thu: DaySchema,
    fri: DaySchema,
    sat: DaySchema,
    sun: DaySchema,
  }),
})

export type AvailabilityInput = z.input<typeof AvailabilitySchema>

/** Parse + validate untrusted availability; returns null when invalid. */
export function parseAvailability(raw: unknown): WeeklyAvailability | null {
  const r = AvailabilitySchema.safeParse(raw)
  return r.success ? (r.data as WeeklyAvailability) : null
}

// ── Time helpers ────────────────────────────────────────────────────
/** 'HH:MM' → minutes from midnight, or null when malformed. */
export function toMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null
  const m = HHMM.exec(hhmm)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// Minutes `timeZone` is ahead of UTC at instant `date` (DST-correct).
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
  const hour = m.hour === '24' ? '00' : m.hour
  const asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, +hour, +m.minute, +m.second)
  return (asUTC - date.getTime()) / 60000
}

// ISO timestamp for a local wall-clock (y, mo, d, minutes-from-midnight) in
// `timeZone`, carrying the correct DST offset.
function zonedIso(timeZone: string, y: number, mo: number, d: number, minutes: number): string {
  const h = Math.floor(minutes / 60)
  const mi = minutes % 60
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0)
  const offMin = tzOffsetMinutes(timeZone, new Date(guess))
  const sign = offMin >= 0 ? '+' : '-'
  const abs = Math.abs(offMin)
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

// The local calendar date (y, mo, d) for an instant in `timeZone`.
function zonedDateParts(timeZone: string, date: Date): { y: number; mo: number; d: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const m: Record<string, string> = {}
  for (const p of dtf.formatToParts(date)) m[p.type] = p.value
  return { y: +m.year, mo: +m.month, d: +m.day }
}

// ── AM/PM derivation (spec R14) ─────────────────────────────────────
export interface DayWindows {
  am: { startMin: number; endMin: number } | null
  pm: { startMin: number; endMin: number } | null
}

/**
 * Split a day's working hours into a morning and/or afternoon window at noon.
 *  • AM exists when the hours overlap 00:00–12:00.
 *  • PM exists when the hours overlap 12:00–24:00.
 * A disabled / malformed day yields neither.
 */
export function dayToWindows(day: AvailabilityDay): DayWindows {
  if (!day.enabled) return { am: null, pm: null }
  const s = toMinutes(day.start)
  const e = toMinutes(day.end)
  if (s === null || e === null || s >= e) return { am: null, pm: null }
  const am = s < NOON_MIN ? { startMin: s, endMin: Math.min(e, NOON_MIN) } : null
  const pm = e > NOON_MIN ? { startMin: Math.max(s, NOON_MIN), endMin: e } : null
  return { am, pm }
}

// ── Window generation ───────────────────────────────────────────────
export interface BookableWindow {
  /** Canonical start instant of the window (ISO, with DST offset). This is
   *  what the customer "books" and what's stored on quotes.scheduled_at. */
  iso: string
  period: Period
  /** Local calendar date key 'YYYY-MM-DD' for the window. */
  date: string
  /** Stable identity 'YYYY-MM-DD:am' used to exclude already-booked windows. */
  key: string
  /** 'Morning' | 'Afternoon'. */
  label: string
  /** Short local date heading, e.g. 'Mon 7 Jul' (groups the picker). */
  dayLabel: string
  /** Chip text, e.g. 'Morning (7am–12pm)'. */
  chipLabel: string
  /** e.g. 'Mon 7 Jul · Morning (7am–12pm)'. */
  display: string
}

export const DEFAULT_WINDOW_OPTS = {
  /** Calendar days ahead to scan (spec R15: rolling 14-day window). */
  daysAhead: 14,
  /** Cap on returned windows — keeps the picker sensible. */
  maxWindows: 28,
  /** A window must start at least this many minutes from `now` (lead time). */
  minLeadMinutes: 0,
}

export type WindowOpts = Partial<typeof DEFAULT_WINDOW_OPTS>

// getUTCDay() (0=Sun) → our Monday-first DayKey.
function dayKeyForDow(dow: number): DayKey {
  // 0 Sun → 'sun', 1 Mon → 'mon', … 6 Sat → 'sat'
  return (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as DayKey[])[dow]
}

function fmtTime(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  const ampm = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12}${ampm}` : `${h12}:${pad(m)}${ampm}`
}

function fmtDateLabel(timeZone: string, iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  try {
    return new Date(t)
      .toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone })
      .replace(/\s+/g, ' ')
      .trim()
  } catch {
    return ''
  }
}

/**
 * Generate the customer-bookable AM/PM windows from a weekly template over a
 * rolling window starting at `now`. Excludes (spec R15):
 *   • windows on disabled days,
 *   • windows whose start instant is already in the past (+ lead time),
 *   • windows in `bookedKeys` (already taken by an active booking).
 * Deterministic for a fixed `now`.
 */
export function generateAvailabilityWindows(
  availability: WeeklyAvailability,
  now: number = Date.now(),
  bookedKeys: ReadonlySet<string> = new Set(),
  opts: WindowOpts = {},
): BookableWindow[] {
  const o = { ...DEFAULT_WINDOW_OPTS, ...opts }
  const tz = availability.timezone || 'Australia/Sydney'
  const earliest = now + o.minLeadMinutes * 60_000
  const out: BookableWindow[] = []

  // Step calendar days off today's local date. A UTC Date pinned to noon is a
  // pure calendar counter, so getUTCDay() is the weekday of that local date and
  // day-stepping is immune to DST drift.
  const today = zonedDateParts(tz, new Date(now))
  const cursor = new Date(Date.UTC(today.y, today.mo - 1, today.d, 12, 0, 0))

  for (let i = 0; i <= o.daysAhead && out.length < o.maxWindows; i++) {
    const y = cursor.getUTCFullYear()
    const mo = cursor.getUTCMonth() + 1
    const d = cursor.getUTCDate()
    const dow = cursor.getUTCDay()
    cursor.setUTCDate(cursor.getUTCDate() + 1)

    const day = availability.days[dayKeyForDow(dow)]
    if (!day) continue
    const wins = dayToWindows(day)
    const dateKey = `${y}-${pad(mo)}-${pad(d)}`

    for (const period of ['am', 'pm'] as Period[]) {
      if (out.length >= o.maxWindows) break
      const w = wins[period]
      if (!w) continue
      const iso = zonedIso(tz, y, mo, d, w.startMin)
      const t = Date.parse(iso)
      if (!Number.isFinite(t) || t < earliest) continue
      const key = `${dateKey}:${period}`
      if (bookedKeys.has(key)) continue
      const label = period === 'am' ? 'Morning' : 'Afternoon'
      const dayLabel = fmtDateLabel(tz, iso)
      const chipLabel = `${label} (${fmtTime(w.startMin)}–${fmtTime(w.endMin)})`
      out.push({
        iso,
        period,
        date: dateKey,
        key,
        label,
        dayLabel,
        chipLabel,
        display: `${dayLabel} · ${chipLabel}`,
      })
    }
  }
  return out
}

/**
 * The window identity ('YYYY-MM-DD:am') for an existing booking, so generated
 * windows can exclude times already taken. `period` is used when stored
 * (quotes.scheduled_window); otherwise derived from the local hour of the
 * instant (before noon → am, else pm) for legacy bookings.
 */
export function bookedWindowKey(
  iso: string | null | undefined,
  period: Period | null | undefined,
  timeZone: string,
): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const { y, mo, d } = zonedDateParts(timeZone, new Date(t))
  const dateKey = `${y}-${pad(mo)}-${pad(d)}`
  let p: Period
  if (period === 'am' || period === 'pm') {
    p = period
  } else {
    // Derive from local wall-clock hour.
    const off = tzOffsetMinutes(timeZone, new Date(t))
    const localMin = (((t / 60000 + off) % 1440) + 1440) % 1440
    p = localMin < NOON_MIN ? 'am' : 'pm'
  }
  return `${dateKey}:${p}`
}
