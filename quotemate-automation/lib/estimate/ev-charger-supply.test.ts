import { describe, expect, it } from 'vitest'
import type { DraftWithTiers } from './merge-recipes'
import type { CandidatePrices } from './validate'
import { enforceEvChargerCustomerSupplyFence } from './ev-charger-supply'

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

    expect(result.status).toBe('inspection_required')
    expect(result.draft).toBe(draft)
    expect(result.changed).toBe(false)
    if (result.status === 'inspection_required') {
      expect(result.violation.code).toBe('unanchored_ev_charger_line')
    }
  })

  it('fails closed when an EV-looking line is anchored to a non-EV row', () => {
    const draft = draftWithUnit()
    draft.good!.line_items![0].catalogue_id = OTHER_ID

    const result = enforceEvChargerCustomerSupplyFence(customerInput(draft))

    expect(result.status).toBe('inspection_required')
    if (result.status === 'inspection_required') {
      expect(result.violation.code).toBe('unanchored_ev_charger_line')
    }
  })

  it('fails closed when removing the charger would leave no assembly or labour work', () => {
    const draft = draftWithUnit()
    draft.good!.line_items = [draft.good!.line_items![0], draft.good!.line_items![3]]

    const result = enforceEvChargerCustomerSupplyFence(customerInput(draft))

    expect(result.status).toBe('inspection_required')
    expect(result.draft).toBe(draft)
    if (result.status === 'inspection_required') {
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
})
