import { describe, expect, it } from 'vitest'
import type { DraftWithTiers } from './merge-recipes'
import type { CandidatePrices } from './validate'
import {
  enforceEvChargerCustomerSupplyFence,
  ensureChargerSuppliedSeparatelyAssumption,
  findEvInstallationAssemblyMismatches,
  validateEvChargerServiceModeQuote,
} from './ev-charger-supply'

const EV_ID = 'ev-unit-1'
const OTHER_ID = 'gpo-1'

const candidates: CandidatePrices = {
  material: [
    {
      price: 800,
      sourceName: 'Tesla Wall Connector Gen 3',
      sourceId: EV_ID,
      categories: new Set(['ev_charger']),
    },
    {
      price: 40,
      sourceName: 'Double GPO',
      sourceId: OTHER_ID,
      categories: new Set(['gpo']),
    },
  ],
  assembly: [],
}

function draftWithUnit(anchor: 'catalogue' | 'source' = 'catalogue'): DraftWithTiers {
  const unit = {
    description: 'Tesla Wall Connector Gen 3',
    quantity: 1,
    unit: 'each',
    unit_price_ex_gst: 800,
    source: anchor === 'source' ? `material:${EV_ID}` : 'material',
    ...(anchor === 'catalogue' ? { catalogue_id: EV_ID } : {}),
  }
  return {
    good: {
      label: 'Good',
      line_items: [
        unit,
        {
          description: 'Install EV charger assembly',
          quantity: 1,
          unit: 'job',
          unit_price_ex_gst: 300,
          source: 'assembly:install-ev',
        },
        {
          description: 'Labour',
          quantity: 2,
          unit: 'hr',
          unit_price_ex_gst: 100,
          source: 'labour',
        },
        {
          description: 'Cable and fixings',
          quantity: 1,
          unit: 'lot',
          unit_price_ex_gst: 25,
          source: 'sundry',
        },
        {
          description: 'Call-out',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 90,
          source: 'callout',
        },
      ],
      subtotal_ex_gst: 1415,
    },
  }
}

const customerInput = (draft: DraftWithTiers) => ({
  jobType: 'ev_charger',
  chargerSupply: 'customer already has the charger',
  draft,
  candidates,
})

describe('enforceEvChargerCustomerSupplyFence', () => {
  it.each(['catalogue', 'source'] as const)(
    'strips a tenant EV unit anchored by %s id, preserves install work, and recalculates subtotal',
    (anchor) => {
      const draft = draftWithUnit(anchor)
      const result = enforceEvChargerCustomerSupplyFence(customerInput(draft))

      expect(result.status).toBe('stripped')
      expect(result.changed).toBe(true)
      expect(result.draft).not.toBe(draft)
      expect(result.draft.good?.line_items?.map((line) => line.source)).toEqual([
        'assembly:install-ev',
        'labour',
        'sundry',
        'callout',
      ])
      expect(result.draft.good?.subtotal_ex_gst).toBe(615)
      expect(draft.good?.line_items).toHaveLength(5)
      if (result.status === 'stripped') expect(result.removed[0]?.catalogueId).toBe(EV_ID)
    },
  )

  it('uses raw tenant material rows as an authoritative EV category source', () => {
    const draft = draftWithUnit()
    const result = enforceEvChargerCustomerSupplyFence({
      ...customerInput(draft),
      candidates: { material: [], assembly: [] },
      materialRows: [{ id: EV_ID, category: 'ev_charger' }],
    })

    expect(result.status).toBe('stripped')
  })

  it('fails closed on an EV-looking unanchored material line without mutating the draft', () => {
    const draft = draftWithUnit()
    const line = draft.good!.line_items![0]
    delete line.catalogue_id
    line.source = 'material'

    const result = enforceEvChargerCustomerSupplyFence(customerInput(draft))

    expect(result.status).toBe('review_required')
    expect(result.draft).toBe(draft)
    expect(result.changed).toBe(false)
    if (result.status === 'review_required') {
      expect(result.violation.code).toBe('unanchored_ev_charger_line')
    }
  })

  it('fails closed when an EV-looking line is anchored to a non-EV row', () => {
    const draft = draftWithUnit()
    draft.good!.line_items![0].catalogue_id = OTHER_ID

    const result = enforceEvChargerCustomerSupplyFence(customerInput(draft))

    expect(result.status).toBe('review_required')
    if (result.status === 'review_required') {
      expect(result.violation.code).toBe('unanchored_ev_charger_line')
    }
  })

  it('fails closed when removing the charger would leave no assembly or labour work', () => {
    const draft = draftWithUnit()
    draft.good!.line_items = [draft.good!.line_items![0], draft.good!.line_items![3]]

    const result = enforceEvChargerCustomerSupplyFence(customerInput(draft))

    expect(result.status).toBe('review_required')
    expect(result.draft).toBe(draft)
    if (result.status === 'review_required') {
      expect(result.violation.code).toBe('missing_installation_work')
    }
  })

  it('is an exact no-op for tradie-supplied charger drafts', () => {
    const draft = draftWithUnit()
    const result = enforceEvChargerCustomerSupplyFence({
      ...customerInput(draft),
      chargerSupply: 'we supply the charger',
    })

    expect(result).toEqual({ status: 'unchanged', changed: false, draft, removed: [] })
    expect(result.draft).toBe(draft)
  })

  it('is an exact no-op for non-EV jobs', () => {
    const draft = draftWithUnit()
    const result = enforceEvChargerCustomerSupplyFence({
      ...customerInput(draft),
      jobType: 'install_gpo',
    })

    expect(result.status).toBe('unchanged')
    expect(result.draft).toBe(draft)
  })

  it.each([
    {
      needs_inspection: true,
      good: null,
      better: null,
      best: null,
      inspection_reason: 'Three phase requires a site visit',
    },
    { good: null, better: null, best: null },
  ])('is an exact no-op for an existing inspection draft', (draft) => {
    const result = enforceEvChargerCustomerSupplyFence(customerInput(draft))

    expect(result.status).toBe('unchanged')
    expect(result.draft).toBe(draft)
  })

  it('does not remove an already install-only customer-supplied draft', () => {
    const draft = draftWithUnit()
    draft.good!.line_items!.shift()
    draft.good!.subtotal_ex_gst = 615

    const result = enforceEvChargerCustomerSupplyFence(customerInput(draft))

    expect(result.status).toBe('unchanged')
    expect(result.draft).toBe(draft)
  })

  it('fails closed rather than deleting a socket whose enrichment points to a different charger ID', () => {
    const draft = draftWithUnit('source')
    draft.good!.line_items![0] = {
      source: `material:${OTHER_ID}`, catalogue_id: EV_ID, description: 'Socket', quantity: 1, unit_price_ex_gst: 60,
    }
    const before = JSON.stringify(draft)
    const result = enforceEvChargerCustomerSupplyFence(customerInput(draft))
    expect(result.status).toBe('review_required')
    expect(result.removed).toEqual([])
    expect(result.draft).toBe(draft)
    expect(JSON.stringify(draft)).toBe(before)
  })
})

describe('EV supply reconciliation after grounding', () => {
  it('keeps a canonical supply-only quote product-only even when the model drafted install scope', () => {
    const draft = draftWithUnit('source')
    draft.good!.line_items = [draft.good!.line_items![0]]
    draft.good!.subtotal_ex_gst = 800
    draft.scope_of_works = 'Supply and install an EV charger on a new dedicated circuit.'
    const fixed = ensureChargerSuppliedSeparatelyAssumption(draft, {
      jobType: 'ev_charger', serviceMode: 'supply_only', suppliedBy: 'tradie', candidates,
    })
    expect(fixed.scope_short).toBe('EV charger supply only')
    expect(fixed.scope_of_works).toContain('Supply only')
    expect(fixed.scope_of_works).not.toContain('Supply and install')
    expect(fixed.scope_of_works).not.toContain('dedicated circuit')
    expect(fixed.exclusions).toContain('Installation and all electrical work, including connection and circuit work.')
    expect(fixed.good?.line_items).toEqual([draft.good!.line_items![0]])
    expect(fixed.good?.subtotal_ex_gst).toBe(800)
  })

  it('reconciles each tier independently without changing any prices or customer details', () => {
    const supplied = draftWithUnit('source')
    const installOnly = { ...supplied.good!, line_items: supplied.good!.line_items!.slice(1), subtotal_ex_gst: 615 }
    const original = {
      good: installOnly, better: installOnly, best: supplied.good,
      selected_tier: 'better',
      scope_of_works: 'Supply and install a 7kW three-phase EV charger in the covered carport, 6 m from the board. Verify the property three-phase supply on site.',
      assumptions: ['Charger unit model and price confirmed separately.', 'Access to the switchboard is clear.'],
    }
    const before = JSON.stringify(original)
    const fixed = ensureChargerSuppliedSeparatelyAssumption(original, {
      jobType: 'ev_charger', suppliedBy: 'tradie', candidates,
    })
    expect(JSON.stringify(original)).toBe(before)
    expect(fixed.good.line_items).toEqual(installOnly.line_items)
    expect(fixed.good.subtotal_ex_gst).toBe(615)
    expect(fixed.best?.subtotal_ex_gst).toBe(1415)
    expect((fixed as DraftWithTiers).good?.label).toContain('charger unit excluded')
    expect(fixed.best?.label).toContain('Supply and installation')
    expect(fixed.scope_of_works).toContain('covered carport, 6 m from the board')
    expect(fixed.scope_of_works).toContain('property three-phase supply')
    expect(fixed.scope_of_works).not.toContain('7kW')
    expect(fixed.assumptions).toContain('Access to the switchboard is clear.')
    expect(fixed.assumptions.join(' ')).toContain('You have requested that we supply')
  })

  it('uses the actual selected option and removes stale separate-unit caveats from a supplied-unit option', () => {
    const draft = draftWithUnit('source')
    draft.selected_tier = 'good'
    draft.assumptions = ['Charger unit supplied separately. On-site circuit capacity needs verification.']
    draft.exclusions = ['Charger unit supply excluded.', 'Trenching.']
    const fixed = ensureChargerSuppliedSeparatelyAssumption(draft, { jobType: 'ev_charger', suppliedBy: 'tradie', candidates })
    expect(fixed.scope_of_works).toContain('includes the charger unit listed')
    expect(fixed.assumptions).toContain('On-site circuit capacity needs verification.')
    expect(fixed.exclusions).toEqual(['Trenching.'])
  })

  it('labels customer supplied installs without changing their responsibility or values', () => {
    const draft = draftWithUnit()
    const fenced = enforceEvChargerCustomerSupplyFence(customerInput(draft)).draft
    const fixed = ensureChargerSuppliedSeparatelyAssumption(fenced, { jobType: 'ev_charger', suppliedBy: 'customer', candidates })
    expect(fixed.good?.subtotal_ex_gst).toBe(615)
    expect(fixed.scope_of_works).toContain('The customer supplies the charger unit')
    expect(fixed.scope_of_works).not.toContain('You have requested that we supply')
  })

  it('never treats an unanchored EV-sounding material or a unit in another tier as selected supply', () => {
    const draft = draftWithUnit()
    delete draft.good!.line_items![0].catalogue_id
    const fixed = ensureChargerSuppliedSeparatelyAssumption(draft, { jobType: 'ev_charger', suppliedBy: 'tradie', candidates })
    expect(fixed.scope_of_works).toContain('excluding the charger unit')
  })

  it('leaves existing inspection and non-EV drafts untouched', () => {
    const inspection = { needs_inspection: true, good: null, better: null, best: null }
    expect(ensureChargerSuppliedSeparatelyAssumption(inspection, { jobType: 'ev_charger', suppliedBy: 'tradie' })).toBe(inspection)
    const nonEv = draftWithUnit()
    expect(ensureChargerSuppliedSeparatelyAssumption(nonEv, { jobType: 'gpo', suppliedBy: 'tradie' })).toBe(nonEv)
  })
})

describe('EV installation assembly compatibility', () => {
  const assemblies: CandidatePrices = {
    material: [],
    assembly: [
      { sourceId: 'gpo-outlet', sourceName: 'Install 32A three-phase outlet', categories: new Set(['gpo']), price: 156 },
      { sourceId: 'ev-install', sourceName: 'Install EV charger', categories: new Set(['ev_charger']), price: 156 },
    ],
  }
  const gpo = { source: 'assembly:gpo-outlet', description: 'Install 32A three-phase outlet', quantity: 1, unit: 'each', unit_price_ex_gst: 156 }

  it('holds the incident non-EV base even though its catalogue price is real', () => {
    const original = { good: { line_items: [gpo], subtotal_ex_gst: 156 } }
    const result = findEvInstallationAssemblyMismatches(original, { jobType: 'ev_charger', candidates: assemblies })
    expect(result).toHaveLength(1)
    expect(result[0].expected).toContain('EV installation assembly required')
    expect(original.good.subtotal_ex_gst).toBe(156)
  })

  it('allows an EV base with a separate grounded electrical extra', () => {
    expect(findEvInstallationAssemblyMismatches({ good: { line_items: [gpo, { ...gpo, source: 'assembly:ev-install' }] } }, {
      jobType: 'ev_charger', candidates: assemblies,
    })).toEqual([])
  })

  it('does not apply the EV service constraint to outlet jobs', () => {
    expect(findEvInstallationAssemblyMismatches({ good: { line_items: [gpo] } }, {
      jobType: 'gpo', candidates: assemblies,
    })).toEqual([])
  })

  it('holds an unanchored assembly instead of guessing its service from the label or amount', () => {
    expect(findEvInstallationAssemblyMismatches({ good: { line_items: [{ ...gpo, source: 'assembly' }] } }, {
      jobType: 'ev_charger', candidates: assemblies,
    })).toHaveLength(1)
  })

  it.each([0, -1, '0', 'one', null])('does not accept a phantom EV assembly with invalid quantity %s as coverage', (quantity) => {
    expect(findEvInstallationAssemblyMismatches({ good: { line_items: [gpo, {
      ...gpo, source: 'assembly:ev-install', quantity: quantity as number,
    }] } }, { jobType: 'ev_charger', candidates: assemblies })).toHaveLength(1)
  })
})

describe('validateEvChargerServiceModeQuote', () => {
  const matrixCandidates: CandidatePrices = {
    material: [{ sourceId: 'ev-unit', sourceName: 'EV charger unit', price: 800, categories: new Set(['ev_charger']) }],
    assembly: [{ sourceId: 'ev-install', sourceName: 'Install EV charger', price: 400, categories: new Set(['ev_charger']) }],
  }
  const unit = { description: 'EV charger unit', source: 'material:ev-unit', quantity: 1, unit: 'each', unit_price_ex_gst: 800, total_ex_gst: 800 }
  const install = { description: 'Install EV charger', source: 'assembly:ev-install', quantity: 1, unit: 'each', unit_price_ex_gst: 400, total_ex_gst: 400 }
  const labour = { description: 'Licensed electrician labour', source: 'labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 100, total_ex_gst: 200 }
  const quote = (...lines: Array<typeof unit | typeof install | typeof labour>): DraftWithTiers => ({
    good: { line_items: lines, subtotal_ex_gst: lines.reduce((sum, line) => sum + line.total_ex_gst, 0) },
  })
  const validate = (
    mode: 'supply_only' | 'install_only' | 'supply_and_install' | undefined,
    draft: DraftWithTiers,
    chosenProduct: { catalogue_id: string } | null = mode === 'install_only' || !mode
      ? null
      : { catalogue_id: 'ev-unit' },
  ) => validateEvChargerServiceModeQuote({
    jobType: 'ev_charger', serviceMode: mode, draft, candidates: matrixCandidates, chosenProduct,
  })

  it('accepts supply-only only with a grounded priced unit and no install work', () => {
    expect(validate('supply_only', quote(unit))).toMatchObject({ ok: true })
    expect(validate('supply_only', quote(unit, labour))).toMatchObject({
      ok: false, failures: expect.arrayContaining([expect.objectContaining({ code: 'unexpected_installation_work' })]),
    })
    expect(validate('supply_only', quote())).toMatchObject({
      ok: false, failures: expect.arrayContaining([expect.objectContaining({ code: 'missing_priced_tier' })]),
    })
  })

  it('accepts install-only only with grounded installation and no unit', () => {
    expect(validate('install_only', quote(install, labour))).toMatchObject({ ok: true })
    expect(validate('install_only', quote(unit, install, labour))).toMatchObject({
      ok: false, failures: expect.arrayContaining([expect.objectContaining({ code: 'unexpected_charger_unit' })]),
    })
    expect(validate('install_only', quote(labour))).toMatchObject({
      ok: false, failures: expect.arrayContaining([expect.objectContaining({ code: 'missing_grounded_installation' })]),
    })
  })

  it('requires both grounded halves for supply-and-install', () => {
    expect(validate('supply_and_install', quote(unit, install, labour))).toMatchObject({ ok: true })
    expect(validate('supply_and_install', quote(install, labour))).toMatchObject({
      ok: false, failures: expect.arrayContaining([expect.objectContaining({ code: 'missing_grounded_charger_unit' })]),
    })
    expect(validate('supply_and_install', quote(unit))).toMatchObject({
      ok: false, failures: expect.arrayContaining([expect.objectContaining({ code: 'missing_grounded_installation' })]),
    })
  })

  it('fails closed on missing mode, ungrounded or mispriced units, and any bad tier', () => {
    expect(validate(undefined, quote(unit))).toMatchObject({
      ok: false, failures: [expect.objectContaining({ code: 'missing_service_mode' })],
    })
    expect(validate('supply_only', quote({ ...unit, source: 'material:no-such-row' }))).toMatchObject({
      ok: false, failures: expect.arrayContaining([expect.objectContaining({ code: 'ungrounded_charger_unit' })]),
    })
    expect(validate('supply_only', quote({ ...unit, unit_price_ex_gst: 801, total_ex_gst: 801 }))).toMatchObject({
      ok: false, failures: expect.arrayContaining([expect.objectContaining({ code: 'missing_grounded_charger_unit' })]),
    })
    const twoTiers = quote(unit)
    twoTiers.better = { line_items: [unit, install], subtotal_ex_gst: 1200 }
    expect(validate('supply_only', twoTiers)).toMatchObject({
      ok: false, failures: expect.arrayContaining([expect.objectContaining({ code: 'unexpected_installation_work', tier: 'better' })]),
    })

    const emptyVisibleTier = quote(unit)
    emptyVisibleTier.better = { line_items: [], subtotal_ex_gst: 250 }
    expect(validate('supply_only', emptyVisibleTier)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ code: 'empty_present_tier', tier: 'better' }),
      ]),
    })
  })

  it('requires the grounded unit to match the selected product in supply-bearing modes', () => {
    expect(validate('supply_only', quote(unit), null)).toMatchObject({
      ok: false, failures: expect.arrayContaining([expect.objectContaining({ code: 'missing_chosen_product' })]),
    })
    expect(validate('supply_and_install', quote(unit, install), { catalogue_id: 'some-other-unit' })).toMatchObject({
      ok: false, failures: expect.arrayContaining([expect.objectContaining({ code: 'charger_unit_not_selected' })]),
    })
  })

  it('accepts an authenticated tradie-manual unit as explicit supply authority', () => {
    const manual = { ...unit, source: 'tradie_manual', unit_price_ex_gst: 875, total_ex_gst: 875 }
    const result = validateEvChargerServiceModeQuote({
      jobType: 'ev_charger', serviceMode: 'supply_only', draft: {
        good: { line_items: [manual], subtotal_ex_gst: 875 },
      }, candidates: matrixCandidates, riskFlags: ['tradie_manual_line:good#0'], chosenProduct: null,
    })
    expect(result).toMatchObject({ ok: true })
  })
})
