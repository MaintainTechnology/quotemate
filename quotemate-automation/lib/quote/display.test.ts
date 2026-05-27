// Tests for the pure quote-display module.
// No DOM, no DB, no fetch — just type-guard + resolver + roll-up math.

import { describe, expect, it } from 'vitest'
import {
  asQuoteDisplayMode,
  resolveQuoteDisplayMode,
  sumLabourHours,
  countMaterialItems,
  QUOTE_DISPLAY_MODES,
} from './display'

describe('QUOTE_DISPLAY_MODES', () => {
  it('has exactly two modes', () => {
    expect(QUOTE_DISPLAY_MODES).toEqual(['itemised', 'summary'])
  })
})

describe('asQuoteDisplayMode', () => {
  it('accepts valid modes verbatim', () => {
    expect(asQuoteDisplayMode('itemised')).toBe('itemised')
    expect(asQuoteDisplayMode('summary')).toBe('summary')
  })

  it('falls back to itemised by default for invalid input', () => {
    expect(asQuoteDisplayMode(null)).toBe('itemised')
    expect(asQuoteDisplayMode(undefined)).toBe('itemised')
    expect(asQuoteDisplayMode('')).toBe('itemised')
    expect(asQuoteDisplayMode('garbage')).toBe('itemised')
    expect(asQuoteDisplayMode(42)).toBe('itemised')
    expect(asQuoteDisplayMode({})).toBe('itemised')
  })

  it('honours the explicit fallback', () => {
    expect(asQuoteDisplayMode(null, 'summary')).toBe('summary')
    expect(asQuoteDisplayMode('nope', 'summary')).toBe('summary')
  })

  it('case-sensitive — uppercase or mixed-case inputs are NOT accepted', () => {
    // We never want 'Summary' coming through from a stale DB row to be silently
    // treated as 'summary' — the dashboard form must round-trip the lowercase
    // value or the resolver should fall back to the default.
    expect(asQuoteDisplayMode('Summary')).toBe('itemised')
    expect(asQuoteDisplayMode('SUMMARY')).toBe('itemised')
    expect(asQuoteDisplayMode('ITEMISED')).toBe('itemised')
  })
})

describe('resolveQuoteDisplayMode', () => {
  it('returns the per-quote override when set to a valid value (Phase B)', () => {
    expect(
      resolveQuoteDisplayMode({
        perQuoteOverride: 'summary',
        tenantPreference: 'itemised',
      }),
    ).toBe('summary')
    expect(
      resolveQuoteDisplayMode({
        perQuoteOverride: 'itemised',
        tenantPreference: 'summary',
      }),
    ).toBe('itemised')
  })

  it('falls back to the tenant preference when no per-quote override', () => {
    expect(
      resolveQuoteDisplayMode({
        perQuoteOverride: null,
        tenantPreference: 'summary',
      }),
    ).toBe('summary')
    expect(
      resolveQuoteDisplayMode({
        perQuoteOverride: undefined,
        tenantPreference: 'itemised',
      }),
    ).toBe('itemised')
  })

  it('falls back to itemised when neither override nor tenant preference are valid', () => {
    expect(
      resolveQuoteDisplayMode({
        perQuoteOverride: null,
        tenantPreference: null,
      }),
    ).toBe('itemised')
    expect(
      resolveQuoteDisplayMode({
        perQuoteOverride: 'nonsense',
        tenantPreference: 'also nonsense',
      }),
    ).toBe('itemised')
    expect(resolveQuoteDisplayMode({})).toBe('itemised')
  })

  it('an invalid per-quote override does NOT block the tenant preference', () => {
    expect(
      resolveQuoteDisplayMode({
        perQuoteOverride: 'bogus',
        tenantPreference: 'summary',
      }),
    ).toBe('summary')
  })
})

describe('sumLabourHours', () => {
  it('sums every line where source === labour', () => {
    const lines = [
      { source: 'labour', unit: 'hr', quantity: 3 },
      { source: 'material', unit: 'each', quantity: 1 },
      { source: 'labour', unit: 'hr', quantity: 0.25 },
      { source: 'assembly:abc', unit: 'each', quantity: 1 },
    ]
    expect(sumLabourHours(lines)).toBe(3.25)
  })

  it('coerces string quantities so DB jsonb numerics-as-strings still add up', () => {
    const lines = [
      { source: 'labour', unit: 'hr', quantity: '2.5' },
      { source: 'labour', unit: 'hr', quantity: '0.75' },
    ]
    expect(sumLabourHours(lines)).toBe(3.25)
  })

  it('ignores labour lines with non-positive or non-finite quantities', () => {
    const lines = [
      { source: 'labour', unit: 'hr', quantity: 0 },
      { source: 'labour', unit: 'hr', quantity: -1 },
      { source: 'labour', unit: 'hr', quantity: 'abc' },
      { source: 'labour', unit: 'hr', quantity: null },
      { source: 'labour', unit: 'hr', quantity: 1.5 },
    ]
    expect(sumLabourHours(lines)).toBe(1.5)
  })

  it('returns 0 for empty / nullish input — render-safe', () => {
    expect(sumLabourHours([])).toBe(0)
    expect(sumLabourHours(null)).toBe(0)
    expect(sumLabourHours(undefined)).toBe(0)
  })

  it('rounds to 2 dp so floating-point sums print cleanly', () => {
    const lines = [
      { source: 'labour', unit: 'hr', quantity: 0.1 },
      { source: 'labour', unit: 'hr', quantity: 0.2 },
    ]
    expect(sumLabourHours(lines)).toBe(0.3)
  })

  it('ignores non-labour sources entirely (assembly + material + call_out)', () => {
    const lines = [
      { source: 'assembly:foo', unit: 'each', quantity: 1 },
      { source: 'material:bar', unit: 'each', quantity: 4 },
      { source: 'call_out', unit: 'each', quantity: 1 },
    ]
    expect(sumLabourHours(lines)).toBe(0)
  })
})

describe('countMaterialItems', () => {
  it('counts every line that is NOT labour and NOT call_out', () => {
    const lines = [
      { source: 'material:abc', unit: 'each', quantity: 1 },
      { source: 'labour', unit: 'hr', quantity: 3 },
      { source: 'assembly:xyz', unit: 'each', quantity: 1 },
      { source: 'call_out', unit: 'each', quantity: 1 },
      { source: 'material:def', unit: 'each', quantity: 2 },
    ]
    expect(countMaterialItems(lines)).toBe(3) // material, assembly, material
  })

  it('treats lines with missing source as "material-style" (defensive — never under-counts)', () => {
    // A line item missing its source field still represents real work in
    // the customer's scope; count it so the summary doesn't read "0 items"
    // when there's clearly real stuff in the quote.
    const lines = [{ unit: 'each', quantity: 1 }]
    expect(countMaterialItems(lines)).toBe(1)
  })

  it('returns 0 for empty / nullish input', () => {
    expect(countMaterialItems([])).toBe(0)
    expect(countMaterialItems(null)).toBe(0)
    expect(countMaterialItems(undefined)).toBe(0)
  })

  it('skips falsy entries in the array (e.g. accidental nulls)', () => {
    const lines = [
      null as unknown as { source: string },
      { source: 'material:abc', unit: 'each', quantity: 1 },
      undefined as unknown as { source: string },
    ]
    expect(countMaterialItems(lines)).toBe(1)
  })
})
