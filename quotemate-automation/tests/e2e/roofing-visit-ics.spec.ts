// Roofing booking add-to-calendar integration (end-to-end).
//
// Seeds a PAID + BOOKED roofing_measurements row and proves the calendar
// integration on the booking page really works:
//   1. GET /q/roof/<token>/visit.ics serves a valid, importable calendar file
//      (text/calendar attachment, real VEVENT) — the reliable path that adds
//      the visit to Apple/Google/Outlook on the customer's phone.
//   2. The .ics route is gated: a bogus token 404s.
//   3. The /book page renders the add-to-calendar options with correctly-formed
//      links: the .ics download primary, Google with ctz, Outlook without the
//      /0/ mailbox segment, and an Outlook (work) office.com variant.
//
// Seeded-row pattern mirrors tests/e2e/roofing-five-sections.spec.ts:
// service-role insert in beforeAll, delete in afterAll, skip without env.

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const seedable = Boolean(url && key)

test.describe.configure({ mode: 'serial' })

const token = `e2e${randomBytes(12).toString('hex')}`

test.describe('Roofing booking add-to-calendar (.ics + web links)', () => {
  test.skip(!seedable, 'Supabase service-role env not available for seeding')

  let tenantId: string

  test.beforeAll(async () => {
    const supabase = createClient(url!, key!)
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .insert({
        business_name: 'E2E Calendar Roofing Co',
        trade: 'electrical',
        status: 'active',
        state: 'QLD',
        owner_email: `e2e-visit-ics-${token}@example.com`,
        owner_mobile: '+61400000003',
      })
      .select('id')
      .single()
    if (tenantErr || !tenant) throw new Error(`tenant seed failed: ${tenantErr?.message}`)
    tenantId = tenant.id as string

    // A paid + booked site visit — exactly the state the .ics + AddToCalendar
    // render for. scheduled_at is a UTC instant (as Postgres returns it).
    const { error: measureErr } = await supabase.from('roofing_measurements').insert({
      tenant_id: tenantId,
      address: '28 Greens Rd, Coorparoo QLD 4151',
      state: 'QLD',
      public_token: token,
      paid_at: new Date().toISOString(),
      paid_tier: 'inspection',
      scheduled_at: '2026-07-27T05:00:00+00:00', // 3pm AEST
      scheduled_window: null,
    })
    if (measureErr) throw new Error(`measurement seed failed: ${measureErr.message}`)
  })

  test.afterAll(async () => {
    const supabase = createClient(url!, key!)
    await supabase.from('roofing_measurements').delete().eq('public_token', token)
    if (tenantId) await supabase.from('tenants').delete().eq('id', tenantId)
  })

  test('visit.ics serves a valid text/calendar attachment with a real VEVENT', async ({
    page,
  }) => {
    const resp = await page.request.get(`/q/roof/${token}/visit.ics`)
    expect(resp.status()).toBe(200)
    expect(resp.headers()['content-type']).toContain('text/calendar')
    expect(resp.headers()['content-disposition']).toContain('attachment')
    const body = await resp.text()
    expect(body.startsWith('BEGIN:VCALENDAR')).toBeTruthy()
    expect(body).toContain('BEGIN:VEVENT')
    expect(body).toContain('DTSTART:20260727T050000Z') // the booked instant, in UTC
    expect(body).toContain('SUMMARY:E2E Calendar Roofing Co roof site visit')
    expect(body.trimEnd().endsWith('END:VCALENDAR')).toBeTruthy()
    // RFC5545 §3.1: no physical line exceeds 75 octets.
    for (const line of body.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75)
    }
  })

  test('visit.ics 404s for an unknown token', async ({ page }) => {
    const resp = await page.request.get(`/q/roof/deadbeefdeadbeefdeadbeefdeadbeef/visit.ics`, {
      maxRedirects: 0,
    })
    expect(resp.status()).toBe(404)
  })

  test('the /book page renders correctly-formed add-to-calendar links', async ({ page }) => {
    await page.goto(`/q/roof/${token}/book`)

    // Primary: the reliable .ics download route.
    const ics = page.getByRole('link', { name: 'Add to calendar' })
    await expect(ics).toHaveAttribute('href', `/q/roof/${token}/visit.ics`)

    // Google — real template URL pinned to the property timezone via ctz.
    const google = page.getByRole('link', { name: 'Google', exact: true })
    await expect(google).toHaveAttribute('href', /calendar\.google\.com\/calendar\/render\?/)
    await expect(google).toHaveAttribute('href', /ctz=Australia/)

    // Outlook personal — deeplink WITHOUT the /0/ mailbox segment.
    const outlook = page.getByRole('link', { name: 'Outlook', exact: true })
    await expect(outlook).toHaveAttribute('href', /outlook\.live\.com\/calendar\/deeplink\/compose\?/)
    await expect(outlook).not.toHaveAttribute('href', /\/calendar\/0\//)

    // Outlook work/school — office.com host for Microsoft 365 accounts.
    const outlookWork = page.getByRole('link', { name: 'Outlook (work)', exact: true })
    await expect(outlookWork).toHaveAttribute('href', /outlook\.office\.com\/calendar\/deeplink\/compose\?/)
  })
})
