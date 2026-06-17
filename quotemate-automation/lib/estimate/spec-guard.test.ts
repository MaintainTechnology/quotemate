// Unit tests for the spec guard (mode resolution, name fallback, decision).

import { describe, expect, it } from 'vitest'
import {
  specGuardMode,
  effectiveProductProps,
  evaluateSpecGuard,
  evaluateDraftSpecGuard,
  coverageGapConflicts,
  type CategoryRow,
} from './spec-guard'

describe('specGuardMode', () => {
  it('defaults to enforce', () => {
    expect(specGuardMode({})).toBe('enforce')
    expect(specGuardMode({ SPEC_GUARD_MODE: '' })).toBe('enforce')
    expect(specGuardMode({ SPEC_GUARD_MODE: 'garbage' })).toBe('enforce')
  })
  it('honours explicit off / enforce / shadow, case-insensitively', () => {
    expect(specGuardMode({ SPEC_GUARD_MODE: 'off' })).toBe('off')
    expect(specGuardMode({ SPEC_GUARD_MODE: 'ENFORCE' })).toBe('enforce')
    expect(specGuardMode({ SPEC_GUARD_MODE: ' Shadow ' })).toBe('shadow')
  })
})

describe('effectiveProductProps — name fallback', () => {
  it('fills a missing requested key by parsing the product name', () => {
    const eff = effectiveProductProps({}, 'Clipsal 2000 series double GPO 10A', ['amperage'])
    expect(eff.amperage).toBe('10A')
  })
  it('never overrides a structured property that is already present', () => {
    const eff = effectiveProductProps({ amperage: '15A' }, 'GPO 10A', ['amperage'])
    expect(eff.amperage).toBe('15A')
  })
  it('leaves the key absent when the name has no parseable value', () => {
    const eff = effectiveProductProps({}, 'Generic double GPO', ['amperage'])
    expect(eff.amperage).toBeUndefined()
  })
})

describe('evaluateSpecGuard', () => {
  const REQ = { amperage: '15A' }

  it("mode 'off' is always a no-op match", () => {
    const d = evaluateSpecGuard({
      requested: REQ,
      properties: { amperage: '10A' },
      trade: 'electrical',
      category: 'gpo',
      mode: 'off',
    })
    expect(d.verdict).toBe('match')
    expect(d.block).toBe(false)
  })

  it('shadow: a contradiction is a mismatch but does NOT block', () => {
    const d = evaluateSpecGuard({
      requested: REQ,
      properties: { amperage: '10A' },
      name: 'Clipsal 2000 double GPO 10A',
      trade: 'electrical',
      category: 'gpo',
      mode: 'shadow',
    })
    expect(d.verdict).toBe('mismatch')
    expect(d.block).toBe(false)
    expect(d.reason).toContain('amperage')
  })

  it('enforce: a contradiction blocks the lock', () => {
    const d = evaluateSpecGuard({
      requested: REQ,
      properties: { amperage: '10A' },
      trade: 'electrical',
      category: 'gpo',
      mode: 'enforce',
    })
    expect(d.verdict).toBe('mismatch')
    expect(d.block).toBe(true)
  })

  it('enforce: catches the contradiction via the NAME when properties are empty', () => {
    const d = evaluateSpecGuard({
      requested: REQ,
      properties: {},
      name: 'Clipsal 2000 series double GPO 10A',
      trade: 'electrical',
      category: 'gpo',
      mode: 'enforce',
    })
    expect(d.verdict).toBe('mismatch')
    expect(d.block).toBe(true)
  })

  it('enforce: a matching product does not block', () => {
    const d = evaluateSpecGuard({
      requested: REQ,
      properties: { amperage: '15A' },
      trade: 'electrical',
      category: 'gpo',
      mode: 'enforce',
    })
    expect(d.verdict).toBe('match')
    expect(d.block).toBe(false)
  })

  it('downlight: a 9W product MATCHES a 9W request via the name (regression)', () => {
    // Live incident (intake 0cdc2905, Atomic): requested_specs carried
    // {product, wattage:"9W"} and the chosen product had empty properties.
    // Before the wattage canonicaliser + (electrical,downlight) SpecDef,
    // the guard parsed nothing from the name → compared "9w" against the
    // whole product name → false 'mismatch' that would have BLOCKED in
    // enforce. It must reconcile to 'match'.
    const d = evaluateSpecGuard({
      requested: { product: 'Brilliant Halo 90 9W LED downlight', wattage: '9W' },
      properties: {},
      name: 'Brilliant Halo 90 9W LED downlight',
      trade: 'electrical',
      category: 'downlight',
      mode: 'enforce',
    })
    expect(d.verdict).toBe('match')
    expect(d.block).toBe(false)
    expect(d.conflicts).toEqual([])
  })

  it('enforce: unknown (no spec data anywhere) never blocks', () => {
    const d = evaluateSpecGuard({
      requested: REQ,
      properties: {},
      name: 'Generic double GPO',
      trade: 'electrical',
      category: 'gpo',
      mode: 'enforce',
    })
    expect(d.verdict).toBe('unknown')
    expect(d.block).toBe(false)
  })

  it('enforce: empty requested specs is a vacuous match (most jobs)', () => {
    const d = evaluateSpecGuard({
      requested: {},
      properties: { amperage: '10A' },
      trade: 'electrical',
      category: 'gpo',
      mode: 'enforce',
    })
    expect(d.verdict).toBe('match')
    expect(d.block).toBe(false)
  })

  it('plumbing energy-source contradiction blocks in enforce', () => {
    const d = evaluateSpecGuard({
      requested: { energy_source: 'gas' },
      properties: { energy_source: 'electric' },
      trade: 'plumbing',
      category: 'hot_water',
      mode: 'enforce',
    })
    expect(d.block).toBe(true)
  })
})

describe('coverageGapConflicts (Phase 5 — catalogue-gap rule)', () => {
  const wellCovered = [
    { properties: { amperage: '10A' }, name: 'A' },
    { properties: { amperage: '15A' }, name: 'B' },
    { properties: { amperage: '20A' }, name: 'C' },
    { properties: { amperage: '10A' }, name: 'D' },
  ]

  it('flags a gap when the category tracks the key but the chosen product lacks it', () => {
    const c = coverageGapConflicts({
      requested: { amperage: '15A' },
      chosenProperties: {},
      chosenName: 'Mystery GPO',
      categoryRows: wellCovered,
      trade: 'electrical',
      category: 'gpo',
    })
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ key: 'amperage', requested: '15A', product: 'absent' })
  })

  it('does NOT fire below the minimum row count (too few rows to judge)', () => {
    expect(
      coverageGapConflicts({
        requested: { amperage: '15A' },
        chosenProperties: {},
        chosenName: 'Mystery',
        categoryRows: wellCovered.slice(0, 2),
        trade: 'electrical',
        category: 'gpo',
      }),
    ).toEqual([])
  })

  it('does NOT fire below the coverage fraction (sparse data is safe)', () => {
    const sparse: CategoryRow[] = [
      { properties: { amperage: '10A' }, name: 'A' },
      { properties: {}, name: 'plain GPO' },
      { properties: {}, name: 'plain GPO two' },
      { properties: {}, name: 'plain GPO three' },
    ]
    expect(
      coverageGapConflicts({
        requested: { amperage: '15A' },
        chosenProperties: {},
        chosenName: 'plain',
        categoryRows: sparse,
        trade: 'electrical',
        category: 'gpo',
      }),
    ).toEqual([])
  })

  it('no gap when the chosen product actually matches the request', () => {
    expect(
      coverageGapConflicts({
        requested: { amperage: '15A' },
        chosenProperties: { amperage: '15A' },
        categoryRows: wellCovered,
        trade: 'electrical',
        category: 'gpo',
      }),
    ).toEqual([])
  })

  it('enforce: escalates an UNKNOWN to mismatch+block via the gap rule', () => {
    const d = evaluateSpecGuard({
      requested: { amperage: '15A' },
      properties: {},
      name: 'Mystery GPO',
      trade: 'electrical',
      category: 'gpo',
      mode: 'enforce',
      categoryRows: wellCovered,
    })
    expect(d.verdict).toBe('mismatch')
    expect(d.block).toBe(true)
  })

  it('shadow: never escalates via the gap rule (stays unknown, no block)', () => {
    const d = evaluateSpecGuard({
      requested: { amperage: '15A' },
      properties: {},
      name: 'Mystery GPO',
      trade: 'electrical',
      category: 'gpo',
      mode: 'shadow',
      categoryRows: wellCovered,
    })
    expect(d.verdict).toBe('unknown')
    expect(d.block).toBe(false)
  })

  it('enforce without categoryRows leaves an unknown untouched', () => {
    const d = evaluateSpecGuard({
      requested: { amperage: '15A' },
      properties: {},
      name: 'Mystery GPO',
      trade: 'electrical',
      category: 'gpo',
      mode: 'enforce',
    })
    expect(d.verdict).toBe('unknown')
    expect(d.block).toBe(false)
  })
})

describe('evaluateDraftSpecGuard — main-path (per-tier) guard', () => {
  const ROWS = [
    { id: 'p10', name: 'Clipsal 2000 GPO', properties: { amperage: '10A' } },
    { id: 'p15', name: 'Clipsal 15Amp', properties: { amperage: '15A' } },
  ]
  const tier = (description: string, extra: Record<string, unknown> = {}) => ({
    line_items: [
      { description, unit: 'each', quantity: 1, unit_price_ex_gst: 30, source: 'material', ...extra },
      { description: 'Labour', unit: 'hr', quantity: 2, unit_price_ex_gst: 110, source: 'labour' },
    ],
  })

  it('flags a tier whose headline product contradicts the requested amperage (by catalogue_id)', () => {
    const draft = { good: tier('Double GPO', { catalogue_id: 'p10' }) }
    const res = evaluateDraftSpecGuard({
      draft, requested: { amperage: '15A' }, trade: 'electrical', category: 'gpo', productRows: ROWS, mode: 'shadow',
    })
    expect(res).toHaveLength(1)
    expect(res[0].tier).toBe('good')
    expect(res[0].decision.verdict).toBe('mismatch')
    expect(res[0].decision.block).toBe(false) // shadow never blocks
  })

  it('resolves the product by NAME when no catalogue_id, and matches when correct', () => {
    const draft = { better: tier('Clipsal 15Amp') }
    const res = evaluateDraftSpecGuard({
      draft, requested: { amperage: '15A' }, trade: 'electrical', category: 'gpo', productRows: ROWS, mode: 'shadow',
    })
    expect(res[0].decision.verdict).toBe('match')
  })

  it('catches the contradiction via the line description name-parse when no rows resolve', () => {
    const draft = { good: tier('Clipsal 2000 series double GPO 10A') }
    const res = evaluateDraftSpecGuard({
      draft, requested: { amperage: '15A' }, trade: 'electrical', category: 'gpo', productRows: [], mode: 'enforce',
    })
    expect(res[0].decision.verdict).toBe('mismatch')
  })

  it('returns nothing for an inspection-style draft (null tiers)', () => {
    expect(
      evaluateDraftSpecGuard({ draft: { good: null, better: null, best: null }, requested: { amperage: '15A' } }),
    ).toEqual([])
  })

  it('reconciles only the headline material line, never the labour line', () => {
    const draft = { good: tier('Double GPO', { catalogue_id: 'p10' }) }
    const res = evaluateDraftSpecGuard({
      draft, requested: { amperage: '15A' }, trade: 'electrical', category: 'gpo', productRows: ROWS, mode: 'shadow',
    })
    expect(res).toHaveLength(1)
  })
})
