import { describe, expect, it } from 'vitest'
import { buildEvChargerEstimateHtml, deriveEvInclusions, type EvChargerEstimateInput } from './report-html-ev-charger'
import { evIncidentTier, evIncidentScope, evIncidentAssumptions, evIncidentUpsells } from '../../tests/fixtures/ev-charger-est0018'

const input = (): EvChargerEstimateInput => ({
  businessName: 'Test Electrical', estimateRef: 'EST-0018', generatedAt: new Date('2026-09-14T19:41:58Z'),
  scopeOfWorks: evIncidentScope, descriptionOfWorks: [evIncidentScope], assumptions: evIncidentAssumptions,
  good: null, better: structuredClone(evIncidentTier), best: null, selectedTier: 'better',
  suppliedBy: 'tradie', chargerUnitIds: [], optionalUpsells: evIncidentUpsells,
})

describe('EV supply document regression', () => {
  it('uses authenticated manual-unit evidence consistently in the scope and exclusions', () => {
    const fixture = input()
    fixture.scopeOfWorks = 'Install an EV charger. Charger unit excluded from the estimate.'
    fixture.better = { label: 'EV installation', subtotal_ex_gst: 1000, line_items: [
      { description: 'EV charger unit', source: 'tradie_manual', quantity: 1, unit: 'each', unit_price_ex_gst: 1000, total_ex_gst: 1000 },
    ] }
    fixture.authorizedManualChargerLineIndexes = { better: [0] }
    const html = buildEvChargerEstimateHtml(fixture)
    expect(html.includes('This option includes the charger unit')).toBe(true)
    expect(html.includes('Charger unit excluded from the estimate')).toBe(false)
    expect(html.includes('Charger unit supply and its cost')).toBe(false)
    expect(html.includes('$1,100.00')).toBe(true)
  })
  it('keeps the incident arithmetic while correcting scope and removing duplicate extras', () => {
    const fixture = input()
    const before = structuredClone(fixture)
    const html = buildEvChargerEstimateHtml(fixture)
    expect(html.includes('Supply and install a 7kW')).toBe(false)
    expect(html.includes('Charger unit supply and its cost')).toBe(true)
    expect(html.includes('complete supply-and-install total is pending')).toBe(true)
    expect(html.includes('$881.10')).toBe(true)
    const optional = html.slice(html.indexOf('Optional Upgrades &amp; Recommendations'), html.indexOf('<section class="part ev-phase"'))
    expect(optional.includes('Add RCBO safety switch')).toBe(false)
    expect(optional.includes('Switchboard health check')).toBe(false)
    expect(fixture).toEqual(before)
    expect(buildEvChargerEstimateHtml(fixture)).toBe(html)
  })

  it('does not claim the Good option supplies a charger just because Better does', () => {
    const fixture = input()
    fixture.good = structuredClone(evIncidentTier)
    fixture.better = {
      label: 'Charger supplied', subtotal_ex_gst: 1801,
      line_items: [...evIncidentTier.line_items, {
        description: 'EV charger unit', source: 'material:charger-id', quantity: 1, unit: 'each',
        unit_price_ex_gst: 1000, total_ex_gst: 1000,
      }],
    }
    fixture.chargerUnitIds = ['charger-id']
    const html = buildEvChargerEstimateHtml(fixture)
    expect(html.includes('Installation estimate (charger unit excluded)')).toBe(true)
    expect(html.includes('Supply and installation estimate')).toBe(true)
    expect(html.includes('$1,981.10')).toBe(true)
    expect(html.includes('You have requested that we supply the charger.')).toBe(true)
    fixture.selectedTier = 'good'
    expect(deriveEvInclusions(fixture)).not.toContain('EV charger unit')
    fixture.selectedTier = 'better'
    expect(deriveEvInclusions(fixture)).toContain('EV charger unit')
  })
})
