import { describe, expect, it } from 'vitest'
import { buildAirconReportHtml } from './report-html'
import { recommendAircon, DEFAULT_AC_RATE_CARD } from './recommend'
import { sizeAircon } from './sizing'
import type { AcPropertyInputs } from './types'

const inputs: AcPropertyInputs = {
  bedrooms: 3,
  bathrooms: 2,
  living_spaces: 1,
  floor_area_m2: 150,
  ceiling_height: 'standard',
  insulation: 'average',
  current_situation: 'replacing',
}

function html(gstRegistered: boolean) {
  return buildAirconReportHtml({
    businessName: 'Tenant Air',
    address: '1 Test St',
    generatedAt: new Date('2026-08-28T00:00:00Z'),
    recommendation: recommendAircon({
      sizing: sizeAircon('subtropical', inputs),
      inputs,
      rateCard: { ...DEFAULT_AC_RATE_CARD, gst_registered: gstRegistered },
    }),
  })
}

describe('aircon report GST copy', () => {
  it('labels every registered price point as inc GST', () => {
    const report = html(true)
    expect(report).toContain('Your options (inc GST, indicative)')
    expect(report).toContain('inc GST (indicative)')
    expect(report).toContain('Prices shown include 10% GST')
  })

  it('labels every unregistered price point as no GST charged', () => {
    const report = html(false)
    expect(report).toContain('Your options (no GST charged, indicative)')
    expect(report).toContain('no GST charged (indicative)')
    expect(report).toContain('No GST is charged')
    expect(report).not.toContain('inc GST')
    expect(report).not.toContain('include 10% GST')
  })
})
