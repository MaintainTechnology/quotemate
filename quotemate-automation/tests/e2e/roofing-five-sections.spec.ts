// Five-section roofing customer quote (spec customer-quote-five-sections).
//
// Seeds an inspection-routed promoted roofing quote (the save-as-quote shape:
// real computed tiers + needs_inspection=true) and asserts the /q/[token]
// restructure: exactly five numbered sections (Overview → Job details →
// Your tradie → Your price → Book your site inspection), ONE price, the
// face-holder video placeholder, and one $99 CTA. Also locks the D1a funnel
// order: the $99 is PAY-FIRST (never bounced to /book), and an unpaid
// inspection visitor on /book is routed to payment.
//
// A second describe seeds a PAID + BOOKED quote and asserts the /paid
// thank-you page carries the tradie's thank-you placeholder + Jon's message.
//
// Seeded-row pattern mirrors tests/e2e/roofing-quote-workflow.spec.ts:
// service-role insert in beforeAll, delete in afterAll, skip without env.

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const seedable = Boolean(url && key)

// fullyParallel re-runs beforeAll PER WORKER — parallel seeding of the same
// share_token/owner_email collides on their unique constraints. Serial keeps
// one worker per file (mirrors roofing-quote-workflow.spec.ts).
test.describe.configure({ mode: 'serial' })

const token = `e2e${randomBytes(12).toString('hex')}`
const paidToken = `e2e${randomBytes(12).toString('hex')}`

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

test.describe('Roofing five-section quote page', () => {
  test.skip(!seedable, 'Supabase service-role env not available for seeding')

  let tenantId: string
  let intakeId: string

  test.beforeAll(async () => {
    const supabase = createClient(url!, key!)
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .insert({
        business_name: 'E2E Five Sections Roofing Co',
        trade: 'electrical',
        status: 'active',
        // Randomised per run — tenants.owner_email is UNIQUE, and an aborted
        // run (timeout before afterAll) must not poison the next one.
        owner_email: `e2e-five-sections-${token}@example.com`,
        owner_mobile: '+61400000001',
        website_url: 'https://example.com/e2e-roofing',
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
        access: { storeys: 2 },
        property: { levels: 2, year_built: null },
        risks: [],
        inspection_required: true,
        caller: { name: 'Jon', phone: '', email: '' },
        timing: { urgency: null },
        confidence: 'HIGH',
        confidence_reason: 'e2e seeded roofing measurement (inspection-routed).',
      })
      .select('id')
      .single()
    if (intakeErr || !intake) throw new Error(`intake seed failed: ${intakeErr?.message}`)
    intakeId = intake.id as string

    const { error: quoteErr } = await supabase.from('quotes').insert({
      tenant_id: tenantId,
      intake_id: intakeId,
      status: 'draft',
      share_token: token,
      scope_of_works: 'Full colorbond re-roof over approximately 200 m2.',
      scope_short: 'Replace roof with new battens, Colorbond sheeting and flashings.',
      assumptions: ['Sloped roof area approximately 200 m2.'],
      risk_flags: [],
      good: tierObj('Patch', 6000),
      better: tierObj('Full roof replacement', 20000),
      best: tierObj('Upgraded roof replacement', 24000),
      needs_inspection: true,
      inspection_reason: 'Two-storey access needs an on-site check.',
      selected_tier: 'better',
      subtotal_ex_gst: 20000,
      gst: 2000,
      total_inc_gst: 22000,
      routing_decision: 'inspection_required',
    })
    if (quoteErr) throw new Error(`quote seed failed: ${quoteErr.message}`)
  })

  test.afterAll(async () => {
    const supabase = createClient(url!, key!)
    await supabase.from('quotes').delete().eq('share_token', token)
    if (intakeId) await supabase.from('intakes').delete().eq('id', intakeId)
    if (tenantId) await supabase.from('tenants').delete().eq('id', tenantId)
  })

  test('renders exactly the five sections, one price, the placeholder, and one $99 CTA', async ({
    page,
  }) => {
    await page.goto(`/q/${token}`)

    // The five numbered sections, in order.
    for (const title of [
      'Overview',
      'Job details',
      'Your tradie',
      'Your price',
      'Book your site inspection',
    ]) {
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    }

    // Section 1 + 2 content.
    await expect(
      page.getByText('Full colorbond re-roof over approximately 200 m2.'),
    ).toBeVisible()
    await expect(
      page.getByText('Replace roof with new battens, Colorbond sheeting and flashings.'),
    ).toBeVisible()

    // Section 3 — the trust video (QuoteMax default since mig 177) or the
    // face-holder placeholder; the caption renders in both states.
    await expect(page.getByText('A short introduction from your tradie')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Visit their website' })).toBeVisible()

    // Section 4 — ONE price: the recommended tier only (single mode).
    await expect(page.getByText(/22,000/).first()).toBeVisible()
    await expect(page.getByText(/6,600/)).toHaveCount(0) // good tier hidden
    await expect(page.getByText(/26,400/)).toHaveCount(0) // best tier hidden

    // Section 5 — one $99 CTA to the inspection short-link.
    const cta = page.getByRole('link', { name: /Book a site inspection/ })
    await expect(cta).toBeVisible()
    await expect(cta).toHaveAttribute('href', `/r/${token}/inspection`)
  })

  test('the $99 is PAY-FIRST — /r/<token>/inspection never bounces to the booking page (D1a)', async ({
    page,
  }) => {
    const resp = await page.request.get(`/r/${token}/inspection`, { maxRedirects: 0 })
    const location = resp.headers()['location'] ?? ''
    // Stripe configured → 302 to checkout; unconfigured → mint fails → 404.
    // Either way the pre-payment /book redirect must be gone.
    expect(location).not.toContain('/book')
  })

  test('an unpaid inspection visitor on /book is routed to payment', async ({ page }) => {
    const resp = await page.request.get(`/q/${token}/book?tier=inspection`, {
      maxRedirects: 0,
    })
    expect(String(resp.status())).toMatch(/^3/)
    expect(resp.headers()['location'] ?? '').toContain(`/r/${token}/inspection`)
  })

  test('POST /api/q/[token]/book 409s an unpaid inspection pick', async ({ page }) => {
    const resp = await page.request.post(`/api/q/${token}/book`, {
      data: { slot: new Date(Date.now() + 7 * 864e5).toISOString(), tier: 'inspection' },
    })
    expect(resp.status()).toBe(409)
    expect(await resp.text()).toContain('Pay the deposit first')
  })
})

test.describe('Thank-you page (paid + booked)', () => {
  test.skip(!seedable, 'Supabase service-role env not available for seeding')

  let tenantId: string
  let intakeId: string

  test.beforeAll(async () => {
    const supabase = createClient(url!, key!)
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .insert({
        business_name: 'E2E Thank You Roofing Co',
        trade: 'electrical',
        status: 'active',
        owner_email: `e2e-thankyou-${paidToken}@example.com`,
        owner_mobile: '+61400000002',
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
        scope: { material: 'colorbond' },
        access: {},
        property: {},
        risks: [],
        inspection_required: true,
        caller: { name: 'Jon', phone: '', email: '' },
        timing: { urgency: null },
        confidence: 'HIGH',
        confidence_reason: 'e2e seeded (paid thank-you).',
      })
      .select('id')
      .single()
    if (intakeErr || !intake) throw new Error(`intake seed failed: ${intakeErr?.message}`)
    intakeId = intake.id as string

    const scheduled = new Date(Date.now() + 7 * 864e5).toISOString()
    const { error: quoteErr } = await supabase.from('quotes').insert({
      tenant_id: tenantId,
      intake_id: intakeId,
      status: 'accepted',
      share_token: paidToken,
      scope_of_works: 'Full colorbond re-roof.',
      assumptions: [],
      risk_flags: [],
      good: null,
      better: null,
      best: null,
      needs_inspection: true,
      inspection_reason: 'e2e',
      selected_tier: 'inspection',
      subtotal_ex_gst: 90,
      gst: 9,
      total_inc_gst: 99,
      routing_decision: 'inspection_required',
      paid_at: new Date().toISOString(),
      paid_tier: 'inspection',
      scheduled_at: scheduled,
      scheduled_window: 'am',
      booking_state: 'booked',
    })
    if (quoteErr) throw new Error(`quote seed failed: ${quoteErr.message}`)
  })

  test.afterAll(async () => {
    const supabase = createClient(url!, key!)
    await supabase.from('quotes').delete().eq('share_token', paidToken)
    if (intakeId) await supabase.from('intakes').delete().eq('id', intakeId)
    if (tenantId) await supabase.from('tenants').delete().eq('id', tenantId)
  })

  test('renders the thank-you video block and the confirmation message', async ({ page }) => {
    await page.goto(`/q/${paidToken}/thanks`)
    // The trust video (QuoteMax default since mig 177) or its face-holder
    // fallback — the caption renders in both states.
    await expect(page.getByText('A thank-you message from your tradie')).toBeVisible()
  })

  test('/paid is a router — a paid+booked quote lands on /thanks', async ({ page }) => {
    // /paid stopped rendering on 2026-07-22; it exists only to absorb Stripe's
    // success_url, resolve the webhook race, and hand off.
    await page.goto(`/q/${paidToken}/paid`)
    await expect(page).toHaveURL(new RegExp(`/q/${paidToken}/thanks`))
  })

  test('the thank-you page confirms what was paid, when, and how it was booked', async ({
    page,
  }) => {
    await page.goto(`/q/${paidToken}/thanks`)
    await expect(page.getByText("What's booked")).toBeVisible()
    // The REAL charge — the seeded row is a $99 inspection.
    await expect(page.getByText('$99.00')).toBeVisible()
    // How the booking was made, plus the customer's quotable reference.
    await expect(page.getByText(/Online · self-serve · ref/)).toBeVisible()
    // Add-to-calendar: .ics primary, with the web deep-links beside it.
    await expect(page.getByRole('link', { name: /Add to calendar/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Google$/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Outlook$/ })).toBeVisible()
  })

  test('the booking page shows a calendar and NO thank-you content', async ({ page }) => {
    // The whole point of the split: /book picks a time, /thanks confirms.
    // Seeded row is already scheduled, so /book must forward to /thanks.
    await page.goto(`/q/${paidToken}/book`)
    await expect(page).toHaveURL(new RegExp(`/q/${paidToken}/thanks`))
  })
})
