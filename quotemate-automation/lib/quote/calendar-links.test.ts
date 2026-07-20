// lib/quote/calendar-links.test.ts
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { buildCalendarLinks, buildIcsText, visitCalendarLinks, visitIcsText } from './calendar-links'

const base = {
  title: 'Roof site visit, QuoteMate',
  // Clean UTC instants so the compact/Z encodings are obvious to read.
  startIso: '2026-07-06T21:00:00Z',
  endIso: '2026-07-06T23:30:00Z',
  // One value exercising all four RFC5545 special chars: backslash, comma,
  // semicolon, and a real newline.
  details: 'Note: back\\slash, semi; new\nline',
  location: '12 Smith St, Bondi',
}

function icsText(uri: string): string {
  return decodeURIComponent(uri.replace(/^data:text\/calendar;charset=utf-8,/, ''))
}
// Reverse RFC5545 §3.1 folding (CRLF + single leading space) for assertions.
function unfold(text: string): string {
  return text.replace(/\r\n /g, '')
}

test('all three links are produced', () => {
  const l = buildCalendarLinks(base)
  assert.ok(l.google.startsWith('https://calendar.google.com/calendar/render?'))
  assert.ok(l.outlook.startsWith('https://outlook.live.com/calendar/0/deeplink/compose?'))
  assert.ok(l.ics.startsWith('data:text/calendar;charset=utf-8,'))
})

test('google encodes dates as compact UTC with a literal slash', () => {
  const l = buildCalendarLinks(base)
  assert.ok(
    l.google.includes('dates=20260706T210000Z/20260706T233000Z'),
    l.google,
  )
  // text is percent-encoded (space -> %20, comma -> %2C).
  assert.ok(l.google.includes('text=Roof%20site%20visit%2C%20QuoteMate'))
})

test('ics escapes RFC5545 special chars (backslash, comma, semicolon, newline)', () => {
  const text = unfold(icsText(buildCalendarLinks(base).ics))
  const line = text.split('\r\n').find((x) => x.startsWith('DESCRIPTION:'))
  // \  -> \\   ,  -> \,   ;  -> \;   \n -> \n (literal backslash-n)
  assert.equal(line, 'DESCRIPTION:Note: back\\\\slash\\, semi\\; new\\nline')
})

test('ics is a single VEVENT with deterministic DTSTAMP + UTC times', () => {
  const text = unfold(icsText(buildCalendarLinks(base).ics))
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\n'))
  assert.ok(text.includes('BEGIN:VEVENT'))
  assert.ok(text.includes('DTSTART:20260706T210000Z'))
  assert.ok(text.includes('DTEND:20260706T233000Z'))
  // DTSTAMP is derived from the start instant, NOT Date.now().
  assert.ok(text.includes('DTSTAMP:20260706T210000Z'))
  assert.ok(/\r\nUID:.+@quotemate\r\n/.test(text))
  assert.ok(text.trimEnd().endsWith('END:VCALENDAR'))
})

test('ics folds lines longer than 75 octets (RFC5545 §3.1)', () => {
  const raw = buildIcsText({
    ...base,
    details:
      'Roof site visit with Sparky. Half-day window: Tue morning. Your tradie will confirm the exact time by SMS.',
  })
  // Every physical line must be <= 75 octets.
  const enc = new TextEncoder()
  for (const physical of raw.split('\r\n')) {
    assert.ok(enc.encode(physical).length <= 75, `line too long: ${physical}`)
  }
  // The long DESCRIPTION was folded (a continuation line starts with a space)…
  assert.ok(raw.includes('\r\n '))
  // …and unfolding recovers the original escaped value intact.
  const desc = unfold(raw).split('\r\n').find((x) => x.startsWith('DESCRIPTION:'))
  assert.ok(desc?.includes('confirm the exact time by SMS.'))
})

test('outlook deep-link carries ISO-8601 UTC start/end', () => {
  const l = buildCalendarLinks(base)
  // URLSearchParams encodes ':' as %3A.
  assert.ok(l.outlook.includes('startdt=2026-07-06T21%3A00%3A00Z'))
  assert.ok(l.outlook.includes('enddt=2026-07-06T23%3A30%3A00Z'))
})

test('offset ISO inputs normalise to the same UTC instant', () => {
  const l = buildCalendarLinks({
    ...base,
    startIso: '2026-07-07T07:00:00+10:00', // == 2026-07-06T21:00:00Z
    endIso: '2026-07-07T09:30:00+10:00', // == 2026-07-06T23:30:00Z
  })
  assert.ok(l.google.includes('dates=20260706T210000Z/20260706T233000Z'))
})

test('deterministic: same opts -> identical output (no clock read)', () => {
  assert.deepEqual(buildCalendarLinks(base), buildCalendarLinks(base))
  assert.equal(buildIcsText(base), buildIcsText(base))
})

// ── visitCalendarLinks / visitIcsText: window -> start/end mapping ──

test('visitCalendarLinks: exact-time slot (null window) = start + 2h block', () => {
  // Postgres-form UTC instant, as returned by Supabase.
  const l = visitCalendarLinks({
    scheduledAt: '2026-07-27T05:00:00+00:00', // 3pm AEST
    scheduledWindow: null,
    tradieName: 'Sparky',
    slotLabel: 'Mon, 27 July, 3:00 pm',
    location: '28 Greens Rd, Coorparoo QLD',
  })!
  assert.ok(l.google.includes('dates=20260727T050000Z/20260727T070000Z')) // +2h
  assert.ok(l.google.includes('text=Sparky%20roof%20site%20visit'))
})

test('visitCalendarLinks: half-day window = start + 3h block', () => {
  const l = visitCalendarLinks({
    scheduledAt: '2026-07-06T21:00:00+00:00',
    scheduledWindow: 'am',
    tradieName: 'Sparky',
    slotLabel: 'Tue morning',
  })!
  assert.ok(l.google.includes('dates=20260706T210000Z/20260707T000000Z')) // +3h
})

test('visitIcsText: valid VCALENDAR for a booking; null on bad instant', () => {
  const text = visitIcsText({
    scheduledAt: '2026-07-27T05:00:00+00:00',
    scheduledWindow: null,
    tradieName: 'Sparky',
    slotLabel: 'Mon, 27 July, 3:00 pm',
    location: '28 Greens Rd, Coorparoo QLD',
  })!
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\n'))
  assert.ok(text.includes('DTSTART:20260727T050000Z'))
  assert.equal(
    visitIcsText({ scheduledAt: 'not-a-date', scheduledWindow: null, tradieName: 'X', slotLabel: 'Y' }),
    null,
  )
})

test('visitCalendarLinks: invalid instant -> null (no throw)', () => {
  assert.equal(
    visitCalendarLinks({ scheduledAt: 'not-a-date', scheduledWindow: null, tradieName: 'X', slotLabel: 'Y' }),
    null,
  )
})
