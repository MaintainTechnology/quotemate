// lib/quote/calendar-links.ts
//
// "Add to calendar" deep-links + ICS for a booked site visit. Pure,
// dependency-free, and DETERMINISTIC: given the same opts it returns the same
// strings. DTSTAMP + UID derive from the event's own fields, never from
// Date.now()/new Date() at load time, so it's testable and safe to call during
// a server-component render (no hydration mismatch, no per-request drift).
//
// The helper is deliberately dumb about windows: it takes a start and end ISO
// and normalises both to UTC. The CALLER maps scheduled_at + scheduled_window
// onto start/end — see visitCalendarLinks() / visitIcsText() below.
//
// Two ICS delivery paths: buildCalendarLinks().ics is a data: URI (handy as an
// inline fallback), and buildIcsText() returns the raw text for a real route
// (app/q/roof/[token]/visit.ics) — the route is the reliable path on iOS
// Safari, which ignores the download attribute on data: URIs.

export interface CalendarLinksOpts {
  title: string
  /** Window start. Any valid ISO (offset or Z); normalised to UTC internally. */
  startIso: string
  /** Window end. Any valid ISO (offset or Z). */
  endIso: string
  details?: string
  location?: string
  /** IANA tz (e.g. "Australia/Brisbane"). Pins the Google event to the
   *  property's local time via ctz, so an interstate customer still sees the
   *  visit at the site's wall-clock time, not their phone's. */
  timeZone?: string
}

export interface CalendarLinks {
  google: string
  /** Outlook.com — personal Microsoft accounts (Outlook.com / Hotmail / Live). */
  outlook: string
  /** Outlook on the web — work / school Microsoft 365 (Entra) accounts. */
  outlookOffice: string
  /** ICS as a data: URI. The .ics route is preferred on mobile — see module doc. */
  ics: string
}

// "2026-07-07T07:00:00+10:00" -> "20260706T210000Z" (compact UTC, Z-suffixed).
function toUtcCompact(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) throw new Error(`calendar-links: invalid ISO "${iso}"`)
  return new Date(t)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '')
}

// Same instant as a plain UTC ISO-8601 ("2026-07-06T21:00:00Z") for Outlook.
function toUtcIso(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) throw new Error(`calendar-links: invalid ISO "${iso}"`)
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// RFC5545 §3.3.11 TEXT escaping: backslash first, then comma, semicolon,
// newline. Order matters — backslash must be escaped before the escapes we add.
function icsEscape(v: string): string {
  return v
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

// RFC5545 §3.1 content-line folding: a line MUST NOT exceed 75 octets; longer
// lines fold onto continuation lines that begin with a single space. Byte-aware
// (UTF-8), so a multi-byte char is never split across the boundary.
function foldIcsLine(line: string): string {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 75) return line
  const segments: string[] = []
  let cur = ''
  let curBytes = 0
  for (const ch of line) {
    const chBytes = enc.encode(ch).length
    // First physical line may use 75 octets; continuation lines carry a leading
    // space, so their own content budget is 74.
    const limit = segments.length === 0 ? 75 : 74
    if (curBytes + chBytes > limit) {
      segments.push(cur)
      cur = ch
      curBytes = chBytes
    } else {
      cur += ch
      curBytes += chBytes
    }
  }
  segments.push(cur)
  return segments.join('\r\n ')
}

// Stable, non-random UID from the event's own fields (no crypto, no clock) so
// re-issuing the same booking updates the calendar entry in place.
function stableUid(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  return `${(h >>> 0).toString(36)}@quotemate`
}

/** Raw RFC5545 VCALENDAR text (folded, escaped). Deterministic. */
export function buildIcsText(opts: CalendarLinksOpts): string {
  const startCompact = toUtcCompact(opts.startIso)
  const endCompact = toUtcCompact(opts.endIso)
  const startUtc = toUtcIso(opts.startIso)
  const endUtc = toUtcIso(opts.endIso)
  const uid = stableUid(`${startUtc}|${endUtc}|${opts.title}`)
  // DTSTAMP is derived from the start instant so the output is deterministic;
  // a real "now" is not required for a valid VEVENT.
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//QuoteMate//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${startCompact}`,
    `DTSTART:${startCompact}`,
    `DTEND:${endCompact}`,
    `SUMMARY:${icsEscape(opts.title)}`,
    `DESCRIPTION:${icsEscape(opts.details ?? '')}`,
    `LOCATION:${icsEscape(opts.location ?? '')}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .map(foldIcsLine)
    .join('\r\n')
}

export function buildCalendarLinks(opts: CalendarLinksOpts): CalendarLinks {
  const { title, startIso, endIso, details = '', location = '' } = opts
  const startCompact = toUtcCompact(startIso)
  const endCompact = toUtcCompact(endIso)
  const startUtc = toUtcIso(startIso)
  const endUtc = toUtcIso(endIso)

  // ── Google Calendar ──
  // dates keeps a literal "/" (the conventional Google separator); the compact
  // values are all safe chars so only text/details/location need encoding.
  const enc = encodeURIComponent
  const gParts = [
    'action=TEMPLATE',
    `text=${enc(title)}`,
    `dates=${startCompact}/${endCompact}`,
  ]
  // ctz pins the event to the property's local time (Google converts the UTC
  // dates for display). Without it, an interstate customer sees the visit in
  // their own phone's timezone.
  if (opts.timeZone) gParts.push(`ctz=${enc(opts.timeZone)}`)
  if (details) gParts.push(`details=${enc(details)}`)
  if (location) gParts.push(`location=${enc(location)}`)
  const google = `https://calendar.google.com/calendar/render?${gParts.join('&')}`

  // ── Outlook compose deep-links. startdt/enddt are ISO-8601 UTC. No "/0/"
  // mailbox-index segment (it is not required and can break the deep-link).
  // live.com = personal accounts; office.com = work/school M365 — the query is
  // identical, only the host differs, and a customer on the wrong host lands on
  // a sign-in wall, so surface both.
  const oParams = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: title,
    startdt: startUtc,
    enddt: endUtc,
  })
  if (details) oParams.set('body', details)
  if (location) oParams.set('location', location)
  const oq = oParams.toString()
  const outlook = `https://outlook.live.com/calendar/deeplink/compose?${oq}`
  const outlookOffice = `https://outlook.office.com/calendar/deeplink/compose?${oq}`

  // ── .ics as a data: URI — inline fallback (desktop imports it cleanly). The
  // real .ics route is preferred on mobile; see module doc.
  const ics = `data:text/calendar;charset=utf-8,${encodeURIComponent(buildIcsText(opts))}`

  return { google, outlook, outlookOffice, ics }
}

// ── Booking convenience ───────────────────────────────────────────────
//
// Maps a roofing_measurements booking (scheduled_at + scheduled_window) onto a
// calendar event. TIMEZONE-SAFE: scheduled_at comes back from Postgres as a UTC
// instant ("2026-07-27T05:00:00+00:00"), so we do NOT string-swap the local
// wall clock (that would give noon UTC, not local noon). The start IS the real
// instant; the end is start + a fixed block. The exact window end isn't
// persisted on the row, so the block is a reminder anchor, and `details` states
// the actual slot in words.
// ponytail: fixed 180min (windowed) / 120min (exact) block; load
// tenants.default_availability and use the real window end only if a customer
// asks for a to-the-minute calendar block.
export interface VisitEventInput {
  scheduledAt: string
  scheduledWindow: string | null
  tradieName: string
  /** formatVisitSlot(...) output, e.g. "Mon, 27 July, 3:00 pm" or "Tue morning". */
  slotLabel: string
  location?: string | null
  /** IANA tz of the property — pins the Google event to the site's local time. */
  timeZone?: string | null
}

function visitEventOpts(input: VisitEventInput): CalendarLinksOpts | null {
  const startMs = Date.parse(input.scheduledAt)
  if (!Number.isFinite(startMs)) return null
  const durationMin = input.scheduledWindow ? 180 : 120
  const endIso = new Date(startMs + durationMin * 60_000).toISOString()
  const details =
    `Roof site visit with ${input.tradieName}. ` +
    `${input.scheduledWindow ? 'Half-day window' : 'Scheduled'}: ${input.slotLabel}. ` +
    `Your tradie will confirm the exact time by SMS.`
  return {
    title: `${input.tradieName} roof site visit`,
    startIso: input.scheduledAt,
    endIso,
    details,
    location: input.location ?? undefined,
    timeZone: input.timeZone ?? undefined,
  }
}

export function visitCalendarLinks(input: VisitEventInput): CalendarLinks | null {
  const opts = visitEventOpts(input)
  return opts ? buildCalendarLinks(opts) : null
}

/** Raw ICS text for the .ics route. Null if the instant is invalid. */
export function visitIcsText(input: VisitEventInput): string | null {
  const opts = visitEventOpts(input)
  return opts ? buildIcsText(opts) : null
}
