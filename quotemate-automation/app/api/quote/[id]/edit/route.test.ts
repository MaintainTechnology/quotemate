// Regression test for POST /api/quote/[id]/edit — the persisted update MUST
// invalidate the cached customer PDF (quotes.pdf_path) on every edit.
//
// Bug (2026-07-01): a tradie added a "$9000 scaffold" line via the "Edit with
// AI" chat + Save on a roofing quote. It persisted to quotes.good/better/best
// but never appeared in the downloaded PDF. Root cause: the only PDF-regenerate
// call lived inside the `if (shouldNotify)` after() block, so a quote held for
// review (status = 'awaiting_tradie_approval') or a silent save (notify_customer
// = false) persisted the tiers but left the cached PDF untouched. Because
// quotes.pdf_signature captures only template/tier-mode/visible-tiers — NOT
// line-item content (lib/quote/pdf-signature.ts) — the next /api/q/[token]/pdf
// hit served the STALE cached PDF. The fix: null pdf_path (+ pdf_signature) in
// the persisted update so the next download/preview/send regenerates from the
// freshly-saved tiers, regardless of whether the customer is notified now.
//
// Uses a roofing quote so `tradeGroundingMode('roofing') === 'tradie-authored'`
// (lib/quote/report-adapters/registry.ts) skips the catalogue grounding gate —
// matching the real scenario in the bug report.

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = unknown
const state: {
  user: { id: string } | null
  userErr: unknown
  quote: Row
  tenant: Row
  pricingBook: Row
  intake: Row
  updErr: unknown
} = {
  user: null,
  userErr: null,
  quote: undefined,
  tenant: undefined,
  pricingBook: undefined,
  intake: undefined,
  updErr: null,
}

// Captures the payload passed to quotes.update(...) so the test can assert the
// PDF cache was invalidated.
const captured: { quotesUpdate: Record<string, unknown> | null } = { quotesUpdate: null }

vi.mock('next/server', () => ({
  // Held-quote / silent-save edits take the no-notify path, so after() never
  // fires in this test; noop is enough and keeps the notify block out.
  after: (_cb: () => unknown) => {
    void _cb
  },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: state.userErr }),
    },
    from: (table: string) => {
      const data =
        table === 'quotes'
          ? state.quote
          : table === 'tenants'
            ? state.tenant
            : table === 'pricing_book'
              ? state.pricingBook
              : table === 'intakes'
                ? state.intake
                : null
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      builder.select = chain
      builder.eq = chain
      builder.limit = chain
      builder.maybeSingle = async () => ({ data })
      builder.update = (body: Record<string, unknown>) => {
        if (table === 'quotes') captured.quotesUpdate = body
        return { eq: async () => ({ error: state.updErr }) }
      }
      builder.insert = async () => ({ error: null })
      return builder
    },
  }),
}))

vi.mock('@/lib/stripe/checkout', () => ({
  expireCheckoutSession: vi.fn(async () => ({ ok: true })),
  createCheckoutSessionForTier: vi.fn(async () => 'https://stripe.test/session/better'),
}))

vi.mock('@/lib/quote/pdf', () => ({
  ensureQuotePdf: vi.fn(async () => 'quotes/q1.pdf'),
  quotePdfUrl: () => 'https://app.test/api/q/tok/pdf',
  signQuotePdfUrl: vi.fn(async () => 'https://signed.test/q1.pdf'),
}))

vi.mock('@/lib/sms/send-quote-pdf', () => ({
  dispatchQuoteWithPdf: vi.fn(async () => ({ ok: true, channel: 'sms', sid: 'SM1' })),
}))
vi.mock('@/lib/filestore/ingest-quote', () => ({ archiveAndIngestQuote: vi.fn(async () => {}) }))
vi.mock('@/lib/filestore/minimize', () => ({
  buildQuoteKbText: () => ({ markdown: '', contentHash: 'h' }),
}))
vi.mock('@/lib/estimate/run', () => ({
  loadCandidatePrices: vi.fn(async () => ({ material: [], assembly: [] })),
}))
vi.mock('@/lib/estimate/validate', () => ({
  validateQuoteGrounding: () => ({ valid: true }),
  detectCrossTierDuplicates: () => [],
  isManualLine: () => false,
}))

import { POST } from './route'

const params = { params: Promise.resolve({ id: 'q1' }) }

function req(body?: unknown, bearer?: string) {
  return new Request('http://localhost/api/quote/q1/edit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

// A roofing G/B/B quote HELD for tradie review — the exact state where the bug
// bit: it persists the edit but takes the no-notify branch.
function roofingTier(label: string, desc: string) {
  return {
    label,
    subtotal_ex_gst: 110352,
    line_items: [
      { description: desc, quantity: 968, unit: 'm²', unit_price_ex_gst: 114, total_ex_gst: 110352 },
    ],
  }
}

// Adds a "$9000 scaffold" line to the Better tier (a real price change).
const EDIT_BODY = {
  better: {
    label: 'Re-roof',
    line_items: [
      { description: 'Re-roof priced across 2 structures.', quantity: 968, unit: 'm²', unit_price_ex_gst: 114 },
      { description: 'Scaffold supply and setup.', quantity: 1, unit_price_ex_gst: 9000 },
    ],
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  captured.quotesUpdate = null
  state.user = { id: 'owner-1' }
  state.userErr = null
  state.updErr = null
  state.quote = {
    id: 'q1',
    tenant_id: 't1',
    intake_id: 'i1',
    share_token: 'tok_abc12345',
    status: 'awaiting_tradie_approval',
    paid_at: null,
    selected_tier: 'better',
    good: roofingTier('Patch / repair', 'Patch / repair priced across 2 structures.'),
    better: roofingTier('Re-roof', 'Re-roof priced across 2 structures.'),
    best: roofingTier('Upgrade', 'Upgrade priced across 2 structures.'),
    stripe_links: {},
    total_inc_gst: 121387,
    needs_inspection: false,
    inspection_reason: null,
    estimated_timeframe: null,
    risk_flags: [],
    applied_discount_pct: 0,
    scope_of_works: null,
    assumptions: null,
    pdf_path: 'quotes/q1.pdf',
    pdf_signature: 'v3|single|t=better|r=',
  }
  state.tenant = { id: 't1', owner_user_id: 'owner-1' }
  // Roofing is a tradie-authored trade → no catalogue, sparse book is fine.
  state.pricingBook = { trade: 'roofing', gst_registered: true }
  state.intake = { trade: 'roofing', job_type: 'reroof', caller: null, scope: null }
})

describe('POST /api/quote/[id]/edit — cached PDF invalidation', () => {
  it('nulls quotes.pdf_path on a held-quote edit so the stale PDF regenerates', async () => {
    const res = await POST(req(EDIT_BODY, 'tok'), params)
    expect(res.status).toBe(200)

    // Sanity: the edit persisted and the Better subtotal picked up the +$9000.
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.changedTiers).toContain('better')

    // The bug: without this, the persisted update leaves pdf_path pointing at
    // the pre-edit PDF, and pdf_signature (which ignores line items) still
    // matches — so /api/q/[token]/pdf keeps serving the stale document.
    expect(captured.quotesUpdate).not.toBeNull()
    expect(captured.quotesUpdate!.pdf_path).toBeNull()
    expect(captured.quotesUpdate!.pdf_signature).toBeNull()
  })
})
