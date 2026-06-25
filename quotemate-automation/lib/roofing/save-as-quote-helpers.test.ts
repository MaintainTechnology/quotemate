import { describe, expect, it } from 'vitest'
import { buildTierObjects, splitAddress } from './save-as-quote-helpers'

describe('splitAddress', () => {
  it('splits on the LAST comma into street + suburb', () => {
    expect(splitAddress('27 Smith Street, Penrith NSW 2750')).toEqual({
      street: '27 Smith Street',
      suburb: 'Penrith NSW 2750',
    })
  })
  it('handles multi-comma addresses by using the last comma', () => {
    expect(splitAddress('Unit 4, 27 Smith St, Penrith NSW')).toEqual({
      street: 'Unit 4, 27 Smith St',
      suburb: 'Penrith NSW',
    })
  })
  it('handles no-comma input by putting everything in street', () => {
    expect(splitAddress('Sydney Opera House')).toEqual({
      street: 'Sydney Opera House',
      suburb: '',
    })
  })
  it('trims whitespace around both halves', () => {
    expect(splitAddress('  27 Smith St ,  Penrith  ')).toEqual({
      street: '27 Smith St',
      suburb: 'Penrith',
    })
  })
})

describe('buildTierObjects', () => {
  const price = {
    area_m2: 220,
    effective_rate_per_m2: 95,
    tiers: [
      { tier: 'good' as const,   label: 'Patch',         ex_gst: 4180,  inc_gst: 4598,  scope: 'Spot patches.' },
      { tier: 'better' as const, label: 'Full re-roof',  ex_gst: 20900, inc_gst: 22990, scope: 'Full re-roof in Colorbond.' },
      { tier: 'best' as const,   label: 'Upgrade',       ex_gst: 25300, inc_gst: 27830, scope: 'Upgrade to Klip-Lok.' },
    ],
  }

  it('returns the three tier objects keyed good/better/best', () => {
    const t = buildTierObjects(price)
    expect(Object.keys(t).sort()).toEqual(['best', 'better', 'good'])
  })

  it('each tier carries a single line item with the scope as description', () => {
    const t = buildTierObjects(price)
    expect(t.better.line_items).toHaveLength(1)
    expect(t.better.line_items[0].description).toBe('Full re-roof in Colorbond.')
    expect(t.better.line_items[0].quantity).toBe(220)
    expect(t.better.line_items[0].total_ex_gst).toBe(20900)
  })

  it('subtotal_ex_gst on the tier object mirrors the tier ex_gst', () => {
    const t = buildTierObjects(price)
    expect(t.good.subtotal_ex_gst).toBe(4180)
    expect(t.better.subtotal_ex_gst).toBe(20900)
    expect(t.best.subtotal_ex_gst).toBe(25300)
  })

  it('rounds quantity to 1 decimal place (the area input is already rounded)', () => {
    const t = buildTierObjects({ ...price, area_m2: 220.6789 })
    expect(t.better.line_items[0].quantity).toBe(220.7)
  })

  it('renders a tier’s itemised line_items (edge works) when present, else falls back', () => {
    const priced = {
      area_m2: 220,
      effective_rate_per_m2: 95,
      tiers: [
        {
          tier: 'good' as const,
          label: 'Patch',
          ex_gst: 4549.6,
          inc_gst: 5004.56,
          scope: 'Spot patches.',
          line_items: [
            { unit: 'sqm', quantity: 220, description: 'Spot patches.', unit_price_ex_gst: 95, total_ex_gst: 4180, source: 'labour' },
            { unit: 'lm', quantity: 30.8, description: 'Repoint ridge and hip caps.', unit_price_ex_gst: 12, total_ex_gst: 369.6, source: 'material' },
          ],
        },
        { tier: 'better' as const, label: 'Re-roof', ex_gst: 20900, inc_gst: 22990, scope: 'Full re-roof.' },
        { tier: 'best' as const, label: 'Upgrade', ex_gst: 25300, inc_gst: 27830, scope: 'Upgrade.' },
      ],
    }
    const t = buildTierObjects(priced)
    // good carries its two itemised lines verbatim
    expect(t.good.line_items).toHaveLength(2)
    expect(t.good.line_items[1].unit).toBe('lm')
    expect(t.good.line_items[1].total_ex_gst).toBe(369.6)
    // better has no line_items → single sqm fallback
    expect(t.better.line_items).toHaveLength(1)
    expect(t.better.line_items[0].unit).toBe('sqm')
  })
})
