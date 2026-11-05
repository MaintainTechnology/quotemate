import { describe, expect, it } from 'vitest'
import { customerVisibleRiskFlags, filterIncludedOptionalUpsells } from './optional-extras'

const extras = [
  { name: 'Add RCBO safety switch', price_ex_gst: 95 },
  { name: 'Switchboard health check', price_ex_gst: 150 },
  { name: 'Per-property compliance certificate', price_ex_gst: 100 },
  { name: 'Extra RCBO for the pool circuit', price_ex_gst: 200 },
]
const install = { description: 'Install EV charger circuit', source: 'assembly:install-real', quantity: 1 }

describe('optional extras reconcile with selected tier', () => {
  it('removes generic RCBO and health check extras already included in EST-0018 better', () => {
    expect(filterIncludedOptionalUpsells(extras, { line_items: [install, { description: 'Switchboard health check and load assessment', quantity: 1 }] }, [{
      id: 'install-real', description: 'Dedicated circuit, three-phase RCBO and certification',
    }])).toEqual(extras.slice(2))
  })

  it('retains an optional upgrade for Good when only Best includes it', () => {
    const good = { line_items: [install] }
    const best = { line_items: [install, { description: 'Switchboard health check and load assessment', quantity: 1 }] }
    expect(filterIncludedOptionalUpsells(extras, good)).toContainEqual(extras[1])
    expect(filterIncludedOptionalUpsells(extras, best)).not.toContainEqual(extras[1])
    expect(filterIncludedOptionalUpsells(extras, good)).toEqual(extras)
  })

  it('uses only the selected tier assembly identities', () => {
    const other = { id: 'unselected-assembly', default_inclusions: ['RCBO safety switch', 'Switchboard health check'] }
    expect(filterIncludedOptionalUpsells(extras, { line_items: [install] }, [other])).toEqual(extras)
  })

  it('does not infer inclusion from exclusions, optional wording or zero quantity', () => {
    expect(filterIncludedOptionalUpsells(extras, { line_items: [install, { description: 'Switchboard health check', quantity: 0 }] }, [{
      id: 'install-real', description: 'RCBO not included; optional switchboard health check',
    }])).toEqual(extras)
  })

  it('recognises actual compliance certificate inclusion but not generic testing/certification', () => {
    expect(filterIncludedOptionalUpsells(extras, { line_items: [install] }, [{
      id: 'install-real', default_inclusions: ['Certificate of electrical compliance'],
    }])).not.toContainEqual(extras[2])
    expect(filterIncludedOptionalUpsells(extras, { line_items: [install] }, [{
      id: 'install-real', default_inclusions: 'Circuit testing and certification',
    }])).toContainEqual(extras[2])
  })

  it('preserves an explicitly different RCBO scope and never mutates inputs', () => {
    const before = JSON.stringify(extras)
    expect(filterIncludedOptionalUpsells(extras, { line_items: [{ description: 'HPM 2-pole RCBO 32A', quantity: 1 }] })).toContainEqual(extras[3])
    expect(JSON.stringify(extras)).toBe(before)
  })

  it('filters exact-name duplicates for other optional extras without broad word matches', () => {
    const options = [{ name: 'Additional parking socket' }, { name: 'Garage lighting' }]
    expect(filterIncludedOptionalUpsells(options, { line_items: [{ description: 'Additional parking socket', quantity: 1 }] })).toEqual([options[1]])
  })
})

describe('customer risk flags', () => {
  it('hides internal diagnostics and keeps customer conditions in both supported shapes', () => {
    expect(customerVisibleRiskFlags([
      '[upsell-guard] ungrounded_lines_stripped: best.Add RCBO safety switch',
      { description: '[grounding] held for review' },
      'intake_inspection_required',
      'tradie_manual_line:better#1',
      '  Switchboard capacity must be verified on site.  ',
      { description: 'Cable route is subject to inspection.' },
      {}, null, 12,
    ])).toEqual(['Switchboard capacity must be verified on site.', 'Cable route is subject to inspection.'])
  })
})
