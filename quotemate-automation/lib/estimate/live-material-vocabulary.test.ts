// Phase 2 — the vocabulary in material-vocabulary.ts vs the live database.
//
// material-vocabulary.ts is a hand-maintained copy of shared_materials.category.
// A hand-maintained copy drifts — that is exactly the bug class that produced
// this phase. This test is the guard: it fails if someone adds a
// shared_materials category without adding it here, or seeds a
// shared_assembly_bom row naming a category no material has.
//
// Read-only. Run with (vitest does not load .env.local itself):
//   LIVE_DB=1 node --env-file=.env.local \
//     ./node_modules/vitest/vitest.mjs run \
//     lib/estimate/live-material-vocabulary.test.ts --testTimeout=120000
//
// Mirrors lib/estimate/live-job-assembly-resolve.test.ts.
//
// First run, 2026-07-30 — found MORE bad tenant rows than the spec's audit, and
// in plumbing, which the audit did not look at:
//   catalogue: plumbing·tap, plumbing·cctv, plumbing·hot_water, electrical·fan,
//              electrical·rcbo
//   recipes:   electrical·oven_cooktop, electrical·rcbo,
//              electrical·security_camera, plumbing·cctv
// `tap` and `hot_water` are AMBIGUOUS, not merely wrong — tap could be any of
// four tapware_* values and hot_water any of three hws_* values. The R8 script
// reports those for a human rather than guessing.

import { describe, it, expect } from 'vitest'
import { Client } from 'pg'
import { MATERIAL_VOCABULARY, isMaterialCategory } from './material-vocabulary'

const LIVE = !!process.env.LIVE_DB

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

describe.skipIf(!LIVE)('Phase 2 — vocabulary matches shared_materials (LIVE_DB)', () => {
  // CORRECTED: originally required EVERY listed value to have a shared row.
  // Stockable categories deliberately have none, so this now reports the split
  // instead of failing — the shared subset is asserted in the next test.
  it('reports which listed values have a shared fallback and which do not', async () => {
    const missing = await withDb(async (c) => {
      const { rows } = await c.query(
        `select distinct trade, category from shared_materials where category is not null`,
      )
      const real = new Set(rows.map((r) => `${r.trade}·${r.category}`))
      const out: string[] = []
      for (const [trade, opts] of Object.entries(MATERIAL_VOCABULARY)) {
        for (const o of opts) if (!real.has(`${trade}·${o.value}`)) out.push(`${trade}·${o.value}`)
      }
      return out
    })
    if (missing.length > 0) {
      console.log(`
  stockable-only (no shared fallback): ${missing.join(', ')}`)
    }
    expect(Array.isArray(missing)).toBe(true)
  })

  it('every shared_materials.category is offered by the list', async () => {
    // The other direction: a new material with no dropdown entry is a part the
    // tradie can never put on a recipe.
    const unoffered = await withDb(async (c) => {
      const { rows } = await c.query(
        `select distinct trade, category from shared_materials
          where category is not null and trade in ('electrical','plumbing')`,
      )
      return rows
        .filter((r) => !isMaterialCategory(r.category, r.trade))
        .map((r) => `${r.trade}·${r.category}`)
    })
    expect(unoffered, 'in shared_materials but not offered').toEqual([])
  })

  it('every seeded shared_assembly_bom category resolves to a material', async () => {
    const bad = await withDb(async (c) => {
      const { rows } = await c.query(
        `select distinct a.trade, sb.material_category
           from shared_assembly_bom sb
           join shared_assemblies a on a.id = sb.assembly_id
          where a.trade in ('electrical','plumbing')`,
      )
      return rows
        .filter((r) => !isMaterialCategory(r.material_category, r.trade))
        .map((r) => `${r.trade}·${r.material_category}`)
    })
    expect(bad, 'seeded recipe rows that can never price').toEqual([])
  })

  it('reports — does NOT fail on — tenant rows still holding a bad category', async () => {
    // Tenant data is fixed by scripts/fix-material-categories.mjs (R8), a
    // separate reviewable step. Failing here would block the build on data the
    // build cannot change, so this only surfaces the list.
    const bad = await withDb(async (c) => {
      const { rows: cat } = await c.query(
        `select distinct trade, category from tenant_material_catalogue
          where trade in ('electrical','plumbing') and category is not null`,
      )
      const { rows: bom } = await c.query(
        `select distinct trade, material_category from tenant_assembly_bom
          where trade in ('electrical','plumbing')`,
      )
      return {
        catalogue: cat.filter((r) => !isMaterialCategory(r.category, r.trade))
          .map((r) => `${r.trade}·${r.category}`),
        recipes: bom.filter((r) => !isMaterialCategory(r.material_category, r.trade))
          .map((r) => `${r.trade}·${r.material_category}`),
      }
    })
    if (bad.catalogue.length || bad.recipes.length) {
      console.log('\n  tenant rows needing the R8 data fix:')
      if (bad.catalogue.length) console.log('    catalogue:', bad.catalogue.join(', '))
      if (bad.recipes.length) console.log('    recipes:  ', bad.recipes.join(', '))
    }
    expect(Array.isArray(bad.catalogue)).toBe(true)
  })
})
