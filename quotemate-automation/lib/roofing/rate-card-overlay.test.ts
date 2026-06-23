// Overlay parser + merge + validation — every contract the spec calls out.

import { describe, expect, it } from 'vitest'
import { DEFAULT_ROOFING_RATE_CARD } from './pricing'
import {
  EDITABLE_MATERIALS,
  MAX_RATE_PER_M2,
  buildOverlayFromInputs,
  effectiveRateCardFromOverlay,
  mergeRoofingRateCard,
  parseRoofingRateOverlay,
} from './rate-card-overlay'

describe('parseRoofingRateOverlay', () => {
  it('accepts null / undefined as an empty overlay', () => {
    expect(parseRoofingRateOverlay(null)).toEqual({ ok: true, overlay: {} })
    expect(parseRoofingRateOverlay(undefined)).toEqual({ ok: true, overlay: {} })
  })

  it('accepts a full per-material map', () => {
    const r = parseRoofingRateOverlay({
      reroof_rate_per_m2: {
        colorbond_trimdek: 110,
        colorbond_kliplok: 130,
        concrete_tile: 100,
        terracotta_tile: 150,
        cement_sheet: 1,
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.overlay.reroof_rate_per_m2?.colorbond_trimdek).toBe(110)
    }
  })

  it('accepts a partial map (only some materials)', () => {
    const r = parseRoofingRateOverlay({ reroof_rate_per_m2: { colorbond_trimdek: 110 } })
    expect(r.ok).toBe(true)
  })

  it('rejects non-object / array payloads', () => {
    expect(parseRoofingRateOverlay([1, 2, 3]).ok).toBe(false)
    expect(parseRoofingRateOverlay('blah').ok).toBe(false)
    expect(parseRoofingRateOverlay(42).ok).toBe(false)
  })

  it('rejects negative rates', () => {
    const r = parseRoofingRateOverlay({
      reroof_rate_per_m2: { colorbond_trimdek: -5 },
    })
    expect(r.ok).toBe(false)
  })

  it('rejects zero rates (would silently zero out the price)', () => {
    const r = parseRoofingRateOverlay({
      reroof_rate_per_m2: { colorbond_trimdek: 0 },
    })
    expect(r.ok).toBe(false)
  })

  it(`rejects rates above $${MAX_RATE_PER_M2}/m²`, () => {
    const r = parseRoofingRateOverlay({
      reroof_rate_per_m2: { colorbond_trimdek: MAX_RATE_PER_M2 + 1 },
    })
    expect(r.ok).toBe(false)
  })
})

describe('mergeRoofingRateCard — overlay wins, default fills the gaps', () => {
  it('returns the base unchanged when overlay is empty', () => {
    expect(mergeRoofingRateCard(DEFAULT_ROOFING_RATE_CARD, {})).toEqual(
      DEFAULT_ROOFING_RATE_CARD,
    )
    expect(mergeRoofingRateCard(DEFAULT_ROOFING_RATE_CARD, null)).toEqual(
      DEFAULT_ROOFING_RATE_CARD,
    )
  })

  it('overlay value replaces default for the named material', () => {
    const merged = mergeRoofingRateCard(DEFAULT_ROOFING_RATE_CARD, {
      reroof_rate_per_m2: { colorbond_trimdek: 110 },
    })
    expect(merged.reroof_rate_per_m2.colorbond_trimdek).toBe(110)
    expect(merged.reroof_rate_per_m2.colorbond_kliplok).toBe(
      DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.colorbond_kliplok,
    )
  })

  it('leaves non-overlay materials at their default', () => {
    const merged = mergeRoofingRateCard(DEFAULT_ROOFING_RATE_CARD, {
      reroof_rate_per_m2: { concrete_tile: 99 },
    })
    expect(merged.reroof_rate_per_m2.colorbond_trimdek).toBe(
      DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.colorbond_trimdek,
    )
    expect(merged.reroof_rate_per_m2.concrete_tile).toBe(99)
  })

  it('does not mutate the input base', () => {
    const before = JSON.parse(JSON.stringify(DEFAULT_ROOFING_RATE_CARD))
    mergeRoofingRateCard(DEFAULT_ROOFING_RATE_CARD, {
      reroof_rate_per_m2: { colorbond_trimdek: 200 },
    })
    expect(DEFAULT_ROOFING_RATE_CARD).toEqual(before)
  })

  it('passes through multi-storey, asbestos, upgrade, and gst fields unchanged', () => {
    const merged = mergeRoofingRateCard(DEFAULT_ROOFING_RATE_CARD, {
      reroof_rate_per_m2: { colorbond_trimdek: 110 },
    })
    expect(merged.multi_storey_loading_pct).toBe(
      DEFAULT_ROOFING_RATE_CARD.multi_storey_loading_pct,
    )
    expect(merged.asbestos_loading_pct).toBe(
      DEFAULT_ROOFING_RATE_CARD.asbestos_loading_pct,
    )
    expect(merged.upgrade_material).toBe(DEFAULT_ROOFING_RATE_CARD.upgrade_material)
    expect(merged.gst_registered).toBe(DEFAULT_ROOFING_RATE_CARD.gst_registered)
  })
})

describe('effectiveRateCardFromOverlay — DB-side convenience', () => {
  it('falls back to default when the stored value is unparseable', () => {
    expect(effectiveRateCardFromOverlay('garbage')).toEqual(DEFAULT_ROOFING_RATE_CARD)
    expect(effectiveRateCardFromOverlay(42)).toEqual(DEFAULT_ROOFING_RATE_CARD)
    expect(effectiveRateCardFromOverlay([1, 2, 3])).toEqual(DEFAULT_ROOFING_RATE_CARD)
  })

  it('falls back to default when the stored overlay fails validation', () => {
    // A bad rate in storage should never break a quote — fall back silently.
    expect(
      effectiveRateCardFromOverlay({ reroof_rate_per_m2: { colorbond_trimdek: -5 } }),
    ).toEqual(DEFAULT_ROOFING_RATE_CARD)
  })

  it('applies a valid overlay correctly', () => {
    const r = effectiveRateCardFromOverlay({
      reroof_rate_per_m2: { colorbond_trimdek: 110 },
    })
    expect(r.reroof_rate_per_m2.colorbond_trimdek).toBe(110)
  })
})

describe('buildOverlayFromInputs — dashboard PATCH validator', () => {
  it('keeps numeric inputs and skips blank/null/undefined', () => {
    const r = buildOverlayFromInputs({
      colorbond_trimdek: 110,
      colorbond_kliplok: null,
      concrete_tile: '',
      terracotta_tile: undefined,
      cement_sheet: 1,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.overlay.reroof_rate_per_m2).toEqual({
        colorbond_trimdek: 110,
        cement_sheet: 1,
      })
    }
  })

  it('coerces numeric strings (e.g. from <input type="number">)', () => {
    const r = buildOverlayFromInputs({ colorbond_trimdek: '110' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.overlay.reroof_rate_per_m2?.colorbond_trimdek).toBe(110)
  })

  it('rejects negative values', () => {
    const r = buildOverlayFromInputs({ colorbond_trimdek: -10 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0].message).toMatch(/greater than 0/i)
  })

  it('rejects zero', () => {
    const r = buildOverlayFromInputs({ colorbond_trimdek: 0 })
    expect(r.ok).toBe(false)
  })

  it(`rejects values above $${MAX_RATE_PER_M2}/m²`, () => {
    const r = buildOverlayFromInputs({ colorbond_trimdek: MAX_RATE_PER_M2 + 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0].message).toMatch(new RegExp(`${MAX_RATE_PER_M2}`))
  })

  it('rejects unparseable strings', () => {
    const r = buildOverlayFromInputs({ colorbond_trimdek: 'one hundred' })
    expect(r.ok).toBe(false)
  })

  it('returns an empty overlay when EVERY input is blank', () => {
    const r = buildOverlayFromInputs({})
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.overlay).toEqual({})
  })

  it('reports issues for multiple bad fields independently', () => {
    const r = buildOverlayFromInputs({
      colorbond_trimdek: -1,
      concrete_tile: MAX_RATE_PER_M2 + 5,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.issues.length).toBeGreaterThanOrEqual(2)
      expect(r.issues.map((i) => i.field)).toEqual(
        expect.arrayContaining([
          'reroof_rate_per_m2.colorbond_trimdek',
          'reroof_rate_per_m2.concrete_tile',
        ]),
      )
    }
  })
})

describe('EDITABLE_MATERIALS — phase 1 scope', () => {
  it('contains exactly the seven materials the spec names', () => {
    expect(EDITABLE_MATERIALS).toEqual([
      'colorbond_corrugated',
      'colorbond_trimdek',
      'colorbond_spandek',
      'colorbond_kliplok',
      'concrete_tile',
      'terracotta_tile',
      'cement_sheet',
    ])
  })
  it('does not include `unknown` (never user-selected)', () => {
    expect(EDITABLE_MATERIALS).not.toContain('unknown')
  })
})

describe('overlay — Corrugated + Spandek rates (roof-types spec)', () => {
  it('lets a tenant override the two new metal rates', () => {
    const merged = mergeRoofingRateCard(DEFAULT_ROOFING_RATE_CARD, {
      reroof_rate_per_m2: { colorbond_corrugated: 88, colorbond_spandek: 112 },
    })
    expect(merged.reroof_rate_per_m2.colorbond_corrugated).toBe(88)
    expect(merged.reroof_rate_per_m2.colorbond_spandek).toBe(112)
  })
  it('falls back to defaults when the new rates are not overridden', () => {
    const merged = mergeRoofingRateCard(DEFAULT_ROOFING_RATE_CARD, {
      reroof_rate_per_m2: { colorbond_trimdek: 110 },
    })
    expect(merged.reroof_rate_per_m2.colorbond_corrugated).toBe(
      DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.colorbond_corrugated,
    )
    expect(merged.reroof_rate_per_m2.colorbond_spandek).toBe(
      DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.colorbond_spandek,
    )
  })
  it('round-trips the two new rates through buildOverlayFromInputs (PATCH path)', () => {
    const r = buildOverlayFromInputs({
      reroof_rate_per_m2: { colorbond_corrugated: '90', colorbond_spandek: '105' },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.overlay.reroof_rate_per_m2?.colorbond_corrugated).toBe(90)
      expect(r.overlay.reroof_rate_per_m2?.colorbond_spandek).toBe(105)
    }
  })
})
