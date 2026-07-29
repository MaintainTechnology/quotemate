// Phase 1 live verification — does the resolver work against the REAL catalogue?
//
// job-assembly-resolve.test.ts proves the resolver against a fixture I built by
// reading sql/. That fixture is the risk: JOB_TYPE_ASSEMBLY maps each job type
// to an EXACT assembly name, so one character of drift between my fixture and
// production means that job type silently resolves to null and falls back to
// Opus — with every unit test still green. Only the live catalogue can settle it.
//
// This is also the measurement the whole staged plan hinges on. Baseline before
// Phase 1: 2 of 10 electrical job types resolved at all, 1 reached a recipe.
//
// READ-ONLY. Two selects, no writes.
//
// SKIPPED unless LIVE_DB is set:
//   LIVE_DB=1 node --env-file=.env.local \
//     ./node_modules/vitest/vitest.mjs run lib/estimate/live-job-assembly-resolve.test.ts \
//     --testTimeout=120000

import { describe, it, expect } from 'vitest'
import pg from 'pg'
import { pickBestAssembly, buildAssemblyOrFilter, JOB_TYPE_ASSEMBLY } from './assembly-search'

const ELECTRICAL_JOB_TYPES = [
  'downlights',
  'power_points',
  'ceiling_fans',
  'smoke_alarms',
  'outdoor_lighting',
  'switchboard',
  'oven_cooktop',
  'ev_charger',
  'fault_finding',
  'renovation',
] as const

// Job types with no assembly in the catalogue — resolving to null is correct.
const INSPECTION_ONLY = new Set(['switchboard', 'renovation'])

type AsmRow = { id: string; name: string; category: string | null; has_bom: boolean }

describe.skipIf(!process.env.LIVE_DB)('Phase 1 — resolver vs the LIVE catalogue', () => {
  it('resolves every electrical job type against real rows', { timeout: 120_000 }, async () => {
    const client = new pg.Client({
      connectionString: process.env.SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
    })
    await client.connect()

    try {
      const { rows } = await client.query<AsmRow>(`
        select a.id, a.name, a.category,
               exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id) as has_bom
        from shared_assemblies a
        where a.trade = 'electrical'
        order by a.name
      `)

      console.log(`\nlive electrical assemblies: ${rows.length}`)
      console.log(`  with a BOM: ${rows.filter((r) => r.has_bom).length}`)

      // Every name the map points at must actually exist in production. This is
      // the fixture-drift check — the whole reason this test exists.
      const liveNames = new Set(rows.map((r) => r.name.trim().toLowerCase()))
      const missing = Object.entries(JOB_TYPE_ASSEMBLY).filter(
        ([, name]) => !liveNames.has(name.trim().toLowerCase()),
      )
      if (missing.length > 0) {
        console.log('\nMAPPED NAMES NOT PRESENT IN PROD:')
        for (const [jt, name] of missing) console.log(`  ${jt} -> "${name}"`)
      }

      let resolved = 0
      let withRecipe = 0
      const report: string[] = []

      for (const jobType of ELECTRICAL_JOB_TYPES) {
        // Same candidate fetch the resolver uses in run.ts, so this measures the
        // real path rather than a convenient shortcut.
        const filter = buildAssemblyOrFilter(jobType.replace(/_/g, ' '))
        const terms = filter
          .split(',')
          .map((c) => c.replace(/^name\.ilike\.%/, '').replace(/%$/, ''))
          .filter((t) => t.length > 0)
        const candidates = rows.filter((r) =>
          terms.some((t) => r.name.toLowerCase().includes(t.toLowerCase())),
        )

        const won = pickBestAssembly(jobType, candidates)
        if (won) {
          resolved++
          if (won.has_bom) withRecipe++
        }
        report.push(
          `  ${jobType.padEnd(17)} candidates=${String(candidates.length).padStart(2)} ` +
            `-> ${won ? `"${won.name}"${won.has_bom ? ' [BOM]' : ' [no BOM]'}` : 'null'}`,
        )
      }

      console.log('\nresolution against the live catalogue:')
      for (const line of report) console.log(line)
      console.log(`\n  resolved: ${resolved}/${ELECTRICAL_JOB_TYPES.length}`)
      console.log(`  reaching a recipe: ${withRecipe}`)
      console.log('  (baseline before Phase 1 was 2 resolved, 1 with a recipe)')

      // Hard assertions.
      expect(missing, `JOB_TYPE_ASSEMBLY points at names absent from prod`).toEqual([])

      for (const jobType of ELECTRICAL_JOB_TYPES) {
        const filter = buildAssemblyOrFilter(jobType.replace(/_/g, ' '))
        const terms = filter
          .split(',')
          .map((c) => c.replace(/^name\.ilike\.%/, '').replace(/%$/, ''))
          .filter((t) => t.length > 0)
        const candidates = rows.filter((r) =>
          terms.some((t) => r.name.toLowerCase().includes(t.toLowerCase())),
        )
        const won = pickBestAssembly(jobType, candidates)
        if (INSPECTION_ONLY.has(jobType)) {
          expect(won, `${jobType} must stay on the inspection route`).toBeNull()
        } else {
          expect(won, `${jobType} failed to resolve against the live catalogue`).not.toBeNull()
        }
      }

      // The point of the phase: strictly better than the 1 recipe we started with.
      expect(withRecipe).toBeGreaterThan(1)
    } finally {
      await client.end()
    }
  })
})
