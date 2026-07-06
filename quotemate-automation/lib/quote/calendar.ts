// Calendar helpers for the customer payment-confirmation page — turn a
// confirmed booking (quotes.scheduled_at + scheduled_window) into an
// "add to calendar" .ics file and a one-click Google Calendar link.
//
// PURE + deterministic (no Date.now(), no DB, no I/O) so it is fully
// unit-testable and safe to call from a route. scheduled_at is stored as
// an ABSOLUTE instant, so no timezone maths is needed here — the window
// only sets the event's duration. (Spec 2026-07-05 Part B3.)

export type QuoteCalendarEvent = {
  /** quotes.id — used to build a stable, deterministic ICS UID. */
  quoteId: string
  start: Date
  end: Date
  summary: string
  description: string
  /** Service address / suburb, or null when unknown. */
  location: string | null
}

/** Format a Date as an absolute UTC iCalendar stamp: YYYYMMDDTHHMMSSZ. */
function toUtcStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  )
}

/** RFC 5545 text escaping — backslash, semicolon, comma, and newlines. */
function escapeIcsText(s: string): string {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** RFC 5545 line folding — content lines SHOULD be ≤75 chars; longer lines
 *  are split with CRLF + a leading space on each continuation. */
function foldIcsLine(line: string): string {
  if (line.length <= 75) return line
  const chunks: string[] = [line.slice(0, 75)]
  let i = 75
  while (i < line.length) {
    chunks.push(' ' + line.slice(i, i + 74))
    i += 74
  }
  return chunks.join('\r\n')
}

/**
 * PURE — the event's time window. `scheduled_at` is an absolute instant, so
 * `start` is exactly that; `end` is `start` + a duration: 4h for an am/pm
 * half-day window (the customer only ever saw "morning"/"afternoon"), 2h
 * for a legacy exact-time slot (`scheduled_window` null/other).
 */
export function resolveEventWindow(
  scheduledAtIso: string,
  scheduledWindow: string | null | undefined,
): { start: Date; end: Date } {
  const start = new Date(scheduledAtIso)
  const isHalfDay = scheduledWindow === 'am' || scheduledWindow === 'pm'
  const durationMs = (isHalfDay ? 4 : 2) * 60 * 60 * 1000
  const end = new Date(start.getTime() + durationMs)
  return { start, end }
}

/**
 * PURE — a complete RFC 5545 VCALENDAR/VEVENT string for the booking.
 * Deterministic: UID is derived from the quote id and DTSTAMP from the
 * event start (never Date.now()), so the same booking always serialises
 * identically. Datetimes are absolute UTC (`...Z`).
 */
export function buildQuoteIcs(event: QuoteCalendarEvent): string {
  const dtStart = toUtcStamp(event.start)
  const dtEnd = toUtcStamp(event.end)
  const dtStamp = toUtcStamp(event.start)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//QuoteMax//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.quoteId}@quotemate`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    ...(event.location ? [`LOCATION:${escapeIcsText(event.location)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(foldIcsLine).join('\r\n') + '\r\n'
}

/**
 * PURE — a one-click Google Calendar "add event" URL. The `dates` range
 * keeps a literal slash between the two absolute-UTC stamps (which need no
 * encoding); every free-text field is URL-encoded.
 */
export function buildGoogleCalendarUrl(event: QuoteCalendarEvent): string {
  const enc = encodeURIComponent
  const parts = [
    'action=TEMPLATE',
    `text=${enc(event.summary)}`,
    `dates=${toUtcStamp(event.start)}/${toUtcStamp(event.end)}`,
    `details=${enc(event.description)}`,
  ]
  if (event.location) parts.push(`location=${enc(event.location)}`)
  return `https://calendar.google.com/calendar/render?${parts.join('&')}`
}
