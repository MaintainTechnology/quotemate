import { describe, it, expect } from 'vitest'
import { allocateIncGst, priceStack } from './line-allocation'
import { displayIncGst } from './money'

describe('allocateIncGst', () => {
  it('sums EXACTLY to the headline — the whole point of the module', () => {
    // 7 awkward lines whose naive ×1.1-per-row would drift several dollars.
    const lines = [
      { total_ex_gst: 133.33 },
      { total_ex_gst: 66.67 },
      { total_ex_gst: 11.11 },
      { total_ex_gst: 11.11 },
      { total_ex_gst: 11.11 },
      { total_ex_gst: 220 },
      { total_ex_gst: 0.5 },
    ]
    const total = displayIncGst(
      lines.reduce((a, l) => a + l.total_ex_gst, 0),
      { gstRegistered: true },
    )
    const rows = allocateIncGst(lines, total)
    expect(rows.reduce((a, b) => a + b, 0)).toBe(total)
    expect(rows.every((r) => Number.isInteger(r))).toBe(true)
  })

  it('reconciles for every line count 1..40 across messy amounts', () => {
    for (let n = 1; n <= 40; n++) {
      const lines = Array.from({ length: n }, (_, i) => ({
        total_ex_gst: (i * 37.77) % 419 + 0.13,
      }))
      const total = displayIncGst(
        lines.reduce((a, l) => a + l.total_ex_gst, 0),
        { gstRegistered: true },
      )
      const rows = allocateIncGst(lines, total)
      expect(rows.reduce((a, b) => a + b, 0), `n=${n}`).toBe(total)
    }
  })

  it('spreads equally when every line is $0 rather than dumping it on line 0', () => {
    const rows = allocateIncGst([{ total_ex_gst: 0 }, { total_ex_gst: 0 }, { total_ex_gst: 0 }], 10)
    expect(rows.reduce((a, b) => a + b, 0)).toBe(10)
    // 10/3 → 4,3,3 (largest remainder), never 10,0,0.
    expect(rows).toEqual([4, 3, 3])
  })

  it('keeps the biggest line the biggest row (monotonic)', () => {
    const rows = allocateIncGst(
      [{ total_ex_gst: 10 }, { total_ex_gst: 500 }, { total_ex_gst: 90 }],
      660,
    )
    expect(rows[1]).toBeGreaterThan(rows[2])
    expect(rows[2]).toBeGreaterThan(rows[0])
    expect(rows.reduce((a, b) => a + b, 0)).toBe(660)
  })

  it('handles no lines, and clamps a negative total', () => {
    expect(allocateIncGst([], 100)).toEqual([])
    const rows = allocateIncGst([{ total_ex_gst: 5 }, { total_ex_gst: 5 }], -50)
    expect(rows).toEqual([0, 0])
  })

  it('never lets a negative line total steal dollars from another row', () => {
    const rows = allocateIncGst([{ total_ex_gst: -100 }, { total_ex_gst: 100 }], 110)
    expect(rows.reduce((a, b) => a + b, 0)).toBe(110)
    expect(rows.every((r) => r >= 0)).toBe(true)
  })

  it('tolerates string amounts and nulls the way money.ts does', () => {
    const rows = allocateIncGst(
      [{ total_ex_gst: '200' }, { total_ex_gst: null }, { total_ex_gst: undefined }],
      220,
    )
    expect(rows.reduce((a, b) => a + b, 0)).toBe(220)
    expect(rows[0]).toBe(220)
  })
})

describe('priceStack', () => {
  it('adds up: net ex + GST === total, and total === displayIncGst', () => {
    const s = priceStack(1000, { gstRegistered: true })
    expect(s.totalDollars).toBe(displayIncGst(1000, { gstRegistered: true }))
    expect(s.netExDollars + s.gstDollars).toBe(s.totalDollars)
    expect(s.discountDollars).toBe(0)
    expect(s.gstDollars).toBe(100)
  })

  it('discounts the EX-GST base, not the tax (the canonical order)', () => {
    const s = priceStack(1000, { discountPct: 10, gstRegistered: true })
    expect(s.baseExDollars).toBe(1000)
    expect(s.netExDollars).toBe(900)
    expect(s.discountDollars).toBe(100)
    expect(s.gstDollars).toBe(90)
    expect(s.totalDollars).toBe(990)
    expect(s.netExDollars + s.gstDollars).toBe(s.totalDollars)
  })

  it('charges no GST for an unregistered tradie', () => {
    const s = priceStack(1000, { gstRegistered: false })
    expect(s.gstDollars).toBe(0)
    expect(s.totalDollars).toBe(1000)
    expect(s.gstApplies).toBe(false)
  })

  it('honours the 15% platform discount cap', () => {
    const s = priceStack(1000, { discountPct: 90, gstRegistered: true })
    expect(s.discountPct).toBe(15)
    expect(s.netExDollars).toBe(850)
  })

  it('stack reconciles across awkward bases (residual GST absorbs rounding)', () => {
    for (const ex of [0, 0.5, 1, 33.33, 99.99, 1234.56, 87654.32]) {
      for (const pct of [0, 5, 12.5]) {
        const s = priceStack(ex, { discountPct: pct, gstRegistered: true })
        expect(s.netExDollars + s.gstDollars, `ex=${ex} pct=${pct}`).toBe(s.totalDollars)
        expect(s.totalDollars).toBe(displayIncGst(ex, { discountPct: pct, gstRegistered: true }))
      }
    }
  })

  it('the allocated rows sum to the stack total — the two halves agree', () => {
    const lines = [{ total_ex_gst: 640 }, { total_ex_gst: 220 }, { total_ex_gst: 140.4 }]
    const subtotal = 1000.4
    const s = priceStack(subtotal, { discountPct: 7, gstRegistered: true })
    const rows = allocateIncGst(lines, s.totalDollars)
    expect(rows.reduce((a, b) => a + b, 0)).toBe(s.totalDollars)
  })

  it('reconciles even when the line totals do NOT sum to subtotal_ex_gst', () => {
    // No invariant enforces this in the DB, so it must not break the render.
    const lines = [{ total_ex_gst: 100 }, { total_ex_gst: 100 }]
    const s = priceStack(1000, { gstRegistered: true })
    const rows = allocateIncGst(lines, s.totalDollars)
    expect(rows.reduce((a, b) => a + b, 0)).toBe(s.totalDollars)
  })
})
