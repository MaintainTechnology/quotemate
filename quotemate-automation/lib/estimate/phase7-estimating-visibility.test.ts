// Phase 7 — a job with no recipe must still appear in the Estimating tab.
//
// THE BUG. /api/tenant/estimation built its job list by iterating
// shared_assembly_bom rows with `shared_assemblies!inner`. That is an inner
// join in both directions: an assembly with NO recipe rows produces no BOM
// rows, so it never entered the map and was simply absent from the response.
//
// The consequence is the sharp part. The Estimating tab exists so a tradie can
// GIVE a job a recipe — and it hid precisely the jobs that had none. Measured
// against production when this was written: 42 of 65 shared assemblies were
// invisible, including all 14 roofing, both aircon, and 15 of 26 electrical.
//
// The fix fetches assemblies first and attaches BOM rows to them, which is the
// left join the spec asks for without depending on PostgREST embed semantics.
//
// The route cannot be imported here (module-scope Supabase client, no env in
// vitest), so the aggregation is proven against a local copy of the same logic
// and the WIRING is pinned at source level — the idiom this repo already uses
// in tests/internal-route-auth.test.ts, and the lesson from R2: a guard or a
// query nobody calls is not one.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

type Asm = { id: string; name: string; trade: string }
type BomRow = { material_category: string; shared_assemblies: Asm | Asm[] }
type Agg = { id: string; name: string; trade: string; bom: string[] }

/** The route's aggregation, as it now reads: seed from assemblies, then attach
 *  BOM rows. Kept in step with the source by the assertions further down. */
function aggregate(asmRows: Asm[], bomRows: BomRow[]): Agg[] {
  const byAssembly = new Map<string, Agg>()
  for (const a of asmRows) {
    if (!a?.id) continue
    byAssembly.set(a.id, { id: a.id, name: a.name, trade: a.trade, bom: [] })
  }
  for (const r of bomRows) {
    const a = Array.isArray(r.shared_assemblies) ? r.shared_assemblies[0] : r.shared_assemblies
    if (!a) continue
    let agg = byAssembly.get(a.id)
    if (!agg) {
      agg = { id: a.id, name: a.name, trade: a.trade, bom: [] }
      byAssembly.set(a.id, agg)
    }
    agg.bom.push(r.material_category)
  }
  return [...byAssembly.values()]
}

const DL: Asm = { id: 'a-dl', name: 'Install downlight', trade: 'electrical' }
const RR: Asm = { id: 'a-rr', name: 'Re-roof tile', trade: 'roofing' }

describe('Phase 7 — recipe-less jobs are visible', () => {
  it('an assembly with NO recipe still appears, with an empty bom', () => {
    // The whole bug in one assertion. Before the fix this returned [].
    const jobs = aggregate([RR], [])
    expect(jobs).toHaveLength(1)
    expect(jobs[0].name).toBe('Re-roof tile')
    expect(jobs[0].bom).toEqual([])
  })

  it('assemblies WITH a recipe still carry it', () => {
    const jobs = aggregate([DL], [
      { material_category: 'downlight', shared_assemblies: DL },
      { material_category: 'sundries', shared_assemblies: DL },
    ])
    expect(jobs[0].bom).toEqual(['downlight', 'sundries'])
  })

  it('a mixed list returns BOTH kinds, recipe-less included', () => {
    const jobs = aggregate([DL, RR], [{ material_category: 'downlight', shared_assemblies: DL }])
    expect(jobs.map((j) => j.name).sort()).toEqual(['Install downlight', 'Re-roof tile'])
    expect(jobs.find((j) => j.id === 'a-rr')!.bom).toEqual([])
  })

  it('does not duplicate an assembly that appears in both queries', () => {
    const jobs = aggregate([DL], [
      { material_category: 'downlight', shared_assemblies: DL },
      { material_category: 'sundries', shared_assemblies: DL },
    ])
    expect(jobs).toHaveLength(1)
  })

  it('handles the embed arriving as an array, as PostgREST sometimes returns it', () => {
    const jobs = aggregate([], [{ material_category: 'downlight', shared_assemblies: [DL] }])
    expect(jobs).toHaveLength(1)
    expect(jobs[0].bom).toEqual(['downlight'])
  })

  it('a BOM row whose assembly is missing from the list is still kept', () => {
    // Belt and braces: the assembly query is trade-filtered, and a BOM row for
    // an out-of-trade assembly must not be silently dropped OR crash.
    const jobs = aggregate([], [{ material_category: 'gutter', shared_assemblies: RR }])
    expect(jobs).toHaveLength(1)
    expect(jobs[0].bom).toEqual(['gutter'])
  })

  it('an assembly row with no id is skipped rather than keyed on undefined', () => {
    const jobs = aggregate([{ id: '', name: 'junk', trade: 'electrical' }], [])
    expect(jobs).toEqual([])
  })
})

describe('Phase 7 — the route actually does this', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'app', 'api', 'tenant', 'estimation', 'route.ts'),
    'utf8',
  )

  it('queries shared_assemblies directly, not only through the BOM embed', () => {
    // The defect was that this query did not exist at all.
    expect(src).toMatch(/\.from\('shared_assemblies'\)/)
  })

  it('trade-filters the assembly query, so tenants do not see other trades', () => {
    expect(src).toMatch(/asmQ = asmQ\.in\('trade', trades\)/)
  })

  it('seeds byAssembly from the assembly rows BEFORE the BOM loop', () => {
    // Order is the fix. Seeding after the BOM loop would leave the map keyed
    // only by assemblies that already had rows.
    const seed = src.indexOf('for (const a of asmRows ?? [])')
    const bomLoop = src.indexOf('for (const r of (bomRows ?? [])')
    expect(seed).toBeGreaterThan(-1)
    expect(bomLoop).toBeGreaterThan(-1)
    expect(seed).toBeLessThan(bomLoop)
  })

  it('fails the request on an assembly-query error rather than shipping a short list', () => {
    // Silently returning [] here would look identical to "this tenant has no
    // jobs", which is the failure mode being fixed.
    expect(src).toMatch(/if \(asmErr\) return Response\.json/)
  })
})
