import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildRank1Estimation } from '@/lib/estimate/rank1'
import { buildDeterministicTiers } from '@/lib/estimate/deterministic-bom'
import { captureQuoteCoreScope } from '@/lib/estimate/quote-core-scope'
import { assertQuoteCoreCustomerReleaseAllowed as assertRelease, QuoteCoreCustomerReleaseError } from './quote-core-release'
import { persistGenericQuoteRelease, quoteCustomerReleaseSnapshot } from './customer-release'

afterEach(() => vi.unstubAllEnvs())

function assertQuoteCoreCustomerReleaseAllowed(quote: Record<string, unknown>, tenantId: string) {
  const grounding = quote.grounding_result as { quote_core?: { scopeSnapshot?: unknown } } | undefined
  return assertRelease(quote, tenantId, grounding?.quote_core?.scopeSnapshot)
}

async function fixture() {
  const result = await buildRank1Estimation({
    intake: { tenant_id: 'tenant-a', trade: 'electrical', job_type: 'downlights', address: '10 Test Street',
      confidence: 'HIGH', inspection_required: false, scope: { item_count: 2, specs: { supplied_by: 'tradie' } } },
    pricingBook: { id: 'book-a', tenant_id: 'tenant-a', trade: 'electrical', gst_registered: true,
      min_labour_hours: 1.5, call_out_minimum: 100 }, context: { pricingBookVersionId: 'version-a' },
    loadInputs: async () => ({ input: {
      bom: [{ material_category: 'downlight', quantity: 2, required: true }],
      tenantMaterials: [{ id: 'product-a', name: 'Downlight', category: 'downlight', active: true, unit_price_ex_gst: 10 }],
      sharedMaterials: [], hourlyRate: 110, labourHours: 1.5, markupPct: 25,
    }, assemblyName: 'Replace downlights', recipeSourceId: 'recipe-a', recipeRowIds: ['row-a'], taskRows: { tenant: [], shared: [] } }),
  })
  expect(result.quoteCore?.status).toBe('priced')
  return {
    id: 'quote-a', tenant_id: 'tenant-a', pricing_book_version_id: 'version-a', quote_kind: 'initial',
    ...result.draft, subtotal_ex_gst: 190, gst: 19, total_inc_gst: 209,
    grounding_result: { ok: true, quote_core: result.quoteCore! },
  }
}

describe('Quote Core customer release proof', () => {
  it('accepts the exact stored core quote without a catalogue or provider read', async () => {
    const quote = await fixture()
    expect(assertQuoteCoreCustomerReleaseAllowed(quote, 'tenant-a')?.status).toBe('priced')
    expect(quoteCustomerReleaseSnapshot(quote).good).toHaveProperty('calculation.version', 'quote-core-v1')
  })

  it.each(['tenant_id', 'pricing_book_version_id'] as const)('rejects changed quote %s', async (field) => {
    const quote = await fixture(); quote[field] = 'another'
    expect(() => assertQuoteCoreCustomerReleaseAllowed(quote, 'tenant-a')).toThrow(QuoteCoreCustomerReleaseError)
  })

  it('rejects mismatched metadata and missing calculation evidence', async () => {
    const mismatch = await fixture(); mismatch.grounding_result.quote_core.tenantId = 'another'
    expect(() => assertQuoteCoreCustomerReleaseAllowed(mismatch, 'tenant-a')).toThrow(QuoteCoreCustomerReleaseError)
    const missing = await fixture(); delete missing.good.calculation
    expect(() => assertQuoteCoreCustomerReleaseAllowed(missing, 'tenant-a')).toThrow(QuoteCoreCustomerReleaseError)
    const missingMetadata = await fixture()
    expect(() => assertQuoteCoreCustomerReleaseAllowed({ ...missingMetadata, grounding_result: {} }, 'tenant-a')).toThrow(QuoteCoreCustomerReleaseError)
    for (const tier of ['good', 'better', 'best']) delete missingMetadata[tier].calculation
    expect(() => assertQuoteCoreCustomerReleaseAllowed({ ...missingMetadata, grounding_result: {} }, 'tenant-a')).toThrow(QuoteCoreCustomerReleaseError)
  })

  it('rejects edited sourceSnapshot prices even when the old monetary trace was retained', async () => {
    const quote = await fixture()
    quote.grounding_result.quote_core.sourceSnapshot!.tenantMaterials[0].unit_price_ex_gst = 200
    expect(() => assertQuoteCoreCustomerReleaseAllowed(quote, 'tenant-a')).toThrow(QuoteCoreCustomerReleaseError)
  })

  it.each(['quantity', 'unit_price_ex_gst', 'total_ex_gst', 'catalogue_id', 'description'] as const)('rejects a stale trace after a tradie edits line %s', async (field) => {
    const quote = await fixture()
    quote.good.line_items[0][field] = typeof quote.good.line_items[0][field] === 'number' ? 999 : 'edited'
    expect(() => assertQuoteCoreCustomerReleaseAllowed(quote, 'tenant-a')).toThrow(QuoteCoreCustomerReleaseError)
  })

  it('rejects tampered calculation math, unknown source IDs and deleted tiers', async () => {
    const quote = await fixture(); quote.good.calculation.totalIncGstCents++
    expect(() => assertQuoteCoreCustomerReleaseAllowed(quote, 'tenant-a')).toThrow(QuoteCoreCustomerReleaseError)
    const source = await fixture(); source.good.calculation.lines[0].sourceId = 'another-product'
    expect(() => assertQuoteCoreCustomerReleaseAllowed(source, 'tenant-a')).toThrow(QuoteCoreCustomerReleaseError)
    const missing = await fixture(); missing.best = null
    expect(() => assertQuoteCoreCustomerReleaseAllowed(missing, 'tenant-a')).toThrow(QuoteCoreCustomerReleaseError)
  })

  it.each(['subtotal_ex_gst', 'gst', 'total_inc_gst'] as const)('rejects inconsistent selected quote %s', async (field) => {
    const quote = await fixture(); quote[field]++
    expect(() => assertQuoteCoreCustomerReleaseAllowed(quote, 'tenant-a')).toThrow(QuoteCoreCustomerReleaseError)
  })

  it('never lets owner approval bypass a core review hold', async () => {
    const quote = await fixture(); quote.grounding_result.quote_core.status = 'review_required'
    expect(() => assertQuoteCoreCustomerReleaseAllowed(quote, 'tenant-a')).toThrow(QuoteCoreCustomerReleaseError)
  })

  it('accepts a genuine inspection state, but not an inspection flag carrying hidden work prices', async () => {
    const quote = await fixture()
    quote.grounding_result.quote_core.status = 'inspection_required'
    quote.needs_inspection = true
    expect(() => assertQuoteCoreCustomerReleaseAllowed(quote, 'tenant-a')).toThrow(QuoteCoreCustomerReleaseError)
    quote.good = quote.better = quote.best = null
    expect(assertQuoteCoreCustomerReleaseAllowed(quote, 'tenant-a')).toEqual({ status: 'inspection_required' })
  })

  it('keeps released historical and legitimate manual-final quotes on their existing release path', () => {
    expect(assertQuoteCoreCustomerReleaseAllowed({ good: { line_items: [] }, customer_released_at: '2026-09-01' }, 'tenant-a')).toBeNull()
    expect(assertQuoteCoreCustomerReleaseAllowed({ good: { line_items: [] }, quote_kind: 'final' }, 'tenant-a')).toBeNull()
    expect(() => assertQuoteCoreCustomerReleaseAllowed({ good: { line_items: [] } }, 'tenant-a'))
      .toThrow(QuoteCoreCustomerReleaseError)
  })

  it.each([undefined, null, 'initial', 'unrecognised'])('does not let quote kind %s bypass first-release authority', quoteKind => {
    expect(() => assertQuoteCoreCustomerReleaseAllowed({ quote_kind: quoteKind }, 'tenant-b'))
      .toThrow(QuoteCoreCustomerReleaseError)
  })
})

describe('Quote Core atomic release integration', () => {
  it('blocks a held core quote before approval/outbox creation', async () => {
    const quote = await fixture(); quote.grounding_result.quote_core.status = 'review_required'
    const rpc = vi.fn(); const from = vi.fn()
    await expect(persistGenericQuoteRelease({ rpc, from } as unknown as SupabaseClient, {
      quote, tenantId: 'tenant-a', ownerId: 'owner-a', holdUntil: null,
    })).rejects.toMatchObject({ code: 'quote_core_review_required', status: 409 })
    expect(rpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled()
  })

  it('binds verified tier traces into the existing atomic release snapshot', async () => {
    const quote = await fixture()
    const rpc = vi.fn(async () => ({ data: { approved: true, outbound: null, outbox_id: null }, error: null }))
    const from = vi.fn(() => { throw new Error('Mutable catalogue must not be loaded') })
    await expect(persistGenericQuoteRelease({ rpc, from } as unknown as SupabaseClient, {
      quote, tenantId: 'tenant-a', ownerId: 'owner-a', holdUntil: null,
      intake: quote.grounding_result.quote_core.scopeSnapshot as { trade: string; job_type: string },
    })).resolves.toEqual({ outbound: null, outboxId: null })
    expect(rpc).toHaveBeenCalledWith('approve_generic_quote_release', expect.objectContaining({
      p_snapshot: expect.objectContaining({ good: expect.objectContaining({ calculation: quote.good.calculation }) }),
    }))
    expect(from).not.toHaveBeenCalled()
  })

  it('requires recalculation of every unreleased generic legacy draft while preserving historical releases', async () => {
    vi.stubEnv('RANK1_QUOTE_CORE_TENANTS', 'tenant-a')
    const rpc = vi.fn(async () => ({ data: { approved: true, outbound: null, outbox_id: null }, error: null }))
    const client = { rpc } as unknown as SupabaseClient
    const request = { quote: { id: 'legacy', tenant_id: 'tenant-a', quote_kind: 'initial' },
      tenantId: 'tenant-a', ownerId: 'owner-a', holdUntil: null, intake: { trade: 'electrical', job_type: 'downlights' } }
    await expect(persistGenericQuoteRelease(client, request)).rejects.toMatchObject({ code: 'quote_core_review_required', status: 409 })
    expect(rpc).not.toHaveBeenCalled()
    await expect(persistGenericQuoteRelease(client, { ...request, quote: { ...request.quote, customer_released_at: '2026-09-01' } })).resolves.toBeDefined()
    await expect(persistGenericQuoteRelease(client, { ...request, tenantId: 'tenant-b', quote: { ...request.quote, tenant_id: 'tenant-b' } }))
      .rejects.toMatchObject({ code: 'quote_core_review_required', status: 409 })
    await expect(persistGenericQuoteRelease(client, { ...request, intake: { trade: 'plumbing', job_type: 'tap' } }))
      .rejects.toMatchObject({ code: 'quote_core_review_required', status: 409 })
  })

  it('blocks held or malformed core quotes regardless of the retired pilot flag', async () => {
    vi.stubEnv('RANK1_QUOTE_CORE_TENANTS', '')
    const rpc = vi.fn(); const client = { rpc } as unknown as SupabaseClient
    for (const mutation of ['held', 'malformed']) {
      const quote = await fixture()
      if (mutation === 'held') quote.grounding_result.quote_core.status = 'review_required'
      else delete quote.good.calculation
      await expect(persistGenericQuoteRelease(client, { quote, tenantId: 'tenant-a', ownerId: 'owner-a', holdUntil: null }))
        .rejects.toMatchObject({ code: 'quote_core_review_required', status: 409 })
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('retains EV installation and scope holds while using frozen core catalogue prices', async () => {
    const quote = await fixture()
    const source = quote.grounding_result.quote_core.sourceSnapshot!
    source.bom[0].material_category = 'ev_charger'
    source.tenantMaterials[0].category = 'ev_charger'
    source.tenantMaterials[0].name = 'EV charger unit'
    source.chosenProduct = { category: 'ev_charger', catalogue_id: 'product-a', tier: 'good' }
    quote.good = buildDeterministicTiers(source).tiers!.good
    quote.better = quote.best = null
    quote.selected_tier = 'good'
    quote.scope_of_works = 'Supply and install the selected EV charger.'
    quote.grounding_result.quote_core.scopeOfWorks = quote.scope_of_works
    const intake = { trade: 'electrical', job_type: 'ev_charger',
      scope: { specs: { service_mode: 'supply_and_install' }, chosen_product: { catalogue_id: 'product-a' } } }
    quote.grounding_result.quote_core.scopeSnapshot = captureQuoteCoreScope(intake)
    quote.good.coreScopeSnapshot = captureQuoteCoreScope(intake)
    quote.good.coreScopeOfWorks = quote.scope_of_works
    const rpc = vi.fn(async () => ({ data: { approved: true, outbound: null, outbox_id: null }, error: null }))
    const from = vi.fn(() => { throw new Error('Do not reload mutable catalogue prices') })
    const request = { quote, tenantId: 'tenant-a', ownerId: 'owner-a', holdUntil: null,
      intake,
      pricingBook: { hourly_rate: 110, apprentice_rate: 60, default_markup_pct: 25, call_out_minimum: 100 } }
    await expect(persistGenericQuoteRelease({ rpc, from } as unknown as SupabaseClient, request))
      .rejects.toMatchObject({ code: 'ev_service_mode_review_required',
        failures: [{ code: 'missing_grounded_installation', tier: 'good' }] })
    expect(from).not.toHaveBeenCalled()
    quote.scope_of_works = 'Install the charger. Charger supply is excluded.'
    await expect(persistGenericQuoteRelease({ rpc, from } as unknown as SupabaseClient, request))
      .rejects.toMatchObject({ code: 'quote_core_review_required' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('requires current owned intake scope for first release and catches later quantity/supply edits', async () => {
    const quote = await fixture()
    expect(() => assertRelease(quote, 'tenant-a')).toThrow(QuoteCoreCustomerReleaseError)
    for (const scope of [{ item_count: 50 }, { item_count: 2, specs: { supplied_by: 'customer' } }]) {
      expect(() => assertRelease(quote, 'tenant-a', { trade: 'electrical', job_type: 'downlights', scope }))
        .toThrow(QuoteCoreCustomerReleaseError)
    }
    expect(() => assertRelease(quote, 'tenant-a', { ...quote.grounding_result.quote_core.scopeSnapshot, trade: 'plumbing' }))
      .toThrow(QuoteCoreCustomerReleaseError)
  })

  it('rejects tampered scope evidence or scope prose and keeps tier scope in the SQL snapshot', async () => {
    const quote = await fixture()
    expect(quoteCustomerReleaseSnapshot(quote).good).toHaveProperty('coreScopeSnapshot', quote.grounding_result.quote_core.scopeSnapshot)
    quote.scope_of_works = 'Add another switchboard replacement'
    expect(() => assertQuoteCoreCustomerReleaseAllowed(quote, 'tenant-a')).toThrow(QuoteCoreCustomerReleaseError)
    const altered = structuredClone(await fixture()); altered.good.coreScopeSnapshot.scope.item_count = 50
    expect(() => assertRelease(altered, 'tenant-a', { trade: 'electrical', job_type: 'downlights', scope: { item_count: 2 } }))
      .toThrow(QuoteCoreCustomerReleaseError)
    const missing = await fixture(); delete missing.grounding_result.quote_core.scopeSnapshot
    expect(() => assertQuoteCoreCustomerReleaseAllowed(missing, 'tenant-a')).toThrow(QuoteCoreCustomerReleaseError)
  })

  it('replays an already released historical snapshot without reading today\'s modified intake scope', async () => {
    const quote = { ...await fixture(), customer_released_at: '2026-09-01T00:00:00Z' }
    expect(assertRelease(quote, 'tenant-a', { trade: 'electrical', job_type: 'downlights', scope: { item_count: 50 } })?.status).toBe('priced')
    expect(assertRelease(quote, 'tenant-a')?.status).toBe('priced')
  })

  it('invalidates first release when safety, access or job location changed outside scope', async () => {
    const quote = await fixture()
    for (const change of [{ inspection_required: true }, { property: { levels: 2 } }, { confidence: 'LOW' }, { address: 'Another job address' }]) {
      const intake = { ...quote.grounding_result.quote_core.scopeSnapshot, ...change }
      expect(() => assertRelease(quote, 'tenant-a', intake)).toThrow(QuoteCoreCustomerReleaseError)
    }
  })
})
