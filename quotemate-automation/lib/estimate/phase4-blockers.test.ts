// Phase 4 blockers R1 and R10 — the two changes everything else waits on.
//
// Both are ADDITIVE and inert on their own: R1 selects more columns that
// nothing reads yet, R10 widens a signature so the callee receives more than
// it uses. Neither alters a price. That is why they can land ahead of R3-R12,
// which do change live pricing (DETERMINISTIC_BOM is ON in production).
//
// Source assertions rather than behavioural ones, because a Supabase
// `.select('a, b, c')` is a STRING — a behavioural test cannot see a missing
// column, it just gets undefined and carries on. That is precisely how these
// went unnoticed. Same shape as bom-narrowing-guard.test.ts.
//
// NOTE the spec's line numbers have drifted: it cites run.ts:2014-2021 for R1,
// but the loader's catalogue select is at ~2096 (it moved when Phase 2 added
// scaleBomToItemCount). Anchored on content here, not line numbers.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const runTs = readFileSync(resolve(process.cwd(), 'lib', 'estimate', 'run.ts'), 'utf8')
const catalogueTs = readFileSync(resolve(process.cwd(), 'lib', 'estimate', 'catalogue.ts'), 'utf8')

/** The catalogue select inside loadDeterministicInputs — the one feeding the
 *  deterministic tier builder, not the three other catalogue reads in run.ts. */
function loaderCatalogueSelect(): string {
  const anchor = runTs.indexOf('const input: DeterministicTierInput')
  expect(anchor, 'loadDeterministicInputs not found').toBeGreaterThan(-1)
  const before = runTs.slice(0, anchor)
  const from = before.lastIndexOf("from('tenant_material_catalogue')")
  expect(from, 'no catalogue select before the loader input').toBeGreaterThan(-1)
  // Generous window: the select spans a comment block plus the column list
  // plus the .eq() chain. Too small a slice silently truncates and the
  // assertions below fail for the wrong reason.
  return runTs.slice(from, from + 1200)
}

describe('Phase 4 R1 — the loader must select what the chosen product needs', () => {
  const sel = loaderCatalogueSelect()

  it('selects `properties` — the smart / dimmable / integrated_driver tags', () => {
    // Phase 2b let tradies tag products. Without this column the deterministic
    // path cannot see a tag, so R9 (a smart product pulls in its dimmer part)
    // has nothing to branch on.
    expect(sel).toMatch(/\bproperties\b/)
  })

  it('selects `is_preferred` — the tradie’s go-to product', () => {
    // R6 requires the preferred product always be one of the two SMS options,
    // and R12 ranks it in the precedence order. Both need the column.
    expect(sel).toMatch(/\bis_preferred\b/)
  })

  it('selects `image_path` and `description` — WP4 render metadata', () => {
    expect(sel).toMatch(/\bimage_path\b/)
    expect(sel).toMatch(/\bdescription\b/)
  })

  it('keeps every column it already selected', () => {
    // Widening must not drop anything: a lost column is a silent undefined,
    // not an error.
    for (const col of [
      'id', 'category', 'name', 'brand', 'range_series', 'supplier', 'unit',
      'unit_price_ex_gst', 'customer_supply_price_ex_gst', 'tier_hint', 'active',
    ]) {
      expect(sel, `dropped ${col}`).toMatch(new RegExp(`\\b${col}\\b`))
    }
  })

  it('still scopes to the tenant and to active rows', () => {
    expect(sel).toMatch(/\.eq\('tenant_id'/)
    expect(sel).toMatch(/\.eq\('active', true\)/)
  })
})

describe('Phase 4 R10 — resolveMaterial receives the whole BOM line', () => {
  it('no longer takes a bare category string', () => {
    // `(category: string)` throws away everything else on the line — which is
    // why a recipe line cannot yet pin a specific product (R11) or carry an
    // include_when condition (R7).
    expect(catalogueTs).not.toMatch(/resolveMaterial:\s*\(category:\s*string\)/)
  })

  it('takes the BomLine instead', () => {
    expect(catalogueTs).toMatch(/resolveMaterial:\s*\(\s*line:\s*BomLine\s*\)/)
  })

  it('is called with the whole line, not just the category', () => {
    expect(catalogueTs).toMatch(/input\.resolveMaterial\(\s*b\s*\)/)
    expect(catalogueTs).not.toMatch(/input\.resolveMaterial\(b\.material_category\)/)
  })
})
