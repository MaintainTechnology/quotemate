import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>
  const state = { quote: null as Row | null, intake: {} as Row, book: {} as Row, conversation: {} as Row }
  const writes: Array<{ table: string; operation: string; row: Row }> = []
  const afterWork: Array<() => Promise<void>> = []
  function from(table: string) {
    let patch: Row | undefined
    let operation = 'read'
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'order', 'limit', 'eq', 'is', 'in']) query[method] = () => query
    query.update = (row: Row) => { patch = row; operation = 'update'; return query }
    query.insert = (row: Row) => { patch = row; operation = 'insert'; return query }
    function result() {
      if (patch) {
        writes.push({ table, operation, row: patch })
        if (table === 'quotes') state.quote = {
          id: '22222222-2222-4222-8222-222222222222', created_at: '2026-09-23T00:00:00Z',
          ...state.quote, ...patch,
        }
        if (table === 'sms_conversations') state.conversation = { ...state.conversation, ...patch }
        return { data: table === 'quotes' ? state.quote : state.conversation, error: null }
      }
      if (table === 'quotes') return { data: state.quote, error: null }
      if (table === 'intakes') return { data: state.intake, error: null }
      if (table === 'pricing_book') return { data: state.book, error: null }
      if (table === 'sms_conversations') return { data: state.conversation, error: null }
      if (table === 'tenants') return { data: {
        twilio_sms_number: '+61488888888', owner_mobile: '+61422222222', business_name: 'Synthetic Electrical',
      }, error: null }
      throw new Error(`Unexpected database table: ${table}`)
    }
    query.single = async () => result()
    query.maybeSingle = async () => result()
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve)
    return query
  }
  return {
    state, writes, afterWork, client: { from }, checkpoint: vi.fn(), engine: vi.fn(),
    send: vi.fn(), handoff: vi.fn(), checkout: vi.fn(), connect: vi.fn(), earlyOffer: vi.fn(),
    pdf: vi.fn(), sendPdf: vi.fn(),
  }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('@/lib/sms/durable-work', () => ({
  currentSmsWork: () => ({ jobId: 'work-1', ownerToken: 'owner-1', turnId: 'turn-1' }),
  withFencedSmsClient: (db: unknown) => db,
  assertSmsWorkOwnership: async () => {}, attributeSmsWorkTenant: async () => {}, smsWorkFetch: vi.fn(),
  durableAfter: (callback: () => Promise<void>) => h.afterWork.push(callback),
  smsWorkCheckpoint: (_key: string, operation: () => Promise<unknown>) => operation(),
  enqueueSmsWork: vi.fn(), enqueueEstimateWork: vi.fn(), internalWorkPayload: vi.fn(), runSmsWorkNow: vi.fn(),
}))
vi.mock('@/lib/sms/work-delivery-context', () => ({ smsDeliveryWorkScope: vi.fn() }))
vi.mock('@/lib/sms/delivery-context', () => ({ updateSmsDeliveryContext: vi.fn() }))
vi.mock('@/lib/agents/cron', () => ({ isCronAuthorised: () => true }))
vi.mock('@/lib/estimate/run', () => ({ runEstimation: h.engine }))
vi.mock('@/lib/quote/pricing-version', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/quote/pricing-version')>(),
  versionedEstimationCheckpoint: h.checkpoint,
}))
vi.mock('@/lib/billing/entitlements', () => ({
  isEnforcementEnabled: () => false, checkQuoteEntitlement: vi.fn(), checkVoiceEntitlement: vi.fn(),
}))
vi.mock('@/lib/log/pipeline', () => ({ pipelineLog: () => ({ step: vi.fn(), ok: vi.fn(), err: vi.fn(), done: vi.fn() }) }))
vi.mock('@/lib/sms/dispatch', () => ({ dispatchQuoteMessage: h.send }))
vi.mock('@/lib/sms/human-handoff', () => ({ persistHumanHandoff: h.handoff }))
vi.mock('@/lib/stripe/checkout', () => ({
  createCheckoutSessionsForQuote: h.checkout, createInspectionCheckoutSession: h.checkout,
  generateShareToken: () => 'held_quote_token_123',
}))
vi.mock('@/lib/stripe/connect', () => ({ connectDestinationForTenantId: h.connect }))
vi.mock('@/lib/quote/early-bird', () => ({ earlyBirdConfigFromOverlays: h.earlyOffer, computeEarlyBirdOffer: h.earlyOffer }))
vi.mock('@/lib/quote/scope-short', () => ({ stampScopeShort: vi.fn() }))
vi.mock('@/lib/quote/pdf', () => ({ ensureQuotePdf: h.pdf, quotePdfUrl: vi.fn(), signQuotePdfUrl: vi.fn() }))
vi.mock('@/lib/sms/send-quote-pdf', () => ({ dispatchQuoteWithPdf: h.sendPdf }))
vi.mock('@/lib/filestore/ingest-quote', () => ({ archiveAndIngestQuote: vi.fn() }))
vi.mock('@/lib/ig-engine/generate', () => ({ generatePreviewImage: vi.fn().mockResolvedValue({ status: 'skipped' }) }))
vi.mock('@/lib/ig-engine/samples', () => ({ generateSampleImages: vi.fn().mockResolvedValue({ status: 'skipped' }) }))

import { buildRank1Estimation, rank1ReviewResult } from '@/lib/estimate/rank1'
import { assertQuoteCoreCustomerReleaseAllowed } from '@/lib/quote/quote-core-release'
import { POST } from './route'

const intakeId = '11111111-1111-4111-8111-111111111111'
const quoteId = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('RANK1_QUOTE_CORE_TENANTS', '')
  h.state.quote = null
  h.writes.length = 0
  h.afterWork.length = 0
  h.state.intake = {
    id: intakeId, tenant_id: 'tenant-1', trade: 'electrical', job_type: 'downlight_install',
    caller: { phone: '+61411111111' }, call_id: null, confidence: 'HIGH', inspection_required: false,
    address: '1 Synthetic Street, Sydney NSW', property: { levels: 1 },
    scope: { item_count: 2, specs: { supplied_by: 'tradie' } },
  }
  h.state.book = {
    id: 'book-1', tenant_id: 'tenant-1', trade: 'electrical', gst_registered: true,
    hourly_rate: 100, min_labour_hours: 1, call_out_minimum: 0,
    review_policy: 'auto_send', overlays: { early_bird: { enabled: true, discount_pct: 10 } },
  }
  h.state.conversation = {
    id: 'conversation-1', intake_id: intakeId, tenant_id: 'tenant-1', from_number: '+61411111111',
    quote_id: null, quote_stage: 'estimate_pending', status: 'structuring', conversation_state: { slots: {} },
  }
  h.send.mockResolvedValue({ ok: true, outboxId: 'held-status-outbox' })
  h.handoff.mockResolvedValue({ id: 'review-task', notified: true })
})
afterEach(() => vi.unstubAllEnvs())

describe('actual estimate POST persists Rank1 review without payment or customer quote delivery', () => {
  it.each(['tenant-1', 'tenant-2'])('preserves a real priced core draft and still requires approval for %s', async tenantId => {
    h.state.intake.tenant_id = h.state.book.tenant_id = h.state.conversation.tenant_id = tenantId
    h.state.book.default_markup_pct = 20
    h.engine.mockImplementation((intake, pricingBook, _model, _state, context) =>
      buildRank1Estimation({ intake, pricingBook, context, loadInputs: async () => ({
        input: {
          bom: [{ material_category: 'downlight', quantity: 2, required: true }],
          tenantMaterials: [{ id: 'owned-product-1', name: 'Approved downlight', category: 'downlight',
            active: true, unit_price_ex_gst: 10 }],
          sharedMaterials: [], labourHours: 1.5, hourlyRate: 100, markupPct: 20,
        },
        assemblyName: 'Replace downlights', recipeSourceId: 'owned-recipe-1', recipeRowIds: ['owned-row-1'],
        taskRows: { tenant: [], shared: [] },
      }) }))
    h.checkpoint.mockImplementation(async (_db, args) => {
      const version = { id: 'version-1', snapshot: args.book }
      return { pricingVersion: version, estimation: await args.run(version) }
    })
    h.connect.mockResolvedValue(null)
    h.checkout.mockResolvedValue('https://checkout.invalid/owned-inspection')
    const response = await POST(new Request('https://quotemax.com.au/api/estimate/draft', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intakeId }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, quoteId })
    expect(h.state.quote).toMatchObject({
      tenant_id: tenantId, status: 'awaiting_tradie_approval', auto_sent: false,
      needs_inspection: false, subtotal_ex_gst: 174, gst: 17.4, total_inc_gst: 191.4,
      pricing_book_version_id: 'version-1',
      grounding_result: { quote_core: { status: 'priced', tenantId, pricingBookVersionId: 'version-1' } },
    })
    // Test the actual saved, JSON-serializable row against the release verifier.
    // A valid core draft must not be silently rewritten into an unreleasable quote.
    expect(assertQuoteCoreCustomerReleaseAllowed(
      JSON.parse(JSON.stringify(h.state.quote)), tenantId, h.state.intake,
    )).toMatchObject({ status: 'priced' })
    for (const callback of h.afterWork) await callback()
    expect(h.state.conversation).toMatchObject({ quote_id: quoteId, quote_stage: 'awaiting_review' })
    expect(h.state.quote?.customer_released_at).toBeFalsy()
    expect(h.state.quote?.sent_at).toBeFalsy()
    expect(h.state.quote?.auto_sent).toBe(false)
    expect(h.sendPdf).not.toHaveBeenCalled()
    expect(h.send.mock.calls.every(([message]) =>
      !message.text?.match(/held_quote_token_123|\/q\/|\/r\/|checkout\.invalid|\$191/),
    )).toBe(true)
  })

  it.each(['tenant-1', 'tenant-2'])('holds missing approved pricing for any account: %s', async tenantId => {
    h.state.intake.tenant_id = tenantId
    h.state.book = {}
    h.checkpoint.mockImplementation(async (_db, args) => ({ pricingVersion: null, estimation: await args.run(null) }))
    const response = await POST(new Request('https://quotemax.com.au/api/estimate/draft', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intakeId }),
    }))
    expect(response.status).toBe(200)
    expect(h.state.quote).toMatchObject({ tenant_id: tenantId, needs_inspection: false, total_inc_gst: 0,
      good: null, better: null, best: null, pricing_book_version_id: null,
      grounding_result: { held_for_review: true, quote_core: { status: 'review_required', tenantId } } })
    expect(h.engine).not.toHaveBeenCalled()
    expect(h.checkout).not.toHaveBeenCalled()
  })

  it.each(['plumbing', 'roofing', 'painting', 'solar'])(
    'holds unsupported generic %s requests with the real core instead of model pricing or a paid inspection', async trade => {
      h.state.intake.trade = h.state.book.trade = trade
      const loadInputs = vi.fn(async () => { throw new Error('Unsupported adapter must not load prices') })
      h.engine.mockImplementation((intake, pricingBook, _model, _state, context) =>
        buildRank1Estimation({ intake, pricingBook, context, loadInputs }))
      h.checkpoint.mockImplementation(async (_db, args) => {
        const version = { id: 'version-1', snapshot: args.book }
        return { pricingVersion: version, estimation: await args.run(version) }
      })
      const response = await POST(new Request('https://quotemax.com.au/api/estimate/draft', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intakeId }),
      }))
      expect(response.status).toBe(200)
      expect(h.state.quote).toMatchObject({ needs_inspection: false, total_inc_gst: 0,
        good: null, better: null, best: null, grounding_result: { quote_core: { status: 'review_required' } } })
      expect(h.state.quote?.scope_of_works).not.toContain('Electrical')
      expect(loadInputs).not.toHaveBeenCalled()
      expect(h.checkout).not.toHaveBeenCalled()
    },
  )

  it.each(['tenant_id', 'trade'])('rejects a missing %s before draft, provider, SMS or payment effects', async field => {
    delete h.state.intake[field]
    const response = await POST(new Request('https://quotemax.com.au/api/estimate/draft', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intakeId }),
    }))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: 'intake_identity_review_required' })
    expect(h.writes).toEqual([])
    expect(h.checkpoint).not.toHaveBeenCalled()
    expect(h.engine).not.toHaveBeenCalled()
    expect(h.afterWork).toEqual([])
    expect(h.checkout).not.toHaveBeenCalled()
  })

  it.each(['quote-core hold', 'legacy checkpoint'])('holds a %s without the Electrical $99 checkout branch', async kind => {
    const estimation = rank1ReviewResult(h.state.intake, { pricingBookVersionId: 'version-1' }, 'Approved recipe unavailable')
    if (kind === 'legacy checkpoint') delete estimation.quoteCore
    h.checkpoint.mockResolvedValue({
      pricingVersion: { id: 'version-1', snapshot: h.state.book }, estimation,
    })
    const response = await POST(new Request('https://quotemax.com.au/api/estimate/draft', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intakeId }),
    }))
    expect(await response.json()).toEqual({ ok: true, quoteId })
    expect(response.status).toBe(200)
    expect(h.checkpoint).toHaveBeenCalledOnce()
    expect(h.engine).not.toHaveBeenCalled()
    expect(h.writes.filter(write => write.table === 'quotes' && write.operation === 'insert')).toHaveLength(1)
    expect(h.state.quote).toMatchObject({
      status: 'awaiting_tradie_approval', needs_inspection: false, inspection_cause: null,
      inspection_reason: null, good: null, better: null, best: null, selected_tier: null,
      subtotal_ex_gst: 0, gst: 0, total_inc_gst: 0, auto_sent: false, pricing_book_version_id: 'version-1',
      grounding_result: { ok: false, held_for_review: true, quote_core: { status: 'review_required' } },
    })
    expect(h.state.conversation).toMatchObject({ quote_id: quoteId, quote_stage: 'awaiting_review', status: 'done' })
    expect(h.checkout).not.toHaveBeenCalled()
    expect(h.connect).not.toHaveBeenCalled()
    expect(h.earlyOffer).not.toHaveBeenCalled()
    expect(h.writes.some(write => 'stripe_links' in write.row || 'early_bird_discount_pct' in write.row)).toBe(false)

    // Execute the real background review/recovery branch, not just its scheduling.
    for (const callback of h.afterWork) await callback()
    expect(h.handoff).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', resourceId: quoteId, requestKey: `quote:${quoteId}:review`, resourceType: 'generic',
    }))
    expect(h.send).toHaveBeenCalledOnce()
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({
      to: '+61411111111', deliveryKey: `quote:${quoteId}:review-status`,
      text: expect.stringContaining('awaiting tradie review. No quote has been sent yet.'),
    }))
    expect(h.send.mock.calls[0][0].text).not.toMatch(/held_quote_token_123|\/q\/|\/r\/|\$99/)
    expect(h.pdf).not.toHaveBeenCalled()
    expect(h.sendPdf).not.toHaveBeenCalled()
    expect(h.checkout).not.toHaveBeenCalled()
    expect(h.connect).not.toHaveBeenCalled()
  })
})
