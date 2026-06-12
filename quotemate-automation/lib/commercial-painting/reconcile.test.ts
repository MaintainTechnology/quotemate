import { describe, it, expect } from 'vitest'
import { reconcileTakeoff, DELTA_FLAG_PCT, __test_only__ } from './reconcile'
import type { MeasurementLine, PaintTakeoffItem } from './types'

function ai(over: Partial<PaintTakeoffItem>): PaintTakeoffItem {
  return {
    surface: 'Retail concrete ceiling',
    room: 'Retail',
    substrate: 'concrete',
    system: 'spray_matt',
    unit: 'm2',
    quantity: 400,
    coats: 2,
    confidence: 'medium',
    source: 'plan',
    note: 'plan page 7',
    ...over,
  }
}

function m(over: Partial<MeasurementLine>): MeasurementLine {
  return {
    line_no: 1,
    surface: 'Retail concrete ceiling',
    room: 'Retail',
    unit: 'm2',
    quantity: 420,
    ...over,
  }
}

describe('reconcileTakeoff — matching', () => {
  it('matches by normalised surface/room text and marks source both', () => {
    const r = reconcileTakeoff([ai({})], [m({})])
    expect(r.items).toHaveLength(1)
    expect(r.items[0].source).toBe('both')
  })

  it('matched lines prefill the measured quantity and preserve the plan figure in delta/note', () => {
    const r = reconcileTakeoff([ai({ quantity: 400 })], [m({ quantity: 420 })])
    const item = r.items[0]
    expect(item.quantity).toBe(420)
    expect(item.delta_pct).toBeCloseTo(-4.8, 1) // (400-420)/420
    expect(item.note).toContain('plan read 400 m²')
    expect(item.note).toContain('measured 420 m²')
  })

  it('delta within 10% → high confidence, no flag', () => {
    const r = reconcileTakeoff([ai({ quantity: 400 })], [m({ quantity: 420 })])
    expect(r.items[0].confidence).toBe('high')
    expect(r.flags.filter((f) => f.kind === 'delta')).toHaveLength(0)
  })

  it(`delta beyond ${DELTA_FLAG_PCT}% → medium confidence + delta flag with both figures`, () => {
    const r = reconcileTakeoff([ai({ quantity: 300 })], [m({ quantity: 420 })])
    expect(r.items[0].confidence).toBe('medium')
    const flag = r.flags.find((f) => f.kind === 'delta')!
    expect(flag.detail).toContain('300')
    expect(flag.detail).toContain('420')
    expect(flag.detail).toContain('%')
  })

  it('BOH abbreviation matches back-of-house wording', () => {
    const r = reconcileTakeoff(
      [ai({ surface: 'Back of house walls', room: 'Back of house', system: 'low_sheen', quantity: 90 })],
      [m({ surface: 'BOH walls', room: 'BOH', quantity: 88.5 })],
    )
    expect(r.items[0].source).toBe('both')
    expect(r.items[0].quantity).toBe(88.5)
  })

  it('measurement-doc paint system overrides the AI call and notes it', () => {
    const r = reconcileTakeoff(
      [ai({ surface: 'Kitchen walls', room: 'Kitchen', system: 'low_sheen', quantity: 60 })],
      [m({ surface: 'Kitchen walls', room: 'Kitchen', quantity: 62, system: 'semi_gloss' })],
    )
    expect(r.items[0].system).toBe('semi_gloss')
    expect(r.items[0].note).toContain('system per measurements: semi_gloss')
  })

  it('does not cross-match different rooms with similar surfaces', () => {
    const r = reconcileTakeoff(
      [
        ai({ surface: 'Walls', room: 'Kitchen', quantity: 60 }),
        ai({ surface: 'Walls', room: 'Office', quantity: 45 }),
      ],
      [m({ surface: 'Walls', room: 'Office', quantity: 44 })],
    )
    const both = r.items.filter((i) => i.source === 'both')
    expect(both).toHaveLength(1)
    expect(both[0].room).toBe('Office')
    expect(both[0].quantity).toBe(44)
  })
})

describe('reconcileTakeoff — nothing silently dropped', () => {
  it('measurements-only lines come in with high confidence + flag (the timber door case)', () => {
    const r = reconcileTakeoff(
      [ai({})],
      [m({}), m({ line_no: 34, surface: 'Timber door', room: 'BOH', unit: 'item', quantity: 1 })],
    )
    const door = r.items.find((i) => i.surface === 'Timber door')!
    expect(door.source).toBe('measurements')
    expect(door.confidence).toBe('high')
    expect(door.unit).toBe('item')
    expect(door.note).toContain('line 34')
    expect(r.flags.some((f) => f.kind === 'measurements_only' && f.surface === 'Timber door')).toBe(true)
  })

  it('plan-only lines are kept and flagged for deliberate-exclusion review', () => {
    const r = reconcileTakeoff(
      [ai({}), ai({ surface: 'Plant room walls', room: 'Plant', system: 'low_sheen', quantity: 30 })],
      [m({})],
    )
    const plant = r.items.find((i) => i.surface === 'Plant room walls')!
    expect(plant.source).toBe('plan')
    const flag = r.flags.find((f) => f.kind === 'plan_only')!
    expect(flag.surface).toBe('Plant room walls')
    expect(flag.detail.toLowerCase()).toContain('deliberately excluded')
  })

  it('every input line appears exactly once in the output', () => {
    const aiItems = [
      ai({}),
      ai({ surface: 'BOH walls', room: 'BOH', system: 'low_sheen', quantity: 90 }),
      ai({ surface: 'Office ceiling', room: 'Office', system: 'flat', quantity: 55 }),
    ]
    const mLines = [
      m({}),
      m({ line_no: 2, surface: 'BOH walls', room: 'BOH', quantity: 88.5 }),
      m({ line_no: 3, surface: 'Cool room door', room: 'BOH', unit: 'item', quantity: 1 }),
    ]
    const r = reconcileTakeoff(aiItems, mLines)
    // 2 matched + 1 measurements-only + 1 plan-only = 4
    expect(r.items).toHaveLength(4)
    expect(r.items.filter((i) => i.source === 'both')).toHaveLength(2)
    expect(r.items.filter((i) => i.source === 'measurements')).toHaveLength(1)
    expect(r.items.filter((i) => i.source === 'plan')).toHaveLength(1)
  })

  it('no measurements doc → AI items pass through unchanged, zero flags', () => {
    const r = reconcileTakeoff([ai({}), ai({ surface: 'BOH walls', room: 'BOH', quantity: 90 })], [])
    expect(r.items).toHaveLength(2)
    expect(r.items.every((i) => i.source === 'plan')).toBe(true)
    expect(r.flags).toHaveLength(0)
  })
})

describe('reconcile helpers', () => {
  it('tokens normalise abbreviations and plurals', () => {
    const t = __test_only__.tokens('BOH Walls (south)')
    expect(t.has('boh')).toBe(true)
    expect(t.has('wall')).toBe(true)
    expect(t.has('house')).toBe(true)
  })

  it('signedDeltaPct is signed and one-decimal', () => {
    expect(__test_only__.signedDeltaPct(420, 400)).toBe(5)
    expect(__test_only__.signedDeltaPct(380, 400)).toBe(-5)
    expect(__test_only__.signedDeltaPct(100, 0)).toBe(0)
  })
})
