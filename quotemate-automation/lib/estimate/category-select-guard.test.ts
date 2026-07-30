// Phase 2 R2 — the guard against the regression the spec warned about.
//
// THE TRAP: both the Recipes and the Catalogue category selects were fed from
// CATEGORIES. Because both offered `fan`, a recipe line saying `fan` and a
// product stamped `fan` agreed, so three of one tenant's ceiling fans priced
// correctly BY ACCIDENT. Changing Recipes alone to offer `ceiling_fan` would
// have broken them.
//
// So the requirement is not "Recipes uses the new list" — it is "NEITHER select
// uses CATEGORIES". A future edit that reverts one of them passes every
// behavioural test while silently re-opening the mismatch, which is exactly what
// a source assertion catches and a unit test cannot.
//
// Same shape as lib/estimate/bom-narrowing-guard.test.ts.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const page = readFileSync(resolve(process.cwd(), 'app', 'dashboard', 'page.tsx'), 'utf8')

/** The JSX option-list expression inside each `<select>`, by its neighbouring
 *  label text — the only stable way to tell the two selects apart in a
 *  17k-line file. */
function selectAfter(labelText: string): string {
  const at = page.indexOf(labelText)
  expect(at, `label "${labelText}" not found`).toBeGreaterThan(-1)
  const open = page.indexOf('<select', at)
  const close = page.indexOf('</select>', open)
  expect(open).toBeGreaterThan(-1)
  expect(close).toBeGreaterThan(open)
  return page.slice(open, close)
}

describe('Phase 2 R2 — neither category select is fed from CATEGORIES', () => {
  it('the Recipes "Material category" select uses materialCategoriesFor', () => {
    const sel = selectAfter('>Material category<')
    expect(sel).toContain('materialCategoriesFor(')
    expect(sel, 'still fed from the grounding vocabulary').not.toContain('CATEGORIES.map')
  })

  it('the Catalogue "Category" select uses materialCategoriesFor — the trap', () => {
    // Fixing only Recipes breaks six working products. Both, or neither.
    const sel = selectAfter('>Category</span>')
    expect(sel).toContain('materialCategoriesFor(')
    expect(sel, 'still fed from the grounding vocabulary').not.toContain('CATEGORIES.map')
  })

  it('both selects are trade-scoped, not global', () => {
    expect(selectAfter('>Material category<')).toMatch(/materialCategoriesFor\(\s*selectedAsm\.trade\s*\)/)
    expect(selectAfter('>Category</span>')).toMatch(/materialCategoriesFor\(\s*form\.trade\s*\)/)
  })

  it('CATEGORIES is still imported and used — its three real consumers remain', () => {
    // Constraint: categories.ts stays untouched, and the dashboard's OTHER
    // category surfaces (custom services, catalogue grouping) still read it.
    expect(page).toContain("from '@/lib/estimate/categories'")
    expect(page).toContain('CATEGORIES.map')
  })

  it('R7 — the helper text that caused the problem is gone', () => {
    expect(page).not.toContain('Pick the same category you use in Catalogue')
  })
})
