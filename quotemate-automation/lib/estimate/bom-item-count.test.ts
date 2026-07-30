// Phase 2 R4 — a recipe quantity follows the number of items the customer asked
// for.
//
// The bug: migration 118 seeds the downlight recipe as literally `6`, and
// nothing reads intake.scope.item_count. A customer asking for 10 downlights
// gets a bill of materials for 6.
//
// ⚠ The path that matters is the HINT, not the deterministic builder.
// DETERMINISTIC_BOM defaults off, so buildBomQuoteLines does not run in
// production; formatBomHint (always on) is the only way a BOM reaches a real
// quote. A fix confined to buildBomQuoteLines would be invisible.
//
// THE SEMANTIC, and why it is this one: the headline line's quantity is
// REPLACED by item_count; every other line keeps its recipe quantity. That
// matches the existing reconcile backstop, which already uses
// findHeadlineMaterialIndex to decide "which line's quantity should equal
// item_count". So `downlight ×6` + item_count 10 → ×10 (not ×60), and
// `sundries ×1` stays ×1 — a job needs one roll of tape whether it is 6
// downlights or 10.

import { describe, it, expect } from 'vitest'
import { scaleBomToItemCount, formatBomHint, buildBomQuoteLines } from './catalogue'

const RECIPE = [
  { material_category: 'downlight', quantity: 6, required: true, sort: 1 },
  { material_category: 'sundries', quantity: 1, required: true, sort: 2, description: 'clips + connectors' },
]

describe('Phase 2 R4 — scaleBomToItemCount', () => {
  it('replaces the headline quantity with item_count', () => {
    const out = scaleBomToItemCount(RECIPE, 10)
    expect(out[0].quantity).toBe(10)
  })

  it('leaves the sundries line alone — one roll of tape either way', () => {
    const out = scaleBomToItemCount(RECIPE, 10)
    expect(out[1].quantity).toBe(1)
  })

  it('does NOT multiply — 6 with a count of 10 is 10, never 60', () => {
    expect(scaleBomToItemCount(RECIPE, 10)[0].quantity).toBe(10)
    expect(scaleBomToItemCount(RECIPE, 2)[0].quantity).toBe(2)
  })

  it('is a no-op when item_count is absent, so today’s behaviour is preserved', () => {
    for (const c of [null, undefined, 0]) {
      const out = scaleBomToItemCount(RECIPE, c as number | null | undefined)
      expect(out[0].quantity, String(c)).toBe(6)
      expect(out[1].quantity, String(c)).toBe(1)
    }
  })

  it('ignores a nonsense count rather than writing it onto a quote', () => {
    for (const c of [-3, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 100_000]) {
      expect(scaleBomToItemCount(RECIPE, c)[0].quantity, String(c)).toBe(6)
    }
  })

  it('does not mutate the caller’s rows', () => {
    const rows = [{ material_category: 'downlight', quantity: 6 }]
    scaleBomToItemCount(rows, 10)
    expect(rows[0].quantity).toBe(6)
  })

  it('is deterministic — same input twice, same output', () => {
    expect(JSON.stringify(scaleBomToItemCount(RECIPE, 10))).toBe(
      JSON.stringify(scaleBomToItemCount(RECIPE, 10)),
    )
  })

  it('skips a sundries-only recipe — there is no headline to scale', () => {
    const only = [{ material_category: 'sundries', quantity: 1 }]
    expect(scaleBomToItemCount(only, 10)[0].quantity).toBe(1)
  })

  it('scales the FIRST non-sundry line, not every non-sundry line', () => {
    // item_count 10 means ten downlights, not ten safety switches.
    const mixed = [
      { material_category: 'downlight', quantity: 6, sort: 1 },
      { material_category: 'safety_switch', quantity: 1, sort: 2 },
    ]
    const out = scaleBomToItemCount(mixed, 10)
    expect(out[0].quantity).toBe(10)
    expect(out[1].quantity).toBe(1)
  })

  it('respects sort order when picking the headline, not array order', () => {
    const unsorted = [
      { material_category: 'sundries', quantity: 1, sort: 2 },
      { material_category: 'downlight', quantity: 6, sort: 1 },
    ]
    const out = scaleBomToItemCount(unsorted, 10)
    const dl = out.find((r) => r.material_category === 'downlight')
    const su = out.find((r) => r.material_category === 'sundries')
    expect(dl?.quantity).toBe(10)
    expect(su?.quantity).toBe(1)
  })
})

describe('Phase 2 R4 — the HINT path scales (the only one live in production)', () => {
  it('formatBomHint reflects item_count', () => {
    const hint = formatBomHint(scaleBomToItemCount(RECIPE, 10))
    expect(hint).toContain('10 x downlight')
    expect(hint).not.toContain('6 x downlight')
  })

  it('formatBomHint still shows the recipe quantity with no item_count', () => {
    const hint = formatBomHint(scaleBomToItemCount(RECIPE, null))
    expect(hint).toContain('6 x downlight')
  })

  it('the sundries line is unchanged in the hint', () => {
    const hint = formatBomHint(scaleBomToItemCount(RECIPE, 10))
    expect(hint).toContain('1 x sundries')
  })
})

describe('Phase 2 R4 — the deterministic path scales too', () => {
  const resolveMaterial = (c: string) =>
    c === 'downlight'
      ? { name: 'LED downlight', markedUpPrice: 40 }
      : { name: 'Sundries', markedUpPrice: 10 }

  it('buildBomQuoteLines prices item_count units, not the recipe default', () => {
    const { lines } = buildBomQuoteLines({
      bom: scaleBomToItemCount(RECIPE, 10),
      resolveMaterial,
      labourHours: 0,
      labourRate: 0,
    })
    const dl = lines.find((l) => l.description === 'LED downlight')
    expect(dl?.quantity).toBe(10)
    expect(dl?.total_ex_gst).toBe(400)
  })

  it('the same input twice produces an identical result', () => {
    const run = () =>
      buildBomQuoteLines({
        bom: scaleBomToItemCount(RECIPE, 10),
        resolveMaterial,
        labourHours: 0,
        labourRate: 0,
      })
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()))
  })
})
