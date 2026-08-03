// Phase 4 R2 — the tradie's Good/Better/Best ladder reaches the price builder.
//
// THE BUG this closes. Everything downstream of the loader was already built
// and already correct: `tierLadder` is a declared field of
// DeterministicTierInput (deterministic-bom.ts:71), the builder forwards it
// per tier (deterministic-bom.ts:125), and chooseMaterial resolves a
// (category, tier) pin to an exact product ahead of every other signal
// (catalogue.ts:152-168), with its own unit tests in catalogue.test.ts.
//
// The one missing link was the loader: loadDeterministicInputs never set the
// field, so `input.tierLadder` was ALWAYS undefined in production and the
// ladder branch was dead code. A tradie could pin "for downlights at Better,
// always use the SAL Anova", see it saved in the dashboard, and the quote
// would ignore it. scripts/diag-deterministic-readiness.mjs:71 says so out
// loud: "(and the live path omits tierLadder anyway)".
//
// WHY BOTH KINDS OF TEST BELOW. A behavioural test alone cannot see this bug —
// call buildDeterministicTiers with a ladder and it works fine; the defect is
// that nobody ever passed one. And a Supabase `.select()` is a STRING, so a
// missing column is an undefined at runtime, never an error. Hence:
//   1. source assertions on the WIRING (what was actually broken), and
//   2. a behavioural test through the real builder (what the wiring buys).
// Same split, and same reason, as phase4-blockers.test.ts.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { buildDeterministicTiers, type DeterministicTierInput } from './deterministic-bom'
import type { TenantMaterial, SharedMaterial, BomLine } from './catalogue'

const runTs = readFileSync(resolve(process.cwd(), 'lib', 'estimate', 'run.ts'), 'utf8')

/** The body of loadDeterministicInputs — the function that builds the
 *  builder's input. run.ts reads tenant_tier_ladder in TWO places and only
 *  this one matters: the other (buildCatalogueHint, ~line 1629) shapes prompt
 *  text for Opus and deliberately selects name/brand instead of catalogue_id.
 *  Asserting on the whole file would pass on that unrelated query. */
function loaderBody(): string {
  const end = runTs.indexOf('const input: DeterministicTierInput')
  expect(end, 'loadDeterministicInputs not found').toBeGreaterThan(-1)
  const start = runTs.lastIndexOf('async function loadDeterministicInputs', end)
  expect(start, 'loader function declaration not found').toBeGreaterThan(-1)
  // Through to the end of the input literal, so the construction is included.
  return runTs.slice(start, runTs.indexOf('}', runTs.indexOf('return { input', end)))
}

/** The column list inside the ladder read's `.select('…')`, split into names.
 *  Extracting the literal — rather than regex-ing the surrounding source —
 *  is what makes the column assertions actually bind: a substring search over
 *  the source can be satisfied by the table name, a variable name, or a
 *  comment, none of which put a column on the wire. Tolerant of reordering
 *  and whitespace, which are not the thing under test. */
function ladderSelectColumns(): string[] {
  const body = loaderBody()
  const at = body.indexOf("from('tenant_tier_ladder')")
  expect(at, 'the deterministic loader does not read tenant_tier_ladder').toBeGreaterThan(-1)
  const m = body.slice(at).match(/\.select\(\s*'([^']*)'/)
  expect(m, 'the ladder read has no literal .select(\'…\')').not.toBeNull()
  return m![1].split(',').map((s) => s.trim()).filter(Boolean)
}

describe('Phase 4 R2 — the loader loads the ladder', () => {
  const body = loaderBody()

  it('queries tenant_tier_ladder inside the deterministic loader', () => {
    expect(body).toMatch(/from\('tenant_tier_ladder'\)/)
  })

  it('selects all three columns TierLadderEntry requires', () => {
    // TierLadderEntry is { category, tier, catalogue_id } and all three are
    // required. The prompt-hint query omits catalogue_id, which is exactly why
    // it could not be reused here.
    //
    // ⚠ Assert on the EXTRACTED column list, never on a slice of the source.
    // The first version of this test grepped `/tier/` against everything from
    // `from('tenant_tier_ladder')` onward — and the table name itself contains
    // "tier", so the assertion matched the anchor and proved nothing. Dropping
    // `tier` from the select left all five wiring tests green while every
    // ladder pin silently died: rows come back with tier undefined, the
    // `e.tier === input.tier` match in catalogue.ts:154 never fires, and the
    // dead-ladder bug this whole file exists to prevent is back. `as
    // TierLadderEntry[]` is an unchecked assertion, so tsc does not catch it
    // either. Caught by mutation testing, not by reading.
    const cols = ladderSelectColumns()
    for (const c of ['category', 'tier', 'catalogue_id']) {
      expect(cols, `ladder select is missing ${c} — got: ${cols.join(', ')}`).toContain(c)
    }
  })

  it('scopes the ladder to the tenant', () => {
    // A ladder is a tradie's own pricing decision. An unscoped read would let
    // one tradie's pin choose another tradie's product.
    const sel = body.slice(body.indexOf("from('tenant_tier_ladder')"))
    expect(sel).toMatch(/\.eq\('tenant_id', tenantId\)/)
  })

  it('passes tierLadder into DeterministicTierInput', () => {
    // The actual defect. Without this line every assertion above is satisfied
    // by a query whose result is thrown away.
    expect(body).toMatch(/tierLadder:/)
  })

  it('still sets every field it set before — a lost field is a silent undefined', () => {
    for (const f of [
      'bom:', 'tenantMaterials:', 'sharedMaterials:',
      'labourHours:', 'hourlyRate:', 'markupPct:',
    ]) {
      expect(body, `dropped ${f}`).toContain(f)
    }
  })

  it('fetches the ladder alongside the other reads, not in series after them', () => {
    // The loader runs inside an SMS turn that already has a 60s inflight lock
    // and a ~200-300s worst case. A third sequential round trip for a table
    // that is usually empty is latency for nothing.
    const promiseAll = body.slice(body.indexOf('Promise.all'))
    expect(promiseAll).toMatch(/lq/)
  })
})

// ── What the wiring buys ────────────────────────────────────────────────

const CATALOGUE: TenantMaterial[] = [
  { id: 'dl-good',   category: 'downlight', name: 'Standard DL', brand: 'Acme', range_series: '2000',      unit_price_ex_gst: 10, active: true },
  { id: 'dl-better', category: 'downlight', name: 'Iconic DL',   brand: 'Acme', range_series: 'Iconic',    unit_price_ex_gst: 20, active: true },
  { id: 'dl-best',   category: 'downlight', name: 'Elite DL',    brand: 'Acme', range_series: 'Signature', unit_price_ex_gst: 30, active: true },
  { id: 'dl-pinned', category: 'downlight', name: 'SAL Anova',   brand: 'SAL',  range_series: 'Anova',     unit_price_ex_gst: 25, active: true },
]
const SHARED: SharedMaterial[] = [
  { name: 'Generic sundry', category: 'sundry', default_unit_price_ex_gst: 4 },
]
const BOM: BomLine[] = [{ material_category: 'downlight', quantity: 2, required: true }]

const BASE: DeterministicTierInput = {
  bom: BOM,
  tenantMaterials: CATALOGUE,
  sharedMaterials: SHARED,
  labourHours: 1.5,
  hourlyRate: 110,
  markupPct: 25,
}

/** Only the fields these assertions read. Deliberately narrow rather than
 *  `any[]`: a typo in a field name should fail the typecheck, not silently
 *  compare undefined to undefined and pass. */
type Priced = {
  source: string
  description: string
  unit_price_ex_gst: number
  total_ex_gst: number
}
const material = (t: { line_items: Priced[] }) =>
  t.line_items.find((l) => l.source === 'material')!

describe('Phase 4 R2 — a ladder pin decides the product for its tier', () => {
  it('with no ladder, tiers resolve by range/series as before', () => {
    // The baseline this must not disturb. `SAL Anova` has no tier-signalling
    // range, so it wins nothing and the three scored products still map 1:1.
    const t = buildDeterministicTiers(BASE).tiers!
    expect(material(t.good).description).toBe('Standard DL')
    expect(material(t.better).description).toBe('Iconic DL')
    expect(material(t.best).description).toBe('Elite DL')
  })

  it('a Better pin overrides the inferred Better product', () => {
    const t = buildDeterministicTiers({
      ...BASE,
      tierLadder: [{ category: 'downlight', tier: 'better', catalogue_id: 'dl-pinned' }],
    }).tiers!
    expect(material(t.better).description).toBe('SAL Anova')
  })

  it('and leaves the OTHER tiers to resolve their own product', () => {
    // The failure mode worth guarding: a tier-agnostic pin flattens all three
    // tiers to one product, which is the exact bug R4 just fixed elsewhere.
    const t = buildDeterministicTiers({
      ...BASE,
      tierLadder: [{ category: 'downlight', tier: 'better', catalogue_id: 'dl-pinned' }],
    }).tiers!
    expect(material(t.good).description).toBe('Standard DL')
    expect(material(t.best).description).toBe('Elite DL')
    const names = [t.good, t.better, t.best].map((tier) => material(tier).description)
    expect(new Set(names).size, `tiers collapsed: ${names.join(' / ')}`).toBe(3)
  })

  it('prices the pinned product at ITS price, marked up', () => {
    // 25 × 1.25 = 31.25 per unit, × qty 2 = 62.50. If this reads 25.00 the
    // markup was skipped; if it reads the Iconic price the pin did nothing.
    const t = buildDeterministicTiers({
      ...BASE,
      tierLadder: [{ category: 'downlight', tier: 'better', catalogue_id: 'dl-pinned' }],
    }).tiers!
    expect(material(t.better).unit_price_ex_gst).toBeCloseTo(31.25, 5)
    expect(material(t.better).total_ex_gst).toBeCloseTo(62.5, 5)
  })

  it('an empty ladder behaves exactly like no ladder', () => {
    // The loader passes [] for the overwhelming majority of tenants, who have
    // pinned nothing. That path must be byte-identical to today.
    expect(buildDeterministicTiers({ ...BASE, tierLadder: [] }))
      .toEqual(buildDeterministicTiers(BASE))
  })

  it('a pin at every tier gives the tradie all three slots', () => {
    const t = buildDeterministicTiers({
      ...BASE,
      tierLadder: [
        { category: 'downlight', tier: 'good',   catalogue_id: 'dl-best' },
        { category: 'downlight', tier: 'better', catalogue_id: 'dl-pinned' },
        { category: 'downlight', tier: 'best',   catalogue_id: 'dl-good' },
      ],
    }).tiers!
    // Deliberately inverted: the ladder is the tradie's stated choice and
    // outranks the inferred ordering, even when it looks upside down.
    expect(material(t.good).description).toBe('Elite DL')
    expect(material(t.better).description).toBe('SAL Anova')
    expect(material(t.best).description).toBe('Standard DL')
  })

  it('a pin at a product this tenant no longer stocks falls back, never throws', () => {
    // catalogue_id has an ON DELETE CASCADE FK so a deleted product takes its
    // ladder row with it — but an INACTIVE or wrong-trade product survives in
    // the ladder while being filtered out of the loaded catalogue. Silent
    // fall-through to scoring is the correct outcome; a hole in the quote or
    // a throw is not.
    const t = buildDeterministicTiers({
      ...BASE,
      tierLadder: [{ category: 'downlight', tier: 'better', catalogue_id: 'not-in-catalogue' }],
    }).tiers!
    expect(material(t.better).description).toBe('Iconic DL')
  })

  it('a pin in a category this job does not use changes nothing', () => {
    // Categories are shared across trades (`sundries` exists in both). A
    // plumbing pin must not reach an electrical job.
    const t = buildDeterministicTiers({
      ...BASE,
      tierLadder: [{ category: 'toilet', tier: 'better', catalogue_id: 'dl-pinned' }],
    }).tiers!
    expect(material(t.better).description).toBe('Iconic DL')
  })

  it('is still deterministic — same ladder twice, same quote', () => {
    const ladder = [{ category: 'downlight', tier: 'better' as const, catalogue_id: 'dl-pinned' }]
    expect(buildDeterministicTiers({ ...BASE, tierLadder: ladder }))
      .toEqual(buildDeterministicTiers({ ...BASE, tierLadder: ladder }))
  })
})
