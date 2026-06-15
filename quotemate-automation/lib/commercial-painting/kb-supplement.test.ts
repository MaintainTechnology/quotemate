import { describe, expect, it } from 'vitest'
import {
  applyPaintSupplement,
  buildPaintSupplementQuery,
  parsePaintSupplementFindings,
  type PaintSupplementFindings,
} from './kb-supplement'
import type { PaintTakeoffItem } from './types'

function item(overrides: Partial<PaintTakeoffItem> = {}): PaintTakeoffItem {
  return {
    surface: 'Retail ceiling',
    room: 'Retail',
    substrate: 'plasterboard',
    system: 'low_sheen',
    unit: 'm2',
    quantity: 100,
    coats: 2,
    confidence: 'high',
    source: 'plan',
    ...overrides,
  }
}

describe('buildPaintSupplementQuery', () => {
  it('lists the current takeoff and demands strict JSON', () => {
    const q = buildPaintSupplementQuery([item({ surface: 'Wall A', room: 'Office' })], 'fit-out')
    expect(q).toContain('Wall A')
    expect(q).toContain('Office')
    expect(q).toContain('fit-out')
    expect(q).toContain('missing_items')
    expect(q).toContain('corrections')
    expect(q.toLowerCase()).toContain('strict json')
  })

  it('handles an empty takeoff', () => {
    const q = buildPaintSupplementQuery([])
    expect(q).toContain('(none extracted)')
  })
})

describe('parsePaintSupplementFindings', () => {
  it('returns null for non-JSON', () => {
    expect(parsePaintSupplementFindings('not json at all')).toBeNull()
    expect(parsePaintSupplementFindings('')).toBeNull()
    expect(parsePaintSupplementFindings('null')).toBeNull()
  })

  it('strips code fences and parses', () => {
    const txt = '```json\n{"missing_items":[],"corrections":[]}\n```'
    const f = parsePaintSupplementFindings(txt)
    expect(f).toEqual({ missing_items: [], corrections: [] })
  })

  it('keeps valid entries and drops malformed ones', () => {
    const txt = JSON.stringify({
      missing_items: [
        { surface: 'Stair core', room: 'Core', unit: 'm2', quantity: 40, page: 3, confidence: 'medium' },
        { surface: '', room: 'x', unit: 'm2', quantity: 10 }, // no surface -> dropped
        { surface: 'Bad unit', room: 'x', unit: 'feet', quantity: 10 }, // bad unit -> dropped
        { surface: 'Zero', room: 'x', unit: 'item', quantity: 0 }, // non-positive -> dropped
      ],
      corrections: [
        { surface: 'Retail ceiling', room: 'Retail', field: 'quantity', value: 250, page: 2 },
        { surface: 'X', field: 'system', value: 'not_a_system' }, // bad system -> dropped
        { surface: 'Y', field: 'frobnicate', value: 1 }, // bad field -> dropped
      ],
    })
    const f = parsePaintSupplementFindings(txt)!
    expect(f.missing_items).toHaveLength(1)
    expect(f.missing_items[0].surface).toBe('Stair core')
    expect(f.corrections).toHaveLength(1)
    expect(f.corrections[0].value).toBe(250)
  })

  it('coerces a numeric string quantity correction', () => {
    const f = parsePaintSupplementFindings(
      JSON.stringify({ corrections: [{ surface: 'A', field: 'quantity', value: '120' }] }),
    )!
    expect(f.corrections[0].value).toBe(120)
  })
})

describe('applyPaintSupplement — hybrid rules', () => {
  it('returns a cloned, unchanged array for empty findings', () => {
    const items = [item()]
    const res = applyPaintSupplement(items, { missing_items: [], corrections: [] })
    expect(res.items).toEqual(items)
    expect(res.items).not.toBe(items)
    expect(res.flags).toEqual([])
  })

  it('null findings -> no-op clone', () => {
    const items = [item()]
    const res = applyPaintSupplement(items, null)
    expect(res.items).toEqual(items)
    expect(res.flags).toEqual([])
  })

  it('fills a MISSING field even on a confident line', () => {
    const items = [item({ confidence: 'high', height_m: undefined })]
    const findings: PaintSupplementFindings = {
      missing_items: [],
      corrections: [{ surface: 'Retail ceiling', room: 'Retail', field: 'height_m', value: 4.2, page: 5 }],
    }
    const res = applyPaintSupplement(items, findings)
    expect(res.items[0].height_m).toBe(4.2)
    expect(res.flags).toHaveLength(1)
    expect(res.flags[0].kind).toBe('kb_filled')
    expect(res.items[0].note).toContain('kb-filled height_m')
  })

  it('fills a present field when the line is LOW confidence', () => {
    const items = [item({ confidence: 'low', quantity: 100 })]
    const findings: PaintSupplementFindings = {
      missing_items: [],
      corrections: [{ surface: 'Retail ceiling', room: 'Retail', field: 'quantity', value: 250 }],
    }
    const res = applyPaintSupplement(items, findings)
    expect(res.items[0].quantity).toBe(250)
    expect(res.flags[0].kind).toBe('kb_filled')
  })

  it('does NOT overwrite a confident value — flags a conflict instead', () => {
    const items = [item({ confidence: 'high', quantity: 100 })]
    const findings: PaintSupplementFindings = {
      missing_items: [],
      corrections: [{ surface: 'Retail ceiling', room: 'Retail', field: 'quantity', value: 250, page: 7 }],
    }
    const res = applyPaintSupplement(items, findings)
    expect(res.items[0].quantity).toBe(100) // unchanged
    expect(res.flags).toHaveLength(1)
    expect(res.flags[0].kind).toBe('kb_conflict')
    expect(res.flags[0].detail).toContain('100')
    expect(res.flags[0].detail).toContain('250')
  })

  it('no flag when a confident value already agrees', () => {
    const items = [item({ confidence: 'high', quantity: 100 })]
    const res = applyPaintSupplement(items, {
      missing_items: [],
      corrections: [{ surface: 'Retail ceiling', room: 'Retail', field: 'quantity', value: 100 }],
    })
    expect(res.flags).toEqual([])
    expect(res.items[0].quantity).toBe(100)
  })

  it('appends a missing item and flags kb_added', () => {
    const items = [item({ system: 'spray_matt' })]
    const findings: PaintSupplementFindings = {
      missing_items: [
        { surface: 'Loading dock soffit', room: 'BOH', unit: 'm2', quantity: 60, page: 9, confidence: 'medium' },
      ],
      corrections: [],
    }
    const res = applyPaintSupplement(items, findings)
    expect(res.items).toHaveLength(2)
    const added = res.items[1]
    expect(added.surface).toBe('Loading dock soffit')
    expect(added.source).toBe('measurements')
    expect(added.coats).toBe(2)
    expect(added.system).toBe('spray_matt') // fell back to modal system of the takeoff
    expect(added.note).toContain('kb-added')
    expect(res.flags[0].kind).toBe('kb_added')
  })

  it('does not double-add a missing item that already exists', () => {
    const items = [item({ surface: 'Stair core', room: 'Core' })]
    const res = applyPaintSupplement(items, {
      missing_items: [{ surface: 'Stair core', room: 'Core', unit: 'm2', quantity: 40 }],
      corrections: [],
    })
    expect(res.items).toHaveLength(1)
    expect(res.flags).toEqual([])
  })

  it('never mutates the input items', () => {
    const items = [item({ confidence: 'low', quantity: 100 })]
    const snapshot = JSON.parse(JSON.stringify(items))
    applyPaintSupplement(items, {
      missing_items: [{ surface: 'New', room: 'R', unit: 'm2', quantity: 5 }],
      corrections: [{ surface: 'Retail ceiling', room: 'Retail', field: 'quantity', value: 250 }],
    })
    expect(items).toEqual(snapshot)
  })
})
