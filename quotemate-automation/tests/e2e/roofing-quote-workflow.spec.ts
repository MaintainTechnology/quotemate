// Roofing quote workflow e2e — spec quote-sync-and-roofing-workflow-fix R5.
//
// Seeds a promoted roofing quote (the exact shape POST /api/roofing/
// save-as-quote inserts: intakes row trade='roofing' + quotes row with
// buildTierObjects-shaped tiers) and walks the customer surface:
// quote page renders the tiers → the pre-promotion /q/roof link redirects
// to the live quote → the accept/deposit short-link routes book-first →
// picking a slot reserves the booking on the quotes row.
// Payment finalisation and the calendar feed stay covered by vitest
// (lib/quote/paid-confirm.test.ts, app/api/tenant/calendar/route.test.ts).
//
// Seeded-row pattern mirrors tests/e2e/solar-quote-page.spec.ts: service-role
// insert in beforeAll, delete in afterAll, skip when env is absent.

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { resolveBookingOptions } from '../../lib/quote/slots'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const seedable = Boolean(url && key)

// The booking test mutates the seeded quote — keep order deterministic.
test.describe.configure({ mode: 'serial' })

const token = `e2e${randomBytes(12).toString('hex')}`
// public_token of the seeded source measurement (the pre-promotion customer
// link) — /q/roof/<this> must redirect to /q/<token> once promoted.
const publicToken = `e2e${randomBytes(12).toString('hex')}`

// Mirrors lib/roofing/save-as-quote-helpers buildTierObjects output.
const tierObj = (label: string, ex: number) => ({
  label,
  subtotal_ex_gst: ex,
  total_inc_gst: Math.round(ex * 1.1),
  line_items: [
    {
      unit: 'sqm',
      quantity: 200,
      description: `${label} — colorbond re-roof.`,
      unit_price_ex_gst: Number((ex / 200).toFixed(2)),
      total_ex_gst: ex,
      source: 'labour',
    },
  ],
})

test.describe('Roofing quote workflow (promoted quote)', () => {
  test.skip(!seedable, 'Supabase service-role env not available for seeding')

  let tenantId: string
  let intakeId: string
  let quoteId: string

  test.beforeAll(async () => {
    const supabase = createClient(url!, key!)
    // The book API requires an owning tenant ("No tradie configured" 409
    // otherwise). Trade 'electrical' satisfies the tenants_trade_fk; the
    // QUOTE's trade comes from the intake, so the workflow stays roofing.
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .insert({
        business_name: 'E2E Roofing Workflow Co',
        trade: 'electrical',
        status: 'active',
        owner_email: 'e2e-roofing-workflow@example.com',
        owner_mobile: '+61400000000',
      })
      .select('id')
      .single()
    if (tenantErr || !tenant) throw new Error(`tenant seed failed: ${tenantErr?.message}`)
    tenantId = tenant.id as string

    const { data: intake, error: intakeErr } = await supabase
      .from('intakes')
      .insert({
        tenant_id: tenantId,
        trade: 'roofing',
        job_type: 'full_reroof',
        address: '27 Smith Street',
        suburb: 'Penrith',
        scope: { material: 'colorbond', pitch: '22-30', sloped_area_m2: 200 },
        access: { storeys: 1 },
        property: { levels: 1, year_built: null },
        risks: [],
        inspection_required: false,
        caller: { name: 'Jon', phone: '', email: '' },
        timing: { urgency: null },
        confidence: 'HIGH',
        confidence_reason: 'e2e seeded roofing measurement.',
      })
      .select('id')
      .single()
    if (intakeErr || !intake) throw new Error(`intake seed failed: ${intakeErr?.message}`)
    intakeId = intake.id as string

    const { data: quote, error: quoteErr } = await supabase
      .from('quotes')
      .insert({
        tenant_id: tenantId,
        intake_id: intakeId,
        status: 'draft',
        share_token: token,
        scope_of_works: 'Full colorbond re-roof over approximately 200 m2.',
        assumptions: ['Sloped roof area approximately 200 m2.'],
        risk_flags: [],
        good: tierObj('Essential re-roof', 18000),
        better: tierObj('Recommended re-roof', 20000),
        best: tierObj('Premium re-roof', 24000),
        needs_inspection: false,
        selected_tier: 'better',
        subtotal_ex_gst: 20000,
        gst: 2000,
        total_inc_gst: 22000,
        routing_decision: 'tradie_review',
      })
      .select('id')
      .single()
    if (quoteErr || !quote) throw new Error(`quote seed failed: ${quoteErr?.message}`)
    quoteId = quote.id as string

    // The source measurement, already promoted (mig 168 link-back stamped) —
    // exactly what save-as-quote leaves behind. Its old customer link must
    // now bounce to the live quote.
    const { error: measureErr } = await supabase.from('roofing_measurements').insert({
      tenant_id: tenantId,
      address: '27 Smith Street',
      public_token: publicToken,
      quote_id: quoteId,
      quote_share_token: token,
    })
    if (measureErr) throw new Error(`measurement seed failed: ${measureErr.message}`)
  })

  test.afterAll(async () => {
    const supabase = createClient(url!, key!)
    await supabase.from('roofing_measurements').delete().eq('public_token', publicToken)
    await supabase.from('quotes').delete().eq('share_token', token)
    if (intakeId) await supabase.from('intakes').delete().eq('id', intakeId)
    if (tenantId) await supabase.from('tenants').delete().eq('id', tenantId)
  })

  test('the promoted quote renders with its tier pricing', async ({ page }) => {
    await page.goto(`/q/${token}`)
    await expect(
      page.getByText('Full colorbond re-roof over approximately 200 m2.'),
    ).toBeVisible()
    // Better-tier inc-GST figure (22,000) is on the page.
    await expect(page.getByText(/22,000/).first()).toBeVisible()
  })

  test('the pre-promotion /q/roof link redirects to the live quote', async ({ page }) => {
    // Old SMS'd measurement links must not keep serving the frozen
    // pre-promotion snapshot (stale prices) once a quotes row owns the job.
    // Browser-follow rather than asserting the raw 307: redirect() may emit
    // a meta tag instead of a status code in streaming contexts.
    await page.goto(`/q/roof/${publicToken}`)
    await expect(page).toHaveURL(new RegExp(`/q/${token}$`))
    await expect(
      page.getByText('Full colorbond re-roof over approximately 200 m2.'),
    ).toBeVisible()
  })

  test('the accept/deposit short-link routes book-first to the slot picker', async ({
    page,
  }) => {
    // /r redirects to an ABSOLUTE URL built from APP_URL (SMS links must be
    // absolute), which points at the canonical host — assert the Location
    // header instead of following it out of the e2e server's origin.
    const resp = await page.request.get(`/r/${token}/better`, {
      maxRedirects: 0,
    })
    expect(resp.status()).toBe(302)
    expect(resp.headers()['location']).toContain(`/q/${token}/book`)
  })

  test('booking a slot reserves the booking on the quote', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto(`/q/${token}/book?tier=better`)
    // The picker renders offered slots (rolling defaults self-renew, so at
    // least one is always offered even for a tenant-less quote).
    await expect(page.locator('button[aria-pressed]').first()).toBeVisible()

    // Browser-driven clicking is blocked in this dev env: the Clerk dev
    // instance's keys are mismatched ("infinite redirect loop" logged by the
    // server), which kills client-side interactivity in fresh contexts. So
    // fire the exact POST the SlotPicker fires — same endpoint, same body,
    // same server-side slot validation — and assert the DB transition.
    const options = resolveBookingOptions({ availability: null, availableSlots: null })
    const resp = await page.request.post(`/api/q/${token}/book`, {
      data: { slot: options[0].iso, tier: 'better' },
    })
    expect(resp.ok(), `book API ${resp.status()}: ${await resp.text()}`).toBeTruthy()

    const supabase = createClient(url!, key!)
    await expect
      .poll(
        async () => {
          const { data } = await supabase
            .from('quotes')
            .select('booking_state, scheduled_at')
            .eq('id', quoteId)
            .maybeSingle()
          return data?.scheduled_at ? data.booking_state : null
        },
        { timeout: 15_000 },
      )
      .toBe('reserved')
  })
})
