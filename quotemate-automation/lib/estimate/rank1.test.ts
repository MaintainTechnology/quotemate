import { describe, expect, it, vi } from 'vitest'
import { buildRank1Estimation, type Rank1LoadedInputs } from './rank1'

type Args = Parameters<typeof buildRank1Estimation>[0]
function fixture(): Args & { loaded: Extract<Rank1LoadedInputs, { input: object }> } {
  const loaded: Extract<Rank1LoadedInputs, { input: object }> = {
    input: {
      bom: [{ material_category: 'downlight', quantity: 2, required: true }],
      tenantMaterials: [{ id: 'product-1', name: 'Standard downlight', category: 'downlight',
        active: true, unit_price_ex_gst: 10 }],
      sharedMaterials: [], labourHours: 1.5, hourlyRate: 110, markupPct: 25,
    },
    assemblyName: 'Replace downlights', recipeSourceId: 'tenant-recipe-1', recipeRowIds: ['recipe-row-1'],
    taskRows: { tenant: [], shared: [] },
  }
  return {
    intake: { id: 'intake-1', tenant_id: 'tenant-a', trade: 'electrical', job_type: 'downlights',
      address: '10 Test Street, Sydney NSW', confidence: 'HIGH', inspection_required: false,
      scope: { item_count: 2, specs: { supplied_by: 'tradie' } } },
    pricingBook: { id: 'book-a', tenant_id: 'tenant-a', trade: 'electrical', gst_registered: true,
      min_labour_hours: 1.5, call_out_minimum: 100, hourly_rate: 110, default_markup_pct: 25 },
    context: { pricingBookVersionId: 'book-version-1' },
    loaded, loadInputs: vi.fn(async () => loaded),
  }
}

function expectReview(result: Awaited<ReturnType<typeof buildRank1Estimation>>) {
  expect(result.quoteCore?.status).toBe('review_required')
  expect(result.groundingHold).toBe(true)
  expect(result.draft).toMatchObject({ needs_inspection: false, good: null, better: null, best: null })
}

describe('Rank 1 real Quote Core integration', () => {
  it('prices only the approved recipe and carries exact cents and source provenance in each tier', async () => {
    const args = fixture()
    const result = await buildRank1Estimation(args)
    expect(result.quoteCore).toMatchObject({ status: 'priced', tenantId: 'tenant-a',
      pricingBookVersionId: 'book-version-1', recipeSourceId: 'tenant-recipe-1', recipeRowIds: ['recipe-row-1'] })
    for (const tier of ['good', 'better', 'best']) {
      expect(result.draft[tier]).toMatchObject({ subtotal_ex_gst: 190,
        calculation: { subtotalExGstCents: 19000, gstCents: 1900, totalIncGstCents: 20900,
          lines: [{ sourceId: 'product-1', sourceUnitPriceCents: 1000, unitPriceCents: 1250, totalExGstCents: 2500 },
            { sourceId: 'pricing_book:book-version-1:hourly_rate', unitPriceCents: 11000, totalExGstCents: 16500 }] } })
    }
    expect(result.quoteCore?.sourceSnapshot?.authority?.approvedCatalogueIds).toEqual(['product-1'])
  })

  it('preserves GST-exempt pricing and the approved minimum labour floor in the trace', async () => {
    const args = fixture(); args.pricingBook!.gst_registered = false; args.pricingBook!.min_labour_hours = 2
    const result = await buildRank1Estimation(args)
    expect(result.draft.good.calculation).toMatchObject({ subtotalExGstCents: 24500, gstCents: 0,
      totalIncGstCents: 24500, labourPolicy: { recipeHours: '1.5', minimumHours: '2', billableHours: '2' } })
  })

  it('does not hide missing recipe prices with model or shared-material pricing', async () => {
    const args = fixture(); args.loaded.input.tenantMaterials = []
    args.loaded.input.sharedMaterials = [{ category: 'downlight', name: 'Global fallback', default_unit_price_ex_gst: 1 }]
    const result = await buildRank1Estimation(args)
    expectReview(result)
    expect(result.quoteCore?.reason).toMatch(/missing_price/)
  })
})

describe('Rank 1 authority and intake gates', () => {
  it.each(['tenant-a', 'tenant-b'])('prices approved inputs for any account: %s', async tenantId => {
    const args = fixture()
    args.intake.tenant_id = tenantId
    args.pricingBook!.tenant_id = tenantId
    const result = await buildRank1Estimation(args)
    expect(result.quoteCore).toMatchObject({ status: 'priced', tenantId })
    expect(result.draft.better.calculation.tenantId).toBe(tenantId)
  })

  it.each(['plumbing', 'roofing', 'painting', 'solar', 'unsupported'])(
    'holds unsupported generic %s recipes without Electrical copy or inspection fees', async trade => {
      const args = fixture()
      args.intake.trade = args.pricingBook!.trade = trade
      args.intake.inspection_required = true
      const result = await buildRank1Estimation(args)
      expectReview(result)
      expect(result.draft.scope_of_works).not.toContain('Electrical')
      expect(result.quoteCore?.reason).toContain('trade-specific')
      expect(args.loadInputs).not.toHaveBeenCalled()
    },
  )

  it.each(['dimmable', 'ip_rating', 'colour'])('does not approve an unsupported requested specification: %s', async (key) => {
    const args = fixture()
    const scope = args.intake.scope as { specs: Record<string, unknown> }
    scope.specs.requested_specs = { [key]: 'required' }
    expectReview(await buildRank1Estimation(args))
  })
  it.each(['tenant_id', 'trade', 'id'] as const)('holds mismatched or absent book %s before loading a recipe', async (key) => {
    const args = fixture(); args.pricingBook![key] = key === 'id' ? '' : 'another'
    expectReview(await buildRank1Estimation(args))
    expect(args.loadInputs).not.toHaveBeenCalled()
  })

  it('requires a captured book version and explicit GST policy', async () => {
    const noVersion = fixture(); noVersion.context = null
    expectReview(await buildRank1Estimation(noVersion))
    const noGst = fixture(); delete noGst.pricingBook!.gst_registered
    expectReview(await buildRank1Estimation(noGst))
  })

  it.each([undefined, 0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1])('requires a confirmed exact item count: %s', async (item_count) => {
    const args = fixture(); (args.intake.scope as Record<string, unknown>).item_count = item_count
    expectReview(await buildRank1Estimation(args))
    expect(args.loadInputs).not.toHaveBeenCalled()
  })

  it.each(['MEDIUM', 'LOW', undefined])('holds %s confidence rather than pricing an unconfirmed scope', async (confidence) => {
    const args = fixture(); args.intake.confidence = confidence
    expectReview(await buildRank1Estimation(args))
  })

  it('requires explicit safety, address and supply responsibility', async () => {
    for (const mutation of ['safety', 'address', 'supply']) {
      const args = fixture()
      if (mutation === 'safety') delete args.intake.inspection_required
      if (mutation === 'address') args.intake.address = ''
      if (mutation === 'supply') (args.intake.scope as { specs: unknown }).specs = {}
      expectReview(await buildRank1Estimation(args))
    }
  })

  it('never infers EV installation from tradie supply or silently supports supply/install-only recipes', async () => {
    for (const service_mode of [undefined, 'supply_only', 'install_only']) {
      const args = fixture(); args.intake.job_type = 'ev_charger'
      ;(args.intake.scope as { specs: unknown }).specs = { supplied_by: 'tradie', service_mode }
      expectReview(await buildRank1Estimation(args))
      expect(args.loadInputs).not.toHaveBeenCalled()
    }
  })

  it('requires source row IDs and holds unresolved conditional recipe components', async () => {
    const missingId = fixture(); missingId.loaded.recipeRowIds = []
    expectReview(await buildRank1Estimation(missingId))
    const conditional = fixture(); conditional.loaded.input.bom[0].include_when = { integrated_driver: false }
    expectReview(await buildRank1Estimation(conditional))
  })

  it.each([undefined, 'supply_only'])('never converts an EV %s request into a visit because of a stale inspection flag', async service_mode => {
    const args = fixture()
    args.intake.job_type = 'ev_charger'
    args.intake.inspection_required = true
    args.intake.property = { phase: 'three' }
    ;(args.intake.scope as { specs: unknown }).specs = { supplied_by: 'tradie', service_mode }
    const result = await buildRank1Estimation(args)
    expectReview(result)
    expect(result.inspectionCause).toBeUndefined()
    expect(args.loadInputs).not.toHaveBeenCalled()
  })

  it('retains a genuine EV installation inspection without treating a unit-only purchase as installation', async () => {
    const args = fixture()
    args.intake.job_type = 'ev_charger'
    args.intake.inspection_required = true
    ;(args.intake.scope as { specs: unknown }).specs = { supplied_by: 'customer', service_mode: 'install_only' }
    expect((await buildRank1Estimation(args)).quoteCore?.status).toBe('inspection_required')
    expect(args.loadInputs).not.toHaveBeenCalled()
  })

  it('holds internal source read failures without charging for a site inspection', async () => {
    const args = fixture(); args.loadInputs = vi.fn(async () => { throw new Error('database unavailable') })
    expectReview(await buildRank1Estimation(args))
    args.loadInputs = vi.fn(async () => ({ input: null, reason: 'own recipe not approved' }))
    const result = await buildRank1Estimation(args)
    expectReview(result)
    expect(result.quoteCore?.reason).toBe('own recipe not approved')
  })

  it('holds a missing callout policy or recipe below the approved callout minimum', async () => {
    const absent = fixture(); delete absent.pricingBook!.call_out_minimum
    expectReview(await buildRank1Estimation(absent))
    const below = fixture(); below.pricingBook!.call_out_minimum = 300
    expectReview(await buildRank1Estimation(below))
  })

  it('keeps a genuine structured inspection requirement distinct from an internal review hold', async () => {
    const args = fixture(); args.intake.inspection_required = true
    const result = await buildRank1Estimation(args)
    expect(result.quoteCore?.status).toBe('inspection_required')
    expect(result.groundingHold).toBe(false)
    expect(result.draft).toMatchObject({ needs_inspection: true, good: null, better: null, best: null, pricing_path: 'inspection' })
    expect(result.inspectionCause).toBe('site_conditions')
    expect(args.loadInputs).not.toHaveBeenCalled()
  })
})

describe('Rank 1 product specification guard', () => {
  it('does not use recipe wording as evidence of the selected catalogue product specifications', async () => {
    const args = fixture()
    ;(args.intake.scope as { specs: unknown }).specs = { supplied_by: 'tradie', requested_specs: { wattage: '9W' } }
    args.loaded.input.bom[0].description = 'Install 9W downlight'
    args.loaded.input.tenantMaterials[0].name = 'Standard 6W downlight'
    expectReview(await buildRank1Estimation(args))
  })

  it('uses the exact catalogue product name when its structured specification is absent', async () => {
    const args = fixture()
    ;(args.intake.scope as { specs: unknown }).specs = { supplied_by: 'tradie', requested_specs: { wattage: '9W' } }
    args.loaded.input.bom[0].description = 'Install standard fitting'
    args.loaded.input.tenantMaterials[0].name = 'Standard 9W downlight'
    expect((await buildRank1Estimation(args)).quoteCore?.status).toBe('priced')
  })

  it('holds when no priced product matches the requested job category', async () => {
    const args = fixture()
    ;(args.intake.scope as { specs: unknown }).specs = { supplied_by: 'tradie', requested_specs: { wattage: '9W' } }
    args.loaded.input.bom[0].material_category = 'cable'
    args.loaded.input.bom[0].description = '9W downlight connection'
    args.loaded.input.tenantMaterials[0].category = 'cable'
    expectReview(await buildRank1Estimation(args))
  })

  it('holds when multiple priced catalogue products make the requested product identity ambiguous', async () => {
    const args = fixture()
    ;(args.intake.scope as { specs: unknown }).specs = { supplied_by: 'tradie', requested_specs: { wattage: '9W' } }
    args.loaded.input.bom[0].catalogue_id = 'product-1'
    args.loaded.input.bom.push({ ...args.loaded.input.bom[0], catalogue_id: 'product-2' })
    args.loaded.input.tenantMaterials[0].properties = { wattage: '9W' }
    args.loaded.input.tenantMaterials.push({ ...args.loaded.input.tenantMaterials[0], id: 'product-2' })
    expectReview(await buildRank1Estimation(args))
  })

  it('holds a known product specification conflict', async () => {
    const args = fixture()
    ;(args.intake.scope as { specs: unknown }).specs = { supplied_by: 'tradie', requested_specs: { wattage: '9W' } }
    args.loaded.input.tenantMaterials[0].properties = { wattage: '6W' }
    expectReview(await buildRank1Estimation(args))
  })

  it('holds unknown evidence for an explicit requested specification', async () => {
    const args = fixture()
    ;(args.intake.scope as { specs: unknown }).specs = { supplied_by: 'tradie', requested_specs: { wattage: '9W' } }
    expectReview(await buildRank1Estimation(args))
  })

  it('checks only the confirmed customer offer after removing unselected tiers', async () => {
    const args = fixture()
    ;(args.intake.scope as { specs: unknown }).specs = { supplied_by: 'tradie', requested_specs: { wattage: '9W' } }
    ;(args.intake.scope as Record<string, unknown>).chosen_product = { catalogue_id: 'product-1', tier: 'good' }
    args.loaded.input.tenantMaterials = [
      { ...args.loaded.input.tenantMaterials[0], tier_hint: 'good', properties: { wattage: '9W' } },
      { ...args.loaded.input.tenantMaterials[0], id: 'product-2', tier_hint: 'better', properties: { wattage: '6W' } },
      { ...args.loaded.input.tenantMaterials[0], id: 'product-3', tier_hint: 'best', properties: { wattage: '6W' } },
    ]
    args.loaded.input.chosenProduct = { catalogue_id: 'product-1', category: 'downlight', tier: 'good' }
    const result = await buildRank1Estimation(args)
    expect(result.quoteCore?.status).toBe('priced')
    expect(result.draft.good.line_items[0].catalogue_id).toBe('product-1')
    expect(result.draft.better).toBeNull()
    expect(result.draft.best).toBeNull()
  })
})
