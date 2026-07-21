// lib/quote/visit-ics-response.test.ts
//
// The /q/roof/[token]/visit.ics route's HTTP contract: it must serve a valid,
// importable calendar file with the right headers for a paid + scheduled visit,
// and 404 otherwise. Tested via the pure visitIcsResponse() the route delegates
// to, so the contract is locked without a running server or DB.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { visitIcsResponse } from './visit-ics-response'

const paidRow = {
  paid_at: '2026-07-01T00:00:00+00:00',
  scheduled_at: '2026-07-27T05:00:00+00:00', // 3pm AEST
  scheduled_window: null,
  address: '28 Greens Rd, Coorparoo QLD 4151',
  state: 'QLD',
}

test('paid + scheduled visit -> 200 text/calendar attachment with a valid VEVENT', async () => {
  const res = visitIcsResponse(paidRow, 'Sparky', 'QLD')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'text/calendar; charset=utf-8')
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="site-visit.ics"')
  const body = await res.text()
  assert.ok(body.startsWith('BEGIN:VCALENDAR\r\n'), body.slice(0, 40))
  assert.ok(body.includes('BEGIN:VEVENT'))
  assert.ok(body.includes('DTSTART:20260727T050000Z')) // the real instant
  assert.ok(body.includes('SUMMARY:Sparky roof site visit'))
  assert.ok(body.includes('LOCATION:28 Greens Rd'))
  assert.ok(body.trimEnd().endsWith('END:VCALENDAR'))
})

test('unpaid visit -> 404 (no calendar entry before payment)', () => {
  assert.equal(visitIcsResponse({ ...paidRow, paid_at: null }, 'Sparky', 'QLD').status, 404)
})

test('paid but not yet scheduled -> 404', () => {
  assert.equal(visitIcsResponse({ ...paidRow, scheduled_at: null }, 'Sparky', 'QLD').status, 404)
})

test('missing measurement row -> 404', () => {
  assert.equal(visitIcsResponse(null, null, null).status, 404)
})

test('falls back to "Your roofer" when the tenant has no business name', async () => {
  const body = await visitIcsResponse(paidRow, null, 'QLD').text()
  assert.ok(body.includes('SUMMARY:Your roofer roof site visit'))
})

test('half-day window booking still produces a valid dated VEVENT', async () => {
  const body = await visitIcsResponse(
    { ...paidRow, scheduled_window: 'am', scheduled_at: '2026-07-06T21:00:00+00:00' },
    'Sparky',
    'QLD',
  ).text()
  assert.ok(body.includes('DTSTART:20260706T210000Z'))
  assert.ok(body.includes('DTEND:20260707T000000Z')) // +3h half-day block
})
