import { describe, expect, it } from 'vitest'
import {
  deriveEvSupplyOnlyDisplayTier,
  deriveEvSupplyPresentation,
  reconcileEvSupplyAssumptions,
  reconcileEvSupplyExclusions,
  reconcileEvSupplyScope,
  resolveAuthorizedEvManualChargerLineIndexes,
} from './ev-supply-presentation'

const charger = { id: 'charger-1', category: 'ev_charger' }
const unit = { source: 'material:charger-1', quantity: 1, unit_price_ex_gst: 800, total_ex_gst: 800 }
const installation = { description: 'EV charger supply & install assembly', source: 'assembly:install-ev', quantity: 1, unit_price_ex_gst: 156 }
const input = { jobType: 'ev_charger', suppliedBy: 'tradie', chargerCatalogueRows: [charger] }

describe('one deterministic EV supply interpretation', () => {
  it('does not mistake EST-0018 installation/assessment charges for a supplied unit', () => {
    const tier = { line_items: [installation,
      { source: 'labour', quantity: 3, unit_price_ex_gst: 150 },
      { source: 'labour', quantity: 1, unit_price_ex_gst: 150 },
      { source: 'risk_buffer', quantity: 0.3, unit_price_ex_gst: 150 },
    ] }
    const result = deriveEvSupplyPresentation({ ...input, chargerCatalogueRows: [], tier })!
    expect(result.state).toBe('tradie_supply_pending')
    expect(result.unitLineIndexes).toEqual([])
    expect(result.priceLabel).toContain('charger unit excluded')
    expect(result.supplyNotice).toContain('You have requested that we supply')
    expect(result.supplyNotice).toContain('complete supply-and-install total is pending')
    expect(result.exclusions.join(' ')).toContain('Charger unit supply and its cost')
  })

  it('decides independently for each option, with catalogue identity rather than a product name', () => {
    expect(deriveEvSupplyPresentation({ ...input, tier: { line_items: [installation] } })?.state)
      .toBe('tradie_supply_pending')
    const included = deriveEvSupplyPresentation({ ...input, tier: { line_items: [installation, { ...unit, description: 'Model A' }] } })!
    expect(included.state).toBe('tradie_supply_included')
    expect(included.unitLineIndexes).toEqual([1])
    expect(included.unitExcluded).toBe(false)
  })

  it('preserves customer supply responsibility and keeps an unresolved supplier honest', () => {
    const tier = { line_items: [installation] }
    expect(deriveEvSupplyPresentation({ ...input, suppliedBy: 'customer', tier })?.state).toBe('customer_supplied')
    expect(deriveEvSupplyPresentation({ ...input, suppliedBy: null, tier })?.state).toBe('supply_unresolved')
    // A product line alone does not establish who agreed to supply it.
    expect(deriveEvSupplyPresentation({ ...input, suppliedBy: 'unknown', tier: { line_items: [unit] } })?.state).toBe('supply_unresolved')
  })

  it.each([
    { ...unit, source: 'material:unrelated', catalogue_id: 'charger-1' },
    { ...unit, source: 'material:charger-1 malformed' },
    { ...unit, source: 'assembly:charger-1', catalogue_id: 'charger-1' },
    { ...unit, source: 'labour', catalogue_id: 'charger-1' },
    { ...unit, source: 'tradie_manual', catalogue_id: 'charger-1' },
    { ...unit, unit_price_ex_gst: '800oops' },
    { ...unit, unit_price_ex_gst: '' },
    { ...unit, unit_price_ex_gst: -800 },
    { ...unit, unit_price_ex_gst: Number.POSITIVE_INFINITY },
    { ...unit, quantity: 0 },
    { ...unit, quantity: null },
    { ...unit, total_ex_gst: 0 },
    { ...unit, source: 'material:unrelated', description: 'Supply a Tesla EV wall charger' },
  ])('does not claim a charger is priced from malformed or contradictory evidence: %j', (line) => {
    expect(deriveEvSupplyPresentation({ ...input, tier: { line_items: [line] } })?.state).toBe('tradie_supply_pending')
  })

  it('requires the matching catalogue row to be an active charger category', () => {
    for (const row of [{ ...charger, category: 'gpo' }, { ...charger, active: false }]) {
      expect(deriveEvSupplyPresentation({ ...input, chargerCatalogueRows: [row], tier: { line_items: [unit] } })?.state)
        .toBe('tradie_supply_pending')
    }
  })

  it('accepts an explicitly authorised, positively priced manual unit', () => {
    const tier = { line_items: [{ source: 'tradie_manual', description: 'Charger unit', quantity: 1, unit_price_ex_gst: 0 }] }
    expect(deriveEvSupplyPresentation({ ...input, tier })?.state).toBe('tradie_supply_pending')
    expect(deriveEvSupplyPresentation({ ...input, tier, authorizedManualChargerLineIndexes: [0] })?.state)
      .toBe('tradie_supply_pending')
  })

  it('does not alter non-EV presentation', () => {
    expect(deriveEvSupplyPresentation({ ...input, jobType: 'downlights', tier: { line_items: [unit] } })).toBeNull()
  })
})

describe('EV scope, assumptions and exclusions agree with the selected amount', () => {
  const pending = deriveEvSupplyPresentation({ ...input, tier: { line_items: [installation] } })!
  it('retains the requested installation details while replacing the unpriced supply promise', () => {
    const scope = 'Supply and install an EV charger at the covered carport, approximately 6.5 m from the switchboard. Test the new circuit and make good penetrations.'
    const result = reconcileEvSupplyScope(scope, pending)
    expect(result).not.toMatch(/supply and install an EV charger/i)
    expect(result).toContain('covered carport, approximately 6.5 m')
    expect(result).toContain('Test the new circuit and make good penetrations')
    expect(result).toContain('excluding the charger unit')
    expect(reconcileEvSupplyScope(result, pending)).toBe(result)
  })

  it('replaces stale supply assumptions and retains unrelated capacity and access assumptions', () => {
    const assumptions = [
      'Charger unit supplied separately — model and price confirmed before booking.',
      'Customer supplies the charger. The switchboard capacity must be verified on site.',
      'Cable route is 6.5 m and accessible.',
      'Charger supply is excluded; cable route is 6.5 m and capacity is unverified.',
      'RCBO included in the charger installation assembly.',
      'Installation includes mounting the charger and testing the circuit.',
    ]
    const result = reconcileEvSupplyAssumptions(assumptions, pending)
    expect(result.join(' ')).not.toContain('Customer supplies')
    expect(result).toContain('The switchboard capacity must be verified on site.')
    expect(result).toContain('Cable route is 6.5 m and accessible.')
    expect(result).toContain('cable route is 6.5 m and capacity is unverified.')
    expect(result).toContain('RCBO included in the charger installation assembly.')
    expect(result).toContain('Installation includes mounting the charger and testing the circuit.')
    expect(result.filter((value) => value.includes('You have requested that we supply'))).toHaveLength(1)
    expect(reconcileEvSupplyAssumptions(result, pending)).toEqual(result)
  })

  it('preserves customer-owned charger specifications when presentation is installation-only', () => {
    const customer = deriveEvSupplyPresentation({ ...input, suppliedBy: 'customer', tier: { line_items: [installation] } })!
    const scope = 'Install the customer-owned 7kW EV charger in the garage.'
    expect(reconcileEvSupplyScope(scope, customer)).toContain(scope)
  })

  it('removes an installation-assembly charger exclusion only in an option that prices the unit', () => {
    const included = deriveEvSupplyPresentation({ ...input, tier: { line_items: [unit, installation] } })!
    expect(reconcileEvSupplyExclusions(['Charger unit supply excluded.', 'Trenching and asbestos removal.'], included))
      .toEqual(['Trenching and asbestos removal.'])
    expect(reconcileEvSupplyExclusions(['Trenching and asbestos removal.'], pending)).toEqual([
      'Trenching and asbestos removal.', ...pending.exclusions,
    ])
  })

  it('changes selected options without retaining the previous option supply notice', () => {
    const included = deriveEvSupplyPresentation({ ...input, tier: { line_items: [unit, installation] } })!
    const withPending = reconcileEvSupplyScope('Install an EV charger in the garage.', pending)
    const withIncluded = reconcileEvSupplyScope(withPending, included)
    expect(withIncluded).not.toContain('excluding the charger unit')
    expect(withIncluded).toContain('includes the charger unit listed')
    expect(withIncluded).toContain('in the garage')
  })

  it('preserves compound exclusion and site-assessment clauses when only charger supply changes', () => {
    const included = deriveEvSupplyPresentation({ ...input, tier: { line_items: [unit, installation] } })!
    expect(reconcileEvSupplyExclusions([
      'Charger unit supply excluded, trenching and asbestos removal excluded.',
    ], included)).toEqual(['trenching and asbestos removal excluded.'])
    const assumptions = reconcileEvSupplyAssumptions([
      'Charger unit is supplied by the customer and switchboard capacity must be verified on site.',
    ], included)
    expect(assumptions).toContain('switchboard capacity must be verified on site.')
    expect(assumptions.join(' ')).not.toContain('supplied by the customer')
  })

  it('removes stale standalone unit exclusions from an option whose current price includes the unit', () => {
    const included = deriveEvSupplyPresentation({ ...input, tier: { line_items: [unit, installation] } })!
    const scope = reconcileEvSupplyScope('Install an EV charger. Charger unit excluded from the estimate.', included)
    expect(scope).toContain('Install an EV charger.')
    expect(scope).not.toContain('excluded')
    expect(scope).toContain('includes the charger unit listed')
    expect(reconcileEvSupplyScope(scope, included)).toBe(scope)
  })
})

describe('authenticated manual charger supply evidence', () => {
  const manualUnit = { source: 'tradie_manual', description: 'Supply Tesla Wall Connector Gen 3', quantity: 1, unit_price_ex_gst: 800 }

  it('accepts an exact same-tier marker for a valid manual unit without changing input', () => {
    const tier = { line_items: [installation, manualUnit] }
    const before = JSON.stringify(tier)
    const indexes = resolveAuthorizedEvManualChargerLineIndexes({
      tierName: 'better', tier, riskFlags: ['tradie_manual_line:better#1'],
    })
    expect(indexes).toEqual([1])
    expect(JSON.stringify(tier)).toBe(before)
    expect(deriveEvSupplyPresentation({ ...input, tier, authorizedManualChargerLineIndexes: indexes })?.state)
      .toBe('tradie_supply_included')
  })

  it.each([
    { riskFlags: [] },
    { riskFlags: ['tradie_manual_line:best#0'] },
    { riskFlags: ['tradie_manual_line:better#1'] },
    { riskFlags: ['prefix tradie_manual_line:better#0'] },
  ])('does not grant authority from missing, other-tier, stale-index or malformed markers: %j', ({ riskFlags }) => {
    expect(resolveAuthorizedEvManualChargerLineIndexes({ tierName: 'better', tier: { line_items: [manualUnit] }, riskFlags })).toEqual([])
  })

  it.each([
    'EV charger installation labour', 'Install EV charger', 'Install customer supplied EV charger',
    'EV charger cable', 'EV charger health check', 'Supply EV charger installation assembly', 'Supply EV charger accessories',
  ])('does not misclassify a human-authored installation or accessory line as the unit: %s', (description) => {
    expect(resolveAuthorizedEvManualChargerLineIndexes({
      tierName: 'better', tier: { line_items: [{ ...manualUnit, description }] }, riskFlags: ['tradie_manual_line:better#0'],
    })).toEqual([])
  })

  it('rejects a tradie-authorised zero supply price even when the marker and unit description agree', () => {
    expect(resolveAuthorizedEvManualChargerLineIndexes({
      tierName: 'good', tier: { line_items: [{ ...manualUnit, unit_price_ex_gst: 0 }] }, riskFlags: ['tradie_manual_line:good#0'],
    })).toEqual([])
  })
})

describe('explicit service mode presentation', () => {
  it('renders a priced supply-only sale without installation or site-work claims', () => {
    const result = deriveEvSupplyPresentation({
      ...input,
      serviceMode: 'supply_only',
      tier: { line_items: [unit] },
    })!
    expect(result.title).toBe('EV charger supply only')
    expect(result.priceLabel).toBe('EV charger supply only')
    expect(result.installationIncluded).toBe(false)
    expect(reconcileEvSupplyScope('Supply and install a charger on a dedicated circuit.', result))
      .toBe(result.supplyNotice)
    expect(reconcileEvSupplyAssumptions(['Switchboard capacity confirmed on site.'], result))
      .toEqual([result.supplyNotice])
    expect(reconcileEvSupplyExclusions(['Switchboard upgrades.'], result).join(' '))
      .toMatch(/installation.*electrical work/i)
    expect(reconcileEvSupplyExclusions(['Switchboard upgrades.'], result).join(' '))
      .not.toMatch(/certif|testing/i)
  })

  it('does not treat a zero-priced charger as supply evidence', () => {
    const result = deriveEvSupplyPresentation({
      ...input,
      serviceMode: 'supply_only',
      tier: { line_items: [{ ...unit, unit_price_ex_gst: 0, total_ex_gst: 0 }] },
    })!
    expect(result.priceLabel).toBe('Supply-only price pending')
    expect(result.unitLineIndexes).toEqual([])
  })
})

describe('supply-only customer tier boundary', () => {
  it('keeps a complete product-only tier without repricing or filtering supplied accessories', () => {
    const tier = {
      label: 'Charger and pedestal', subtotal_ex_gst: 900,
      line_items: [
        { description: 'EV charger unit', source: 'material:charger-1', quantity: 1, unit_price_ex_gst: 800, total_ex_gst: 800 },
        { description: 'EV charger pedestal', source: 'material:pedestal-1', quantity: 1, unit_price_ex_gst: 100, total_ex_gst: 100 },
      ],
    }
    const result = deriveEvSupplyOnlyDisplayTier(tier)
    expect(result.status).toBe('safe')
    expect(result.tier).not.toBe(tier)
    expect(result.tier?.line_items).toEqual(tier.line_items)
    expect(result.tier?.subtotal_ex_gst).toBe(900)
    expect(result.tier?.label).toBe('EV charger supply only')
  })

  it.each([
    { description: 'Install EV charger', source: 'assembly:install-1' },
    { description: 'Licensed electrician labour', source: 'labour' },
    { description: 'Testing and certification', source: 'material:charger-1' },
    { description: 'Dedicated circuit protection', source: 'material:cable-1' },
  ])('holds the complete tier when a priced row is installation work: %j', (line) => {
    expect(deriveEvSupplyOnlyDisplayTier({
      subtotal_ex_gst: 100,
      line_items: [{ ...line, quantity: 1, unit_price_ex_gst: 100, total_ex_gst: 100 }],
    })).toEqual({ status: 'review_required', tier: null, rejectedLineIndexes: [0] })
  })

  it('holds a present tier with no customer-visible breakdown', () => {
    expect(deriveEvSupplyOnlyDisplayTier({ subtotal_ex_gst: 100, line_items: [] }))
      .toEqual({ status: 'review_required', tier: null, rejectedLineIndexes: [] })
  })
})
