import { describe, it, expect } from 'vitest'
import { pricePaintTakeoff } from './price'
import { resolvePaintRates, heightMultiplier } from './rates'
import type { PaintRateRow, PaintTakeoffItem } from './types'

// Mirror of the migration-107 seed (the values the pilot prices against).
const SEED_ROWS: PaintRateRow[] = [
  { kind: 'labour', code: 'labour:spray_matt:spray', label: 'Exposed ceiling spray', system: 'spray_matt', method: 'spray', coverage_m2_per_hr: 25 },
  { kind: 'labour', code: 'labour:flat:spray', label: 'Suspension ceiling spray', system: 'flat', method: 'spray', coverage_m2_per_hr: 28 },
  { kind: 'labour', code: 'labour:low_sheen:roller', label: 'Walls low-sheen roller', system: 'low_sheen', method: 'roller', coverage_m2_per_hr: 10 },
  { kind: 'labour', code: 'labour:semi_gloss:roller', label: 'Wet-area semi-gloss roller', system: 'semi_gloss', method: 'roller', coverage_m2_per_hr: 9 },
  { kind: 'labour', code: 'labour:door:per_item', label: 'Door + frame', system: 'semi_gloss', method: 'per_item', unit_hours: 0.75 },
  { kind: 'material', code: 'mat:ceiling_spray_matt', label: 'Spray matt', system: 'spray_matt', product: 'Spray-grade ceiling matt (white)', spread_m2_per_l: 12, price_per_l_ex_gst: 10 },
  { kind: 'material', code: 'mat:ceiling_flat', label: 'Flat', system: 'flat', product: 'Flat ceiling acrylic (white)', spread_m2_per_l: 14, price_per_l_ex_gst: 9.5 },
  { kind: 'material', code: 'mat:wall_low_sheen', label: 'Low sheen', system: 'low_sheen', product: 'Low-sheen acrylic interior', spread_m2_per_l: 15, price_per_l_ex_gst: 11 },
  { kind: 'material', code: 'mat:wet_semi_gloss', label: 'Semi gloss', system: 'semi_gloss', product: 'Premium semi-gloss acrylic', spread_m2_per_l: 15, price_per_l_ex_gst: 14 },
  { kind: 'material', code: 'mat:enamel_trim', label: 'Enamel', system: 'semi_gloss', product: 'Water-based enamel', spread_m2_per_l: 14, price_per_l_ex_gst: 16 },
  { kind: 'modifier', code: 'mod:height_low', label: 'h low', value: 1.0 },
  { kind: 'modifier', code: 'mod:height_mid', label: 'h mid', value: 1.25 },
  { kind: 'modifier', code: 'mod:height_high', label: 'h high', value: 1.4 },
  { kind: 'modifier', code: 'mod:prep_pct', label: 'prep', value: 0.1 },
  { kind: 'modifier', code: 'mod:sundries_pct', label: 'sundries', value: 0.08 },
  { kind: 'modifier', code: 'mod:labour_rate', label: 'rate', value: 75 },
  { kind: 'modifier', code: 'mod:crew_hours_per_day', label: 'crew hrs', value: 7.6 },
  { kind: 'modifier', code: 'mod:default_crew_size', label: 'crew', value: 3 },
  { kind: 'equipment', code: 'equip:scissor_lift', label: 'Scissor lift hire (19 ft electric)', value: 300 },
]

const book = resolvePaintRates(SEED_ROWS)

function item(over: Partial<PaintTakeoffItem>): PaintTakeoffItem {
  return {
    surface: 'Test surface',
    room: 'Retail',
    substrate: 'plasterboard',
    system: 'low_sheen',
    unit: 'm2',
    quantity: 100,
    coats: 2,
    confidence: 'high',
    source: 'plan',
    ...over,
  }
}

describe('resolvePaintRates', () => {
  it('builds labour lookups keyed system:method', () => {
    expect(book.labour['spray_matt:spray'].coverage).toBe(25)
    expect(book.labour['low_sheen:roller'].coverage).toBe(10)
    expect(book.perItem?.unitHours).toBe(0.75)
  })

  it('maps default products per system and enamel for per-item lines', () => {
    expect(book.materials['low_sheen'].product).toBe('Low-sheen acrylic interior')
    expect(book.perItemMaterial?.product).toBe('Water-based enamel')
  })

  it('tenant rows override shared defaults by code', () => {
    const withOverride = resolvePaintRates([
      ...SEED_ROWS,
      { kind: 'modifier', code: 'mod:labour_rate', label: 'tenant rate', value: 95, tenant_id: 'T1', is_default: false },
    ])
    expect(withOverride.modifiers.labourRatePerHr).toBe(95)
  })

  it('flags seeded defaults so quotes can disclose unvalidated rates', () => {
    expect(book.usesSeedDefaults).toBe(true)
    const validated = resolvePaintRates(
      SEED_ROWS.map((r) => ({ ...r, is_default: false })),
    )
    expect(validated.usesSeedDefaults).toBe(false)
  })

  it('height bands: ≤3.4 ×1.0, 3.4–5 ×1.25, >5 ×1.4 (IGA walls 5.2 m)', () => {
    expect(heightMultiplier(book, undefined)).toBe(1.0)
    expect(heightMultiplier(book, 3.4)).toBe(1.0)
    expect(heightMultiplier(book, 4.2)).toBe(1.25)
    expect(heightMultiplier(book, 5.2)).toBe(1.4)
  })
})

describe('pricePaintTakeoff — coverage math', () => {
  it('labour hours = qty ÷ coverage × coats × height × (1 + prep)', () => {
    // 100 m² ÷ 10 m²/h × 2 coats × 1.0 × 1.1 = 22h → $1,650
    const bom = pricePaintTakeoff([item({})], book)
    expect(bom.lines[0].labourHours).toBe(22)
    expect(bom.lines[0].labourExGst).toBe(1650)
    expect(bom.lines[0].trace.labourFormula).toContain('100 m² ÷ 10 m²/h')
    expect(bom.lines[0].trace.labourFormula).toContain('$1650.00')
  })

  it('5.2 m walls apply the ×1.4 high band (the IGA case)', () => {
    // 100 ÷ 10 × 2 × 1.4 × 1.1 = 30.8h
    const bom = pricePaintTakeoff([item({ height_m: 5.2 })], book)
    expect(bom.lines[0].labourHours).toBe(30.8)
    expect(bom.lines[0].trace.heightMultiplier).toBe(1.4)
  })

  it('material litres = qty × coats ÷ spread, costed per whole litre + sundries', () => {
    // 100 × 2 ÷ 15 = 13.33 L → ceil 14 L × $11 × 1.08 = $166.32
    const bom = pricePaintTakeoff([item({})], book)
    expect(bom.lines[0].litres).toBeCloseTo(13.33, 2)
    expect(bom.materials).toHaveLength(1)
    expect(bom.materials[0].litres).toBe(14)
    expect(bom.materials[0].costExGst).toBeCloseTo(166.32, 2)
  })

  it('litres aggregate per product BEFORE rounding up', () => {
    // Two low-sheen walls: 50×2/15=6.67 + 40×2/15=5.33 → 12.0 → 12 L (not 7+6=13)
    const bom = pricePaintTakeoff(
      [item({ quantity: 50 }), item({ quantity: 40, surface: 'Other wall' })],
      book,
    )
    expect(bom.materials[0].litres).toBe(12)
  })

  it('per-item doors: hours/unit/coat with enamel material', () => {
    // 1 door × 0.75h × 2 coats × 1.0 × 1.1 = 1.65h → $123.75
    const bom = pricePaintTakeoff(
      [item({ unit: 'item', quantity: 1, system: 'semi_gloss', surface: 'Timber door' })],
      book,
    )
    expect(bom.lines[0].labourHours).toBe(1.65)
    expect(bom.lines[0].product).toBe('Water-based enamel')
    expect(bom.lines[0].trace.method).toBe('per_item')
  })
})

describe('pricePaintTakeoff — roll-ups and triggers', () => {
  it('crew/days: days = ceil(hours ÷ (crew × hrs/day))', () => {
    // 480 m² spray_matt at 5.2 m: 480÷25 × 2 coats × 1.4 height × 1.1 prep = 59.14h
    // days = ceil(59.14 / (3 × 7.6)) = ceil(2.59) = 3
    const bom = pricePaintTakeoff(
      [item({ system: 'spray_matt', quantity: 480, height_m: 5.2, surface: 'Retail ceiling' })],
      book,
    )
    expect(bom.labour.hours).toBeCloseTo(59.14, 2)
    expect(bom.labour.crewSize).toBe(3)
    expect(bom.labour.estimatedDays).toBe(3)
  })

  it('equipment: surfaces above 3.4 m trigger a scissor-lift line with day count', () => {
    const bom = pricePaintTakeoff(
      [
        item({ system: 'spray_matt', quantity: 420, height_m: 5.2, surface: 'Retail ceiling' }),
        item({ quantity: 80, surface: 'Low wall' }), // no trigger
      ],
      book,
    )
    expect(bom.equipment).toHaveLength(1)
    expect(bom.equipment[0].code).toBe('equip:scissor_lift')
    expect(bom.equipment[0].dayRate).toBe(300)
    expect(bom.equipment[0].days).toBeGreaterThanOrEqual(1)
    expect(bom.equipment[0].costExGst).toBe(bom.equipment[0].days * 300)
  })

  it('no surfaces above 3.4 m → no equipment lines', () => {
    const bom = pricePaintTakeoff([item({})], book)
    expect(bom.equipment).toHaveLength(0)
  })

  it('separate_price lines total independently and stay out of the main subtotal', () => {
    const bom = pricePaintTakeoff(
      [item({}), item({ separate_price: true, surface: 'Fridge window wall', quantity: 20 })],
      book,
    )
    expect(bom.separate.lines).toHaveLength(1)
    expect(bom.separate.exGst).toBeGreaterThan(0)
    // Main subtotal = labour + materials of the 100 m² line only.
    const mainOnly = pricePaintTakeoff([item({})], book)
    expect(bom.labour.costExGst).toBe(mainOnly.labour.costExGst)
  })

  it('GST: 10% when registered, zero when not', () => {
    const reg = pricePaintTakeoff([item({})], book)
    expect(reg.gst).toBeCloseTo(reg.subtotalExGst * 0.1, 2)
    expect(reg.totalIncGst).toBeCloseTo(reg.subtotalExGst + reg.gst, 2)
    const unreg = pricePaintTakeoff([item({})], book, { gstRegistered: false })
    expect(unreg.gst).toBe(0)
    expect(unreg.totalIncGst).toBe(unreg.subtotalExGst)
  })
})

describe('pricePaintTakeoff — discipline', () => {
  it('unknown system → unmatched, never guessed', () => {
    const bom = pricePaintTakeoff(
      [item({ system: 'textured' as never, surface: 'Mystery wall' })],
      book,
    )
    expect(bom.lines).toHaveLength(0)
    expect(bom.unmatched).toHaveLength(1)
    expect(bom.unmatched[0].surface).toBe('Mystery wall')
    expect(bom.subtotalExGst).toBe(0)
  })

  it('missing rate book entries → unmatched (no fallback pricing)', () => {
    const thin = resolvePaintRates(SEED_ROWS.filter((r) => r.code !== 'labour:semi_gloss:roller'))
    const bom = pricePaintTakeoff([item({ system: 'semi_gloss' })], thin)
    expect(bom.unmatched).toHaveLength(1)
  })

  it('excluded lines are skipped and surfaced in exclusions', () => {
    const bom = pricePaintTakeoff(
      [item({}), item({ excluded: true, surface: 'Tiled splashback', quantity: 12 })],
      book,
    )
    expect(bom.lines).toHaveLength(1)
    expect(bom.excluded).toHaveLength(1)
    expect(bom.exclusions.some((e) => e.includes('Tiled splashback'))).toBe(true)
  })

  it('zero/negative quantities are unpriceable, not NaN', () => {
    const bom = pricePaintTakeoff([item({ quantity: 0 })], book)
    expect(bom.lines).toHaveLength(0)
    expect(bom.unmatched).toHaveLength(1)
    expect(JSON.stringify(bom)).not.toContain('NaN')
  })

  it('assumptions disclose seeded rates, prep, sundries and height bands', () => {
    const bom = pricePaintTakeoff([item({ height_m: 5.2 })], book)
    expect(bom.assumptions.some((a) => a.includes('seeded AU commercial defaults'))).toBe(true)
    expect(bom.assumptions.some((a) => a.includes('prep'))).toBe(true)
    expect(bom.assumptions.some((a) => a.includes('×1.4'))).toBe(true)
  })

  it('standing exclusions always present (tiles, colours TBC)', () => {
    const bom = pricePaintTakeoff([item({})], book)
    expect(bom.exclusions.some((e) => e.toLowerCase().includes('tiled'))).toBe(true)
    expect(bom.exclusions.some((e) => e.toLowerCase().includes('colours tbc'))).toBe(true)
  })
})
