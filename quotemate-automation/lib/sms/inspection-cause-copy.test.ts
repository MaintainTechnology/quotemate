// R4 (2026-09-02) — the customer-facing inspection copy must match the REASON.
//
// "Every site is different — we can't price this safely without seeing the
// work in person" is a claim about the customer's property. On 2026-09-01 it
// was sent for a quote that failed OUR grounding validator: a fully priced EV
// charger job, blamed on the site. Migration 193 records the cause so the copy
// can tell the two apart.
import { describe, expect, it } from 'vitest'
import { buildQuoteSms, buildTradieReviewNotification } from './templates'

const SITE_LINE = 'Every site is different'

const intake = {
  caller: { name: 'Jon Smith' },
  job_type: 'ev_charger',
  suburb: 'Chandler',
  scope: {},
} as Parameters<typeof buildQuoteSms>[0]

function inspectionQuote(over: Record<string, unknown> = {}) {
  return {
    good: null,
    better: null,
    best: null,
    needs_inspection: true,
    inspection_reason: null,
    estimated_timeframe: 'After site visit (within 5 business days)',
    scope_of_works: 'Install a single-phase 7kW EV charger.',
    pay_links: { inspection: 'https://quotemax.com.au/r/tok/inspection' },
    quote_view_url: 'https://quotemax.com.au/q/tok',
    ...over,
  } as Parameters<typeof buildQuoteSms>[1]
}

describe('inspection SMS copy is gated on the CAUSE (R4)', () => {
  it('keeps the site-conditions line for a genuine site decision', () => {
    const body = buildQuoteSms(intake, inspectionQuote({ inspection_cause: 'site_conditions' }))
    expect(body).toContain(SITE_LINE)
  })

  it('keeps it when the model itself asked for a visit', () => {
    const body = buildQuoteSms(intake, inspectionQuote({ inspection_cause: 'model_declared' }))
    expect(body).toContain(SITE_LINE)
  })

  it('keeps it for legacy rows with no cause recorded', () => {
    // Every pre-migration-193 row is null; none of them may change wording.
    const body = buildQuoteSms(intake, inspectionQuote({ inspection_cause: null }))
    expect(body).toContain(SITE_LINE)
    expect(buildQuoteSms(intake, inspectionQuote())).toContain(SITE_LINE)
  })

  it('NEVER blames the site when our own grounding check failed', () => {
    const body = buildQuoteSms(intake, inspectionQuote({ inspection_cause: 'grounding_failed' }))
    expect(body).not.toContain(SITE_LINE)
    expect(body).not.toContain('without seeing the work in person')
    expect(body).toContain("we're confirming the price")
    // Still a usable message: the customer keeps the link and the $99 option.
    expect(body).toContain('https://quotemax.com.au/r/tok/inspection')
  })
})

describe('tradie review notification (R3.2 / R5c)', () => {
  const base = {
    tradieFirstName: 'Atomix',
    customerName: 'Jon Smith',
    customerPhone: '+61400000000',
    jobType: 'ev_charger',
    totalIncGst: 650,
    approveUrl: 'https://quotemax.com.au/q/tok/approve',
    editUrl: 'https://quotemax.com.au/q/tok?edit=1',
  }

  it('names the lines that failed grounding so the tradie knows what to check', () => {
    const body = buildTradieReviewNotification({
      ...base,
      policyReason: 'quote_integrity_grounding_failed',
      groundingFailureDescriptions: ['Switchboard health check', 'Add RCBO safety switch'],
    })
    expect(body).toContain('price needs a check')
    expect(body).toContain('Switchboard health check')
    expect(body).toContain('Add RCBO safety switch')
    expect(body).toContain(base.approveUrl)
    expect(body).toContain(base.editUrl)
  })

  it('summarises the overflow rather than pasting every line', () => {
    const body = buildTradieReviewNotification({
      ...base,
      groundingFailureDescriptions: ['Line A', 'Line B', 'Line C', 'Line D'],
    })
    expect(body).toContain('Line A, Line B')
    expect(body).toContain('+2 more')
  })

  it('labels a remembered address as unconfirmed, never as the job site', () => {
    const body = buildTradieReviewNotification({
      ...base,
      rememberedAddress: '652 London Rd',
    })
    expect(body).toContain('Address from customer records (confirm on site): 652 London Rd')
  })

  it('is unchanged for an ordinary threshold hold', () => {
    const body = buildTradieReviewNotification({ ...base, policyReason: 'total_650_at_or_over_threshold_500' })
    expect(body).toContain('over your threshold')
    expect(body).not.toContain('price needs a check')
    expect(body).not.toContain('Address from customer records')
    expect(body).not.toContain('Check these line(s)')
  })
})

import { buildTradieDraftNotification, buildTradieInspectionNotification } from './templates'

describe('R5(c) — the remembered address reaches the tradie on EVERY notify', () => {
  const ADDRESS = '652 London Rd'
  const LABEL = 'Address from customer records (confirm on site): 652 London Rd'

  it('auto-send draft notification carries it', () => {
    const body = buildTradieDraftNotification({
      tradieFirstName: 'Atomix',
      customerName: 'Jon Smith',
      jobType: 'ev_charger',
      totalIncGst: 650,
      quoteUrl: 'https://quotemax.com.au/q/tok',
      rememberedAddress: ADDRESS,
    })
    expect(body).toContain(LABEL)
  })

  it('inspection notification carries it — the case most likely to lack an address', () => {
    const body = buildTradieInspectionNotification({
      tradieFirstName: 'Atomix',
      customerName: 'Jon Smith',
      jobType: 'ev_charger',
      inspectionReason: 'Three-phase supply needs an on-site check.',
      quoteUrl: 'https://quotemax.com.au/q/tok',
      rememberedAddress: ADDRESS,
    })
    expect(body).toContain(LABEL)
  })

  it('omits the line entirely when there is no address on file', () => {
    const body = buildTradieDraftNotification({
      tradieFirstName: 'Atomix',
      customerName: 'Jon Smith',
      jobType: 'ev_charger',
      totalIncGst: 650,
      quoteUrl: 'https://quotemax.com.au/q/tok',
    })
    expect(body).not.toContain('Address from customer records')
  })
})

describe('no address anywhere — the tradie is told (spec edge case)', () => {
  it('says so on the draft notification', () => {
    const body = buildTradieDraftNotification({
      customerName: 'Jon Smith',
      jobType: 'ev_charger',
      totalIncGst: 650,
      quoteUrl: 'https://quotemax.com.au/q/tok',
      noAddressOnFile: true,
    })
    expect(body).toContain('No address provided')
  })

  it('says so on the inspection notification', () => {
    const body = buildTradieInspectionNotification({
      customerName: 'Jon Smith',
      jobType: 'ev_charger',
      quoteUrl: 'https://quotemax.com.au/q/tok',
      noAddressOnFile: true,
    })
    expect(body).toContain('No address provided')
  })

  it('prefers the remembered address over the bare warning', () => {
    const body = buildTradieDraftNotification({
      customerName: 'Jon Smith',
      jobType: 'ev_charger',
      totalIncGst: 650,
      quoteUrl: 'https://quotemax.com.au/q/tok',
      rememberedAddress: '652 London Rd',
      noAddressOnFile: true,
    })
    expect(body).toContain('Address from customer records')
    expect(body).not.toContain('No address provided')
  })

  it('stays silent when the job HAS an address', () => {
    const body = buildTradieDraftNotification({
      customerName: 'Jon Smith',
      jobType: 'ev_charger',
      totalIncGst: 650,
      quoteUrl: 'https://quotemax.com.au/q/tok',
    })
    expect(body).not.toContain('No address provided')
    expect(body).not.toContain('Address from customer records')
  })
})

describe('grounding-failure line list counts from the array, not the joined string', () => {
  it('reports the right remainder when a description contains a comma', () => {
    const body = buildTradieReviewNotification({
      tradieFirstName: 'Atomix',
      customerName: 'Jon Smith',
      jobType: 'ev_charger',
      totalIncGst: 650,
      approveUrl: 'https://quotemax.com.au/q/tok/approve',
      editUrl: 'https://quotemax.com.au/q/tok?edit=1',
      groundingFailureDescriptions: [
        'Switchboard health check, annual',
        'Add RCBO safety switch',
        'Third line',
        'Fourth line',
      ],
    })
    // 4 supplied, 2 shown -> exactly 2 more. Re-splitting the joined string
    // would have counted 3 names and reported "+1 more".
    expect(body).toContain('+2 more')
  })
})
