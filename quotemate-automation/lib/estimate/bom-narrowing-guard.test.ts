// Phase 1 regression guard — the BOM read must stay scoped to ONE assembly.
//
// Before Phase 1 both lookup sites did `const ids = asm.map(a => a.id)` and fed
// that into `.in('assembly_id', ids)`. That was harmless only because the old
// `ilike` matched at most one row. Once the OR filter widened the candidate pool
// (power_points -> 5 rows, ceiling_fans -> 5), the same code would concatenate
// recipe lines from several unrelated assemblies into a single BOM: a
// ceiling_fans quote mixing exhaust-fan, AC-fan and DC-fan-with-wall-control
// parts, with labour hours taken from whichever row Postgres returned first.
//
// buildBomHint and loadDeterministicInputs are module-private, and exporting
// them purely to test this would widen run.ts's public surface for no runtime
// reason. A source assertion is the cheaper honest guard, and the repo already
// uses this shape (see lib/roofing/edge-analysis-migration.test.ts, which
// regex-asserts migration SQL text).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(resolve(process.cwd(), 'lib', 'estimate', 'run.ts'), 'utf8')

describe('Phase 1 — BOM reads stay narrowed to one assembly', () => {
  it('never rebuilds a multi-id list from the candidate pool', () => {
    // The exact fan-out that Phase 1 removed. If this reappears, a widened
    // candidate pool silently produces a mixed recipe.
    expect(SRC).not.toMatch(/const\s+ids\s*=\s*asm\s*\.\s*map/)
  })

  it('builds the id list from the single resolved assembly', () => {
    const singles = SRC.match(/const\s+ids\s*=\s*\[\s*(?:chosen|primary)\.id\s*\]/g) ?? []
    // One per lookup site: buildBomHint and loadDeterministicInputs.
    expect(singles.length).toBe(2)
  })

  it('no longer resolves the assembly by a bare pluralised ilike', () => {
    // `ilike('name', '%<job type with spaces>%')` is the original defect: it
    // matched only 2 of 10 electrical job types.
    expect(SRC).not.toMatch(/\.ilike\(\s*'name'\s*,\s*`%\$\{term\}%`\s*\)/)
  })

  it('records an unresolved job_type to pipeline_traces, not just the console', () => {
    // pipelineLog is console-only — it does NOT write pipeline_traces — so a
    // log line alone leaves a resolution miss invisible to an operator. Once
    // DETERMINISTIC_BOM is enabled a silent miss is the difference between a
    // recipe-built quote and an AI-drafted one that nobody notices.
    expect(SRC).toMatch(/substep:\s*'bom_hint_unresolved'/)
    // Must be a warn, not an ok — it is a degradation, not normal operation.
    const block = SRC.slice(
      Math.max(0, SRC.indexOf("substep: 'bom_hint_unresolved'") - 300),
      SRC.indexOf("substep: 'bom_hint_unresolved'"),
    )
    expect(block).toMatch(/trace\(\s*'estimate'\s*,\s*'warn'/)
  })

  it('routes both lookup sites through ONE shared resolver', () => {
    // Both call sites resolve via resolveJobAssembly...
    const callSites = SRC.match(/await\s+resolveJobAssembly\(/g) ?? []
    expect(callSites.length).toBe(2)
    // ...and the resolution primitives appear exactly once, inside it. Two
    // occurrences would mean the duplication the spec removed has crept back
    // — which is how the two sites drifted out of sync in the first place.
    expect((SRC.match(/pickBestAssembly\(/g) ?? []).length).toBe(1)
    expect((SRC.match(/buildAssemblyOrFilter\(/g) ?? []).length).toBe(1)
  })
})
