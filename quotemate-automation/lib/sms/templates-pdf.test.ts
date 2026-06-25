// Migration 105 — the "PDF copy" line on the customer quote SMS bodies
// (trade G/B/B template, updated-quote template, roofing estimate).

import { describe, it, expect } from 'vitest'
import { buildQuoteSms, buildQuoteUpdatedSms } from './templates'
import { buildRoofingReplyMessage } from './roofing-compose'
import type { MultiRoofQuote } from '@/lib/roofing/types'

const intake = {
  job_type: 'downlights',
  caller: { name: 'Sam Smith' },
  scope: { item_count: 6 },
}

const quote = {
  good: { label: 'Budget LEDs', subtotal_ex_gst: 498 },
  better: null,
  best: null,
  selected_tier: 'good' as const,
  scope_of_works: 'Replace 6 downlights.',
  assumptions: null,
  estimated_timeframe: null,
  quote_view_url: 'https://example.com/q/tok',
  pdf_url: 'https://example.com/api/q/tok/pdf',
}

describe('buildQuoteSms pdf_url', () => {
  it('renders the PDF copy line under the view link', () => {
    const body = buildQuoteSms(intake, quote)
    expect(body).toContain('View full quote: https://example.com/q/tok')
    expect(body).toContain('PDF copy: https://example.com/api/q/tok/pdf')
  })

  it('omits the line when pdf_url is absent', () => {
    const body = buildQuoteSms(intake, { ...quote, pdf_url: null })
    expect(body).not.toContain('PDF copy:')
  })
})

describe('buildQuoteUpdatedSms pdf_url', () => {
  it('renders the PDF copy line on the updated-quote SMS', () => {
    const body = buildQuoteUpdatedSms(intake, quote)
    expect(body).toContain('PDF copy: https://example.com/api/q/tok/pdf')
  })
})

describe('roofing estimate pdfUrl', () => {
  const tiers = [
    { tier: 'good', label: 'Patch / repair', ex_gst: 2000, inc_gst: 2200, scope: 's' },
    { tier: 'better', label: 'Re-roof', ex_gst: 18000, inc_gst: 19800, scope: 's' },
    { tier: 'best', label: 'Upgrade', ex_gst: 24000, inc_gst: 26400, scope: 's' },
  ]
  const roofQuote = {
    structures: [
      {
        buildingId: 'b1',
        role: 'primary',
        label: 'Main dwelling',
        metrics: { sloped_area_m2: 210 },
        inputs: {},
        price: { tiers, routing: { decision: 'tradie_review', reason: 'ok' } },
      },
    ],
    combined: { area_m2: 210, tiers },
    routing: { decision: 'tradie_review', reason: 'ok' },
    inspection_structures: [],
  } as unknown as MultiRoofQuote

  it('renders the PDF copy line on the priced estimate', () => {
    const body = buildRoofingReplyMessage({
      quote: roofQuote,
      address: '12 Sample St',
      quoteUrl: 'https://example.com/q/roof/tok',
      firstName: 'Sam',
      pdfUrl: 'https://example.com/api/q/roof/tok/pdf',
    })
    expect(body).toContain('PDF copy: https://example.com/api/q/roof/tok/pdf')
  })

  it('omits the line when pdfUrl is absent', () => {
    const body = buildRoofingReplyMessage({
      quote: roofQuote,
      address: '12 Sample St',
      quoteUrl: 'https://example.com/q/roof/tok',
    })
    expect(body).not.toContain('PDF copy:')
  })

  it('never renders the line on a whole-job inspection message', () => {
    // Realistic whole-job on-site quote: the structure itself is
    // inspection-routed (nothing quotable), so buildRoofingReplyMessage uses
    // the inspection message, which never carries a PDF line. (In production
    // the inbound route also withholds pdfUrl for any inspection-routed job.)
    const inspectionStructure = {
      ...(roofQuote.structures[0] as Record<string, unknown>),
      price: { tiers, routing: { decision: 'inspection_required', reason: 'steep pitch' } },
    }
    const body = buildRoofingReplyMessage({
      quote: {
        ...roofQuote,
        structures: [inspectionStructure],
        routing: { decision: 'inspection_required', reason: 'steep pitch' },
      } as unknown as MultiRoofQuote,
      address: '12 Sample St',
      quoteUrl: 'https://example.com/q/roof/tok',
      pdfUrl: 'https://example.com/api/q/roof/tok/pdf',
    })
    expect(body).not.toContain('PDF copy:')
  })
})
