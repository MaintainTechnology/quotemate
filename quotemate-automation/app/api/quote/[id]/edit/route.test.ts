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
vi.mock('@/lib/quote/job-quote-operation', () => ({ readQuoteDraftReadiness: vi.fn(async () => ({ ready: true })) }))

type Row = unknown
const state: {
  user: { id: string } | null
  userErr: unknown
  quote: Row
  tenant: Row
  pricingBook: Row
  /** Multi-row pricing_book fixture — when set, the mock honours an
   *  eq('trade', …) filter and returns the FIRST row when unfiltered. */
  pricingBooks?: Row[]
  intake: Row
  candidates?: Row
  updErr: unknown
  quoteErr?: unknown
  raceOnSave?: boolean
  raceReleaseOnSave?: boolean
  version?: Row
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
const captured: { quotesUpdate: Record<string, unknown> | null; callbacks: Array<() => unknown>; effects: string[] } = { quotesUpdate: null, callbacks: [], effects: [] }

vi.mock('next/server', () => ({
  // Held-quote / silent-save edits take the no-notify path, so after() never
  // fires in this test; noop is enough and keeps the notify block out.
  after: (_cb: () => unknown) => {
    captured.callbacks.push(_cb)
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
                : table === 'quote_pricing_versions' ? state.version : null
      const builder: Record<string, unknown> = {}
      const filters: Record<string, unknown> = {}
      const chain = () => builder
      builder.select = chain
      builder.eq = (col: string, val: unknown) => {
        filters[col] = val
        return builder
      }
      builder.limit = chain
      let update: Record<string, unknown> | null = null
      builder.is = builder.eq
      builder.maybeSingle = async () => {
        if (update) {
          captured.effects.push('save')
          if (state.raceOnSave) { (state.quote as Record<string, unknown>).paid_at = 'paid'; state.raceOnSave = false }
          if (state.raceReleaseOnSave) {
            (state.quote as Record<string, unknown>).customer_released_at = '2026-09-15T00:00:00.000Z'
            state.raceReleaseOnSave = false
          }
          if (state.updErr) return { data: null, error: state.updErr }
          const current = state.quote as Record<string, unknown>
          if (!current || Object.entries(filters).some(([key, value]) => {
            const actual = current[key] ?? null
            return typeof actual === 'object' && actual !== null
              ? JSON.stringify(actual) !== value : actual !== value
          })) return { data: null, error: null }
          state.quote = { ...current, ...structuredClone(update) }
          captured.quotesUpdate = { ...captured.quotesUpdate, ...structuredClone(update) }
          return { data: structuredClone(state.quote), error: null }
        }
        if (table === 'pricing_book' && Array.isArray(state.pricingBooks)) {
          const rows = state.pricingBooks.filter((r) => Object.entries(filters).every(
            ([key, value]) => (r as Record<string, unknown>)[key] === value,
          ))
          return { data: rows.length === 1 ? rows[0] : null, error: rows.length > 1 ? { message: 'multiple rows' } : null }
        }
        return { data: structuredClone(data), error: table === 'quotes' ? state.quoteErr : null }
      }
      builder.update = (body: Record<string, unknown>) => { update = body; return builder }
      builder.insert = async () => ({ error: null })
      return builder
    },
  }),
}))

vi.mock('@/lib/stripe/checkout', () => ({
  expireCheckoutSession: vi.fn(async () => { captured.effects.push('expire'); return { ok: true } }),
  createCheckoutSessionForTier: vi.fn(async () => { captured.effects.push('mint'); return 'https://stripe.test/session/better' }),
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
  loadCandidatePrices: vi.fn(async () => state.candidates ?? ({ material: [], assembly: [] })),
}))
vi.mock('@/lib/estimate/validate', () => ({
  validateQuoteGrounding: vi.fn(() => ({ valid: true })),
  detectCrossTierDuplicates: () => [],
  isManualLine: (line: { source?: string }) => line.source?.trim().toLowerCase() === 'tradie_manual',
}))

import { POST } from './route'
import { createCheckoutSessionForTier, expireCheckoutSession } from '@/lib/stripe/checkout'
import { dispatchQuoteWithPdf } from '@/lib/sms/send-quote-pdf'
import { quoteEditRevision } from '@/lib/quote/edit-authority'
import { readQuoteDraftReadiness } from '@/lib/quote/job-quote-operation'
import { validateQuoteGrounding } from '@/lib/estimate/validate'
import { buildRank1Estimation } from '@/lib/estimate/rank1'

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
  captured.callbacks = []
  captured.effects = []
  state.raceOnSave = false
  state.raceReleaseOnSave = false
  state.quoteErr = null
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
    total_inc_gst: 121387.2,
    needs_inspection: false,
    inspection_reason: null,
    estimated_timeframe: null,
    risk_flags: [],
    applied_discount_pct: 0,
    deposit_pct: 30,
    scope_of_works: null,
    assumptions: null,
    pdf_path: 'quotes/q1.pdf',
    pdf_signature: 'v3|single|t=better|r=',
  }
  state.tenant = { id: 't1', owner_user_id: 'owner-1' }
  // Roofing is a tradie-authored trade → no catalogue, sparse book is fine.
  state.pricingBook = { id: 'pb1', tenant_id: 't1', trade: 'roofing', gst_registered: true }
  state.pricingBooks = undefined
  state.version = null
  state.candidates = undefined
  state.intake = { tenant_id: 't1', trade: 'roofing', job_type: 'reroof', caller: null, scope: null }
})

describe('released Quote Core edits retain immutable pricing authority', () => {
  async function configureCore() {
    const intake = { id: 'i1', tenant_id: 't1', trade: 'electrical', job_type: 'downlights',
      address: '10 Test Street', confidence: 'HIGH', inspection_required: false,
      caller: { phone: '+61400000000' }, scope: { item_count: 2, specs: { supplied_by: 'tradie' } } }
    const book = { id: 'pb1', tenant_id: 't1', trade: 'electrical', gst_registered: true,
      hourly_rate: 110, default_markup_pct: 25, min_labour_hours: 1.5, call_out_minimum: 100 }
    const result = await buildRank1Estimation({ intake, pricingBook: book, context: { pricingBookVersionId: 'v1' },
      loadInputs: async () => ({ input: {
        bom: [{ material_category: 'downlight', quantity: 2, required: true }],
        tenantMaterials: [{ id: 'product-a', name: 'Downlight', category: 'downlight', active: true, unit_price_ex_gst: 10 }],
        sharedMaterials: [], hourlyRate: 110, labourHours: 1.5, markupPct: 25,
      }, assemblyName: 'Replace downlights', recipeSourceId: 'recipe-a', recipeRowIds: ['row-a'],
      taskRows: { tenant: [], shared: [] } }),
    })
    expect(result.quoteCore?.status).toBe('priced')
    Object.assign(state.quote as object, { ...result.draft, quote_kind: 'initial', status: 'sent',
      sent_at: '2026-09-01T00:00:00Z', pricing_book_version_id: 'v1', total_inc_gst: 209,
      grounding_result: { ok: true, quote_core: result.quoteCore },
    })
    state.intake = intake
    state.pricingBook = book
    state.version = { id: 'v1', tenant_id: 't1', trade: 'electrical', pricing_book_id: 'pb1',
      content_hash: 'a'.repeat(64), snapshot: book }
    const quote = state.quote as Record<string, unknown>
    const tier = quote.better as { label: string; line_items: Array<Record<string, unknown>> }
    return { expected_revision: quoteEditRevision(quote), notify_customer: false, better: {
      label: tier.label, line_items: tier.line_items.map((line, original_line_index): Record<string, unknown> => ({ ...line, original_line_index })),
    } }
  }

  it.each(['price', 'quantity', 'scope', 'force'] as const)('rejects a released %s edit before save or provider work', async change => {
    const body = await configureCore()
    const before = structuredClone(state.quote)
    if (change === 'scope') body.better.line_items[0].description = 'Different binding work'
    else if (change === 'quantity') body.better.line_items[0].quantity = 999
    else body.better.line_items[0].unit_price_ex_gst = 999
    const response = await POST(req({ ...body, force: change === 'force' }, 'tok'), params)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'quote_core_review_required', hint: expect.stringContaining('new quote version') })
    expect(state.quote).toEqual(before)
    expect(captured.effects).toEqual([])
    expect(captured.callbacks).toHaveLength(0)
    expect(dispatchQuoteWithPdf).not.toHaveBeenCalled()
  })

  it('preserves the server catalogue identity through an unchanged price save', async () => {
    const body = await configureCore()
    const response = await POST(req(body, 'tok'), params)
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200)
    expect((captured.quotesUpdate?.better as { line_items: unknown[] }).line_items[0])
      .toMatchObject({ catalogue_id: 'product-a' })
    expect(captured.quotesUpdate).not.toHaveProperty('grounding_result')
  })

  it('rechecks core evidence at queued delivery and skips a tampered snapshot', async () => {
    const body = await configureCore()
    expect((await POST(req({ ...body, notify_customer: true }, 'tok'), params)).status).toBe(200)
    expect(captured.callbacks).toHaveLength(1)
    ;(state.quote as Record<string, unknown>).grounding_result = { quote_core: { status: 'review_required' } }
    await captured.callbacks[0]()
    expect(dispatchQuoteWithPdf).not.toHaveBeenCalled()
  })
})

describe('authenticated human manual-price authority', () => {
  const manualBody = { better: { label: 'EV installation', line_items: [
    { description: 'Installation labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110, source: 'labour' },
    { description: 'Supply specified EV charger unit', quantity: 1, unit: 'each', unit_price_ex_gst: 700, source: 'tradie_manual' },
  ] }, notify_customer: false }

  it('allows a real human manual save after ownership checks and records its provenance', async () => {
    state.intake = { tenant_id: 't1', trade: 'electrical', job_type: 'ev_charger', caller: null, scope: null }
    state.pricingBook = { id: 'pb1', tenant_id: 't1', trade: 'electrical', gst_registered: true,
      hourly_rate: 110, apprentice_rate: 60, call_out_minimum: 150, default_markup_pct: 30, min_labour_hours: 2 }
    const actual = await vi.importActual<typeof import('@/lib/estimate/validate')>('@/lib/estimate/validate')
    vi.mocked(validateQuoteGrounding).mockImplementationOnce(actual.validateQuoteGrounding)
    const result = await POST(req(manualBody, 'tok'), params)
    expect(result.status).toBe(200)
    expect(vi.mocked(validateQuoteGrounding)).toHaveBeenCalledWith(
      expect.any(Object), expect.any(Object), expect.any(Object), { allowManualLines: true },
    )
    expect(captured.quotesUpdate?.risk_flags).toContain('tradie_manual_line:better#1')
    expect((captured.quotesUpdate?.better as { subtotal_ex_gst: number }).subtotal_ex_gst).toBe(920)
  })

  it.each(['unauthenticated', 'other_tenant'])('cannot grant manual price authority to %s', async (actor) => {
    if (actor === 'unauthenticated') state.user = null
    else (state.quote as Record<string, unknown>).tenant_id = 'another-tenant'
    const result = await POST(req(manualBody, 'tok'), params)
    expect([401, 403]).toContain(result.status)
    expect(vi.mocked(validateQuoteGrounding)).not.toHaveBeenCalled()
    expect(captured.quotesUpdate).toBeNull()
  })
})

describe('released EV edits preserve the canonical customer-visible service mode', () => {
  const unit = {
    description: 'EV charger unit', quantity: 1, unit: 'each', unit_price_ex_gst: 800,
    total_ex_gst: 800, source: 'material:unit-1',
  }
  const install = {
    description: 'Install EV charger', quantity: 1, unit: 'each', unit_price_ex_gst: 400,
    total_ex_gst: 400, source: 'assembly:install-1',
  }
  const labour = {
    description: 'Licensed electrician labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 100,
    total_ex_gst: 200, source: 'labour',
  }

  function configure(mode: 'supply_only' | 'install_only' | 'supply_and_install' | undefined, lines: typeof unit[]) {
    const subtotal = lines.reduce((sum, line) => sum + line.total_ex_gst, 0)
    Object.assign(state.quote as object, {
      status: 'sent', quote_kind: 'initial', good: null, best: null,
      scope_of_works: mode === 'supply_only' ? 'Supply only the EV charger. Installation excluded. Electrical work excluded.'
        : mode === 'install_only' ? 'Install the customer-supplied EV charger.' : 'Supply and install the EV charger.',
      total_inc_gst: Number((subtotal * 1.1).toFixed(2)),
      better: {
        label: 'EV charger', line_items: structuredClone(lines),
        subtotal_ex_gst: subtotal,
      },
    })
    state.intake = {
      tenant_id: 't1', trade: 'electrical', job_type: 'ev_charger', caller: null,
      scope: {
        specs: { ...(mode ? { service_mode: mode } : {}) },
        ...(mode === 'supply_only' || mode === 'supply_and_install'
          ? { chosen_product: { catalogue_id: 'unit-1' } }
          : {}),
      },
    }
    state.pricingBook = {
      id: 'pb1', tenant_id: 't1', trade: 'electrical', gst_registered: true,
      hourly_rate: 100, apprentice_rate: 60, call_out_minimum: 100,
      default_markup_pct: 0, min_labour_hours: 1,
    }
    state.candidates = {
      material: [{ sourceId: 'unit-1', sourceName: 'EV charger unit', price: 800, categories: new Set(['ev_charger']) }],
      assembly: [{ sourceId: 'install-1', sourceName: 'Install EV charger', price: 400, categories: new Set(['ev_charger']) }],
    }
  }

  function edit(lines: typeof unit[]) {
    const current = ((state.quote as Record<string, unknown>).better as { line_items: typeof unit[] }).line_items
    return {
      expected_revision: quoteEditRevision(state.quote as Record<string, unknown>),
      notify_customer: false,
      better: {
        label: 'Revised EV charger',
        line_items: lines.map((line) => {
          const original_line_index = current.findIndex((saved) => saved.source === line.source)
          if (original_line_index >= 0) return { ...line, original_line_index }
          const { source: _source, ...manual } = line
          void _source
          return manual
        }),
      },
    }
  }

  it.each([
    ['supply_only', [unit], [unit, install]],
    ['install_only', [install, labour], [install, labour, unit]],
    ['supply_and_install', [unit, install, labour], [install, labour]],
  ] as const)('blocks a released %s edit that changes its promised service', async (mode, current, proposed) => {
    configure(mode, Array.from(current))
    const response = await POST(req(edit(Array.from(proposed)), 'tok'), params)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'ev_service_mode_review_required' })
    expect(captured.effects).not.toContain('save')
    expect(captured.quotesUpdate).toBeNull()
  })

  it('blocks a released EV edit with unknown service mode before the first write', async () => {
    configure(undefined, [install, labour])
    const response = await POST(req(edit([install, labour]), 'tok'), params)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: 'ev_service_mode_review_required',
      failures: expect.arrayContaining([expect.objectContaining({ code: 'missing_service_mode' })]),
    })
    expect(captured.effects).not.toContain('save')
  })

  it.each([
    ['supply_only', [unit]],
    ['install_only', [install, labour]],
    ['supply_and_install', [unit, install, labour]],
  ] as const)('allows a released, catalogue-consistent %s correction', async (mode, lines) => {
    configure(mode, Array.from(lines))
    const response = await POST(req(edit(Array.from(lines)), 'tok'), params)
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200)
    expect(captured.effects).toContain('save')
  })

  it('allows an unreleased inconsistent EV correction to be saved but never notifies the customer', async () => {
    configure('supply_only', [unit])
    Object.assign(state.quote as object, { status: 'awaiting_tradie_approval' })
    const response = await POST(req({ ...edit([unit, install]), notify_customer: true }, 'tok'), params)
    expect(response.status).toBe(200)
    expect(captured.effects).toContain('save')
    expect(captured.callbacks).toHaveLength(0)
    expect(dispatchQuoteWithPdf).not.toHaveBeenCalled()
  })

  it('loses the conditional write if approval releases the EV quote after it was read', async () => {
    configure('supply_only', [unit])
    Object.assign(state.quote as object, { status: 'awaiting_tradie_approval', customer_released_at: null })
    state.raceReleaseOnSave = true
    const response = await POST(req(edit([unit, install]), 'tok'), params)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'quote_changed' })
    expect(captured.quotesUpdate).toBeNull()
    expect(dispatchQuoteWithPdf).not.toHaveBeenCalled()
  })
})

describe('POST /api/quote/[id]/edit — pricing book is scoped to the quote trade', () => {
  it('retains captured GST after the current book is deleted', async () => {
    const quote = state.quote as Record<string, unknown>
    quote.pricing_book_version_id = 'v1'
    quote.total_inc_gst = 110352
    state.version = { id: 'v1', tenant_id: 't1', trade: 'roofing', pricing_book_id: 'old', content_hash: 'a'.repeat(64),
      snapshot: { id: 'old', tenant_id: 't1', trade: 'roofing', gst_registered: false } }
    state.pricingBook = null
    const response = await POST(req(EDIT_BODY, 'tok'), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ gst_registered: false, persisted: true })
    expect(captured.quotesUpdate?.total_inc_gst).toBe(119352)
    expect((state.quote as Record<string, unknown>).pricing_book_version_id).toBe('v1')
  })
  it.each(['quote_draft_processing', 'quote_draft_unconfirmed'] as const)('blocks %s before write/provider', async code => {
    vi.mocked(readQuoteDraftReadiness).mockResolvedValueOnce({ ready: false, code })
    expect(await (await POST(req(EDIT_BODY, 'tok'), params)).json()).toMatchObject({ error: code })
    expect(captured.effects).toEqual([])
  })
  it("reads the INTAKE trade's row, not whichever row limit(1) returns first", async () => {
    // Multi-trade tenant, plumbing row FIRST — live shape (Atomic): an
    // unscoped .eq('tenant_id').limit(1) read returns the plumbing row, so
    // this electrical quote's GST recompute and grounding rates came from
    // the wrong trade's book (audit 2026-07-23). The draft route and the
    // customer page are trade-scoped; the edit route must match.
    state.pricingBooks = [
      { id: 'pb-plumbing', tenant_id: 't1', trade: 'plumbing', gst_registered: false, hourly_rate: 120, default_markup_pct: 18 },
      { id: 'pb-electrical', tenant_id: 't1', trade: 'electrical', gst_registered: true, hourly_rate: 110, default_markup_pct: 30 },
    ]
    state.intake = { tenant_id: 't1', trade: 'electrical', job_type: 'downlights', caller: null, scope: null }

    const res = await POST(req(EDIT_BODY, 'tok'), params)
    expect(res.status).toBe(200)
    expect(captured.quotesUpdate).not.toBeNull()

    // gst_registered comes from the ELECTRICAL row (true) → the persisted
    // headline total carries GST. The plumbing-first unscoped read (false)
    // would persist total === subtotal exactly.
    const better = captured.quotesUpdate!.better as { subtotal_ex_gst: number }
    const total = captured.quotesUpdate!.total_inc_gst as number
    expect(total).toBeCloseTo(+(better.subtotal_ex_gst * 1.1).toFixed(2), 2)
  })
})

describe('POST /api/quote/[id]/edit — the tier mint is trade-gated (spec elec-plumb-site-visit-first)', () => {
  // The retired path: for these two trades /r/<token>/<G|B|B> 302s onto the
  // inspection mint and nothing exposes stripe_links[tier], so re-minting a
  // Session on every edit burns a Stripe call and writes a dead link.
  it.each(['electrical', 'plumbing'])(
    '%s: drops + expires the stale tier links and mints NOTHING',
    async (trade) => {
      state.intake = { tenant_id: 't1', trade, job_type: 'downlights', caller: null, scope: null }
      // Catalogue trades require a COMPLETE book (route: the grounding validator
      // grades edits against it) — a sparse row 409s before the mint loop.
      state.pricingBook = { id: 'pb1', tenant_id: 't1', trade, gst_registered: true, hourly_rate: 110, default_markup_pct: 30 }
      ;(state.quote as Record<string, unknown>).stripe_links = {
        good: 'https://stripe.test/old-good',
        better: 'https://stripe.test/old-better',
        inspection: 'https://stripe.test/site-visit',
      }

      const res = await POST(req(EDIT_BODY, 'tok'), params)
      expect(res.status).toBe(200)

      expect(vi.mocked(createCheckoutSessionForTier)).not.toHaveBeenCalled()
      // Only the CHANGED tier's stale Session is expired…
      expect(vi.mocked(expireCheckoutSession).mock.calls.map((c) => c[0])).toEqual([
        'https://stripe.test/old-better',
      ])
      // …and the live $99 link survives, along with untouched tiers.
      expect(captured.quotesUpdate!.stripe_links).toEqual({
        good: 'https://stripe.test/old-good',
        inspection: 'https://stripe.test/site-visit',
      })
    },
  )

  it.each(['solar', 'commercial_painting'])(
    '%s: still re-mints the tier Session exactly as before',
    async (trade) => {
      state.intake = { tenant_id: 't1', trade, job_type: 'other', caller: null, scope: null }
      state.pricingBook = { id: 'pb1', tenant_id: 't1', trade, gst_registered: true }
      ;(state.quote as Record<string, unknown>).stripe_links = {
        better: 'https://stripe.test/old-better',
      }

      const res = await POST(req(EDIT_BODY, 'tok'), params)
      expect(res.status).toBe(200)

      expect(vi.mocked(createCheckoutSessionForTier)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(expireCheckoutSession).mock.calls.map((c) => c[0])).toEqual([
        'https://stripe.test/old-better',
      ])
      expect(captured.quotesUpdate!.stripe_links).toEqual({
        better: 'https://stripe.test/session/better',
      })
    },
  )

  it('a trade-less legacy row requires review and never re-mints', async () => {
    state.intake = { tenant_id: 't1', trade: null, job_type: 'other', caller: null, scope: null }
    const res = await POST(req(EDIT_BODY, 'tok'), params)
    expect(res.status).toBe(409)
    expect(vi.mocked(createCheckoutSessionForTier)).not.toHaveBeenCalled()
  })
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

describe('POST edit — revision, provenance and delivery boundaries', () => {
  it('keeps an initial quiet price save as draft and sends nothing', async () => {
    Object.assign(state.quote as object, { status: 'draft', quote_kind: 'initial' })
    const response = await POST(req({ ...EDIT_BODY, notify_customer: false }, 'tok'), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ persisted: true, notification_requested: false })
    expect(captured.quotesUpdate?.status).toBe('draft')
    expect(captured.callbacks).toHaveLength(0)
    expect(dispatchQuoteWithPdf).not.toHaveBeenCalled()
  })

  it.each(['awaiting_tradie_approval', 'draft'])('does not send a final child in %s on edit', async (status) => {
    Object.assign(state.quote as object, { status, quote_kind: 'final' })
    const response = await POST(req({ ...EDIT_BODY, notify_customer: true }, 'tok'), params)
    expect(response.status).toBe(200)
    expect(captured.quotesUpdate?.status).toBe(status)
    expect(captured.callbacks).toHaveLength(0)
    expect(createCheckoutSessionForTier).not.toHaveBeenCalled()
  })

  it('rejects a payment arriving at the conditional save before any checkout or send', async () => {
    state.raceOnSave = true
    const response = await POST(req(EDIT_BODY, 'tok'), params)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'quote_changed' })
    expect(captured.quotesUpdate).toBeNull()
    expect(captured.effects).toEqual(['save'])
    expect(captured.callbacks).toHaveLength(0)
  })

  it('rejects a stale client revision before writes and provider work', async () => {
    const response = await POST(req({ ...EDIT_BODY, expected_revision: 'a'.repeat(64) }, 'tok'), params)
    expect(response.status).toBe(409)
    expect(captured.effects).toEqual([])
  })

  it('preserves exact owned provenance through rename, reorder and saved readback', async () => {
    const quote = state.quote as Record<string, unknown>
    const tier = quote.better as { line_items: Array<Record<string, unknown>> }
    Object.assign(tier.line_items[0], { source: 'material:stored-id', supplied_by: 'customer', safety_note: 'Use AU-certified equipment.' })
    const revision = quoteEditRevision(quote)
    const response = await POST(req({ expected_revision: revision, notify_customer: false, better: {
      label: 'Revised roof', line_items: [{ original_line_index: 0, description: 'Renamed existing work', quantity: 968, unit: 'job', unit_price_ex_gst: 114 }],
    } }, 'tok'), params)
    expect(response.status).toBe(200)
    const saved = (state.quote as typeof quote).better as typeof tier
    expect(saved.line_items[0]).toMatchObject({ description: 'Renamed existing work', source: 'material:stored-id', supplied_by: 'customer', safety_note: 'Use AU-certified equipment.' })
    expect(saved.line_items[0]).not.toHaveProperty('original_line_index')
    expect(await response.json()).toMatchObject({ edit_revision: quoteEditRevision(state.quote as Record<string, unknown>) })
  })

  it.each([
    { source: 'material:injected' }, { supplied_by: 'customer' }, { safety_note: 'Forged safety claim' },
  ])('rejects conflicting injected provenance %j', async (injected) => {
    const response = await POST(req({ expected_revision: quoteEditRevision(state.quote as Record<string, unknown>), better: {
      label: 'Re-roof', line_items: [{ ...EDIT_BODY.better.line_items[0], original_line_index: 0, ...injected }],
    } }, 'tok'), params)
    expect(response.status).toBe(409)
    expect(captured.effects).toEqual([])
  })

  it('rejects duplicate original line identities', async () => {
    const line = { ...EDIT_BODY.better.line_items[0], original_line_index: 0 }
    const response = await POST(req({ expected_revision: quoteEditRevision(state.quote as Record<string, unknown>), better: {
      label: 'Re-roof', line_items: [line, line],
    } }, 'tok'), params)
    expect(response.status).toBe(400)
    expect(captured.effects).toEqual([])
  })

  it('requires a revision to use persisted line indices', async () => {
    const response = await POST(req({ better: { label: 'Re-roof', line_items: [{ ...EDIT_BODY.better.line_items[0], original_line_index: 0 }] } }, 'tok'), params)
    expect(response.status).toBe(400)
    expect(captured.effects).toEqual([])
  })

  it('preserves historically unregistered tax after current settings change', async () => {
    Object.assign(state.quote as object, { total_inc_gst: 110352 })
    const response = await POST(req({ ...EDIT_BODY, notify_customer: false }, 'tok'), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ gst_registered: false, total_inc_gst: 119352 })
    expect(vi.mocked(createCheckoutSessionForTier).mock.calls[0][0].quote.gst_registered).toBe(false)
  })

  it.each([null, 'true', undefined])('rejects absent or invalid owned GST %s', async (gst_registered) => {
    Object.assign(state.pricingBook as object, { gst_registered })
    expect((await POST(req(EDIT_BODY, 'tok'), params)).status).toBe(409)
    expect(captured.effects).toEqual([])
  })

  it('fails review on historical whole-dollar total that cannot establish exact GST', async () => {
    Object.assign(state.quote as object, { total_inc_gst: 121387 })
    expect((await POST(req(EDIT_BODY, 'tok'), params)).status).toBe(409)
    expect(captured.effects).toEqual([])
  })

  it.each([true, undefined])('never first-sends a draft from an edit with notify=%s', async (notify_customer) => {
    Object.assign(state.quote as object, { status: 'draft' })
    Object.assign(state.intake as object, { caller: { phone: '+61400000000' } })
    const response = await POST(req({ ...EDIT_BODY, notify_customer }, 'tok'), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ persisted: true, notification_requested: false })
    expect((state.quote as Record<string, unknown>).status).toBe('draft')
    expect(captured.callbacks).toHaveLength(0)
    expect(dispatchQuoteWithPdf).not.toHaveBeenCalled()
    expect(captured.quotesUpdate).not.toHaveProperty('sent_at')
    expect(captured.effects[0]).toBe('save')
  })

  it('does not let body fields forge release or manual-final authority', async () => {
    Object.assign(state.quote as object, { status: 'draft', quote_kind: 'initial' })
    const response = await POST(req({ ...EDIT_BODY, notify_customer: true, status: 'sent', quote_kind: 'final',
      sent_at: '2026-09-01', customer_released_at: '2026-09-01', grounding_result: {},
    }, 'tok'), params)
    expect(response.status).toBe(200)
    expect(state.quote).toMatchObject({ status: 'draft', quote_kind: 'initial' })
    expect(captured.quotesUpdate).not.toHaveProperty('sent_at')
    expect(captured.quotesUpdate).not.toHaveProperty('customer_released_at')
    expect(captured.quotesUpdate).not.toHaveProperty('grounding_result')
    expect(captured.callbacks).toHaveLength(0)
  })

  it.each([true, false])('retains a historical draft release without stamping sent_at when update delivery succeeds=%s', async (ok) => {
    Object.assign(state.quote as object, { status: 'draft', customer_released_at: '2026-09-01T00:00:00Z' })
    Object.assign(state.intake as object, { caller: { phone: '+61400000000' } })
    if (!ok) vi.mocked(dispatchQuoteWithPdf).mockResolvedValueOnce({ ok: false, smsAttempt: { code: 1, reason: 'failed' } } as never)
    await POST(req({ ...EDIT_BODY, notify_customer: true }, 'tok'), params)
    expect(captured.callbacks).toHaveLength(1)
    await captured.callbacks[0]()
    expect(dispatchQuoteWithPdf).toHaveBeenCalledTimes(1)
    expect((state.quote as Record<string, unknown>).status).toBe('draft')
    expect(captured.quotesUpdate).not.toHaveProperty('sent_at')
  })

  it('surfaces an acknowledged save with pending checkout reconciliation on provider failure', async () => {
    vi.mocked(createCheckoutSessionForTier).mockRejectedValueOnce(new Error('network lost'))
    const response = await POST(req({ ...EDIT_BODY, notify_customer: true }, 'tok'), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ persisted: true, checkout_sync: 'pending', notification_requested: false })
    expect(captured.callbacks).toHaveLength(0)
  })
  it.each(['roofing', 'electrical'])('keeps checkout pending for a resolved expiry failure on %s', async (trade) => {
    Object.assign(state.intake as object, { trade })
    Object.assign(state.pricingBook as object, { trade, hourly_rate: 100, default_markup_pct: 20 })
    Object.assign(state.quote as object, { stripe_links: { better: 'old-session' }, status: 'draft' })
    vi.mocked(expireCheckoutSession).mockResolvedValueOnce({ ok: false, reason: 'network_error' } as never)
    const response = await POST(req({ ...EDIT_BODY, notify_customer: true }, 'tok'), params)
    expect(await response.json()).toMatchObject({ persisted: true, checkout_sync: 'pending', notification_requested: false })
    expect(captured.callbacks).toHaveLength(0)
    expect(createCheckoutSessionForTier).not.toHaveBeenCalled()
  })
  it.each(['roofing', 'electrical'])('keeps checkout pending for a rejected expiry on %s', async (trade) => {
    Object.assign(state.intake as object, { trade })
    Object.assign(state.pricingBook as object, { trade, hourly_rate: 100, default_markup_pct: 20 })
    Object.assign(state.quote as object, { stripe_links: { better: 'old-session' }, status: 'draft' })
    vi.mocked(expireCheckoutSession).mockRejectedValueOnce(new Error('network lost'))
    const response = await POST(req({ ...EDIT_BODY, notify_customer: true }, 'tok'), params)
    expect(await response.json()).toMatchObject({ persisted: true, checkout_sync: 'pending', notification_requested: false })
    expect(captured.callbacks).toHaveLength(0)
    expect(createCheckoutSessionForTier).not.toHaveBeenCalled()
  })
  it('keeps checkout pending when the required replacement mint returns null', async () => {
    Object.assign(state.quote as object, { status: 'draft' })
    vi.mocked(createCheckoutSessionForTier).mockResolvedValueOnce(null)
    const response = await POST(req({ ...EDIT_BODY, notify_customer: true }, 'tok'), params)
    expect(await response.json()).toMatchObject({ persisted: true, checkout_sync: 'pending', notification_requested: false })
    expect(captured.callbacks).toHaveLength(0)
  })
  it.each([10, 50])('preserves the stored %s percent deposit in replacement checkout', async (deposit_pct) => {
    Object.assign(state.quote as object, { deposit_pct })
    expect((await POST(req({ ...EDIT_BODY, notify_customer: false }, 'tok'), params)).status).toBe(200)
    expect(vi.mocked(createCheckoutSessionForTier).mock.calls[0][0].quote.deposit_pct).toBe(deposit_pct)
  })
  it.each([undefined, null, '30', 0, 100])('rejects invalid or missing stored deposit %s before financial mutation', async (deposit_pct) => {
    Object.assign(state.quote as object, { deposit_pct })
    expect((await POST(req(EDIT_BODY, 'tok'), params)).status).toBe(409)
    expect(captured.effects).toEqual([])
  })
  it('calculates line total from the exact cent-rounded unit price it stores', async () => {
    const response = await POST(req({ better: { label: 'Re-roof', line_items: [
      { description: 'Manual work', quantity: 3, unit: 'job', unit_price_ex_gst: 1.234 },
    ] }, notify_customer: false }, 'tok'), params)
    expect(response.status).toBe(200)
    expect(((state.quote as Record<string, unknown>).better as { line_items: unknown[] }).line_items[0]).toMatchObject({ unit_price_ex_gst: 1.23, total_ex_gst: 3.69 })
  })
  it.each([null, '', ' ', true])('rejects invalid numeric value %j before saving a mixed positive tier', async (value) => {
    for (const field of ['quantity', 'unit_price_ex_gst']) {
      const response = await POST(req({ better: { label: 'Re-roof', line_items: [
        ...EDIT_BODY.better.line_items, { description: 'Missing price', quantity: 1, unit_price_ex_gst: 100, [field]: value },
      ] }, notify_customer: false }, 'tok'), params)
      expect(response.status).toBe(400)
    }
    expect(captured.effects).toEqual([])
  })
  it.each([0, '0', '12.25'])('accepts explicit numeric price %j in a positive tier', async (value) => {
    const response = await POST(req({ better: { label: 'Re-roof', line_items: [
      ...EDIT_BODY.better.line_items, { description: 'Explicit price', quantity: 1, unit_price_ex_gst: value },
    ] }, notify_customer: false }, 'tok'), params)
    expect(response.status).toBe(200)
  })
})
