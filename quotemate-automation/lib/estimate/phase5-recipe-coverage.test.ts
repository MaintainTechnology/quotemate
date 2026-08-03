// Phase 5 — does the quote match the recipe?
//
// Grounding proves each price traces to a DB row; sanity bounds prove the total
// is not absurd. Neither can see a quote that is MISSING a part the job needs
// or carrying parts it never asked for. A line can be perfectly grounded,
// correctly priced, inside every band, and still be for the wrong product.
//
// Bites hardest on the OPUS path: the recipe is a hint there, and Opus can
// quietly omit a required part or invent extras. On the deterministic path
// buildBomQuoteLines already reports missingRequired, so coverage is close to
// tautological.
//
// SHADOW by default — this returns findings and never decides validity.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { checkRecipeCoverage } from './recipe-coverage'
import type { BomLine } from './catalogue'

const RECIPE: BomLine[] = [
  { material_category: 'downlight', quantity: 6, required: true },
  { material_category: 'safety_switch', quantity: 1, required: true },
  { material_category: 'sundries', quantity: 1, required: false },
]
const line = (description: string, material_category?: string) => ({
  description,
  source: 'material',
  ...(material_category ? { material_category } : {}),
})
const findings = (i: Parameters<typeof checkRecipeCoverage>[0]) => checkRecipeCoverage(i).findings

describe('Phase 5 — required coverage', () => {
  it('a tier covering every required category is clean', () => {
    expect(
      findings({
        recipe: RECIPE,
        tiers: { good: { line_items: [line('LED downlight', 'downlight'), line('RCBO', 'safety_switch')] } },
      }),
    ).toEqual([])
  })

  it('reports a required category with no line', () => {
    const f = findings({
      recipe: RECIPE,
      tiers: { good: { line_items: [line('LED downlight', 'downlight')] } },
    })
    expect(f).toHaveLength(1)
    expect(f[0]).toMatch(/good: recipe requires \[safety_switch\]/)
  })

  it('does NOT report a missing OPTIONAL category', () => {
    // sundries is optional; a job without tape is not a fault.
    const f = findings({
      recipe: RECIPE,
      tiers: { good: { line_items: [line('LED downlight', 'downlight'), line('RCBO', 'safety_switch')] } },
    })
    expect(f.join()).not.toMatch(/sundries/)
  })

  it('does NOT report a required line whose include_when may have dropped it', () => {
    // Phase 4 R7 makes a conditional line legitimately vanish when the product
    // does not need it. Reporting that would make the feature look like a bug.
    const f = findings({
      recipe: [
        { material_category: 'downlight', quantity: 2, required: true },
        { material_category: 'driver', quantity: 1, required: true, include_when: { integrated_driver: false } },
      ],
      tiers: { good: { line_items: [line('Integrated DL', 'downlight')] } },
    })
    expect(f).toEqual([])
  })

  it('matches by DESCRIPTION when no category is stamped — the Opus path', () => {
    // Opus writes prose and never stamps material_category. Without the
    // fallback every Opus line reads as an extra and the check is pure noise.
    expect(
      findings({
        recipe: RECIPE,
        tiers: { good: { line_items: [line('Supply and install LED downlight'), line('New safety switch on the circuit')] } },
      }),
    ).toEqual([])
  })

  it('underscored categories match spaced prose', () => {
    expect(
      findings({
        recipe: [{ material_category: 'safety_switch', quantity: 1, required: true }],
        tiers: { good: { line_items: [line('Install safety switch')] } },
      }),
    ).toEqual([])
  })

  it('checks every priced tier independently', () => {
    const f = findings({
      recipe: RECIPE,
      tiers: {
        good: { line_items: [line('LED downlight', 'downlight'), line('RCBO', 'safety_switch')] },
        better: { line_items: [line('LED downlight', 'downlight')] },
      },
    })
    expect(f).toHaveLength(1)
    expect(f[0]).toMatch(/^better:/)
  })

  it('one line cannot satisfy two categories', () => {
    // A "downlight + driver kit" line satisfying both would hide a real
    // omission. Pairing is one-to-one.
    const f = findings({
      recipe: [
        { material_category: 'downlight', quantity: 1, required: true },
        { material_category: 'driver', quantity: 1, required: true },
      ],
      tiers: { good: { line_items: [line('downlight and driver kit')] } },
    })
    expect(f.join()).toMatch(/driver|downlight/)
    expect(f.length).toBeGreaterThan(0)
  })
})

describe('Phase 5 — the extras allowance', () => {
  const covered = [line('LED downlight', 'downlight'), line('RCBO', 'safety_switch')]

  it('an unmatched line is reported when the allowance is zero', () => {
    const f = findings({
      recipe: RECIPE,
      tiers: { good: { line_items: [...covered, line('Bluetooth speaker', 'audio')] } },
    })
    expect(f).toHaveLength(1)
    expect(f[0]).toMatch(/1 material line\(s\) outside the recipe/)
    expect(f[0]).toMatch(/bluetooth speaker/)
  })

  it('an explicit allowance permits that many extras', () => {
    expect(
      findings({
        recipe: RECIPE,
        extrasAllowance: 1,
        tiers: { good: { line_items: [...covered, line('Bluetooth speaker', 'audio')] } },
      }),
    ).toEqual([])
  })

  it('and reports once the allowance is exceeded', () => {
    const f = findings({
      recipe: RECIPE,
      extrasAllowance: 1,
      tiers: { good: { line_items: [...covered, line('Speaker', 'audio'), line('Doorbell', 'chime')] } },
    })
    expect(f).toHaveLength(1)
    expect(f[0]).toMatch(/2 material line\(s\) outside the recipe \(allowance 1\)/)
  })
})

describe('Phase 5 — what must be ignored', () => {
  it('labour, call-out and after-hours are not recipe parts', () => {
    expect(
      findings({
        recipe: RECIPE,
        tiers: {
          good: {
            line_items: [
              line('LED downlight', 'downlight'),
              line('RCBO', 'safety_switch'),
              { description: 'Labour', source: 'labour' },
              { description: 'Call-out', source: 'callout' },
              { description: 'After hours', source: 'after_hours' },
            ],
          },
        },
      }),
    ).toEqual([])
  })

  it('a tradie-typed manual line is not an extra', () => {
    // Grounded by the human who typed it; the validator exempts it too.
    expect(
      findings({
        recipe: RECIPE,
        tiers: {
          good: {
            line_items: [
              line('LED downlight', 'downlight'),
              line('RCBO', 'safety_switch'),
              { description: 'Remove existing fitting', source: 'tradie_manual' },
            ],
          },
        },
      }),
    ).toEqual([])
  })

  it('no recipe means nothing to compare — not "everything is an extra"', () => {
    expect(findings({ recipe: [], tiers: { good: { line_items: [line('anything')] } } })).toEqual([])
    expect(findings({ tiers: { good: { line_items: [line('anything')] } } })).toEqual([])
  })

  it('a null or line-less tier is skipped, not reported as empty', () => {
    expect(findings({ recipe: RECIPE, tiers: { good: null, better: { line_items: [] } } })).toEqual([])
  })

  it('recipe rows with a blank category are ignored', () => {
    expect(
      findings({
        recipe: [{ material_category: '  ', quantity: 1, required: true }] as BomLine[],
        tiers: { good: { line_items: [line('anything')] } },
      }),
    ).toEqual([])
  })

  it('is pure — same input twice, same findings', () => {
    const i = { recipe: RECIPE, tiers: { good: { line_items: [line('LED downlight', 'downlight')] } } }
    expect(checkRecipeCoverage(i)).toEqual(checkRecipeCoverage(i))
  })
})

// ── the wiring ──────────────────────────────────────────────────────────
//
// Added for the same reason as Phase 5b's: a mutation there proved that
// disabling the run.ts call left the whole lib/estimate suite green. A guard
// nobody calls is not a guard — the R2 defect exactly. runEstimation cannot be
// imported (module-scope Supabase client, no env in vitest), so the wiring is
// asserted at the source level.
describe('Phase 5 — run.ts actually calls it', () => {
  const runTs = readFileSync(resolve(process.cwd(), 'lib', 'estimate', 'run.ts'), 'utf8')

  it('imports checkRecipeCoverage', () => {
    expect(runTs).toMatch(/import \{ checkRecipeCoverage \} from '\.\/recipe-coverage'/)
  })

  it('calls it with the three tiers and the hoisted recipe', () => {
    expect(runTs).toMatch(/checkRecipeCoverage\(\{/)
    expect(runTs).toMatch(/recipe: phase5Recipe/)
  })

  it('captures the recipe BEFORE the deterministic build, so a bailed build still has it', () => {
    // The valuable case: the builder gives up, the draft falls back to Opus,
    // and we still know what the job was meant to contain. Capturing after the
    // build would lose exactly that.
    const capture = runTs.indexOf('phase5Recipe = loaded.input.bom')
    const build = runTs.indexOf('const built = buildDeterministicTiers(loaded.input)')
    expect(capture).toBeGreaterThan(-1)
    expect(build).toBeGreaterThan(-1)
    expect(capture).toBeLessThan(build)
  })

  it('uses the NAMED extras allowance, not an inline number', () => {
    expect(runTs).toMatch(/extrasAllowance: PHASE5_EXTRAS_ALLOWANCE/)
    expect(runTs).toMatch(/const PHASE5_EXTRAS_ALLOWANCE = \d+/)
  })

  it('surfaces findings as [recipe-coverage] risk flags', () => {
    expect(runTs).toMatch(/\[recipe-coverage\]/)
  })

  it('is SHADOW — no tier nulling, no inspection downgrade', () => {
    // The guarantee that makes shadow real. A future edit that enforces has to
    // do it deliberately rather than by drift.
    const from = runTs.indexOf('const coverage = checkRecipeCoverage({')
    const block = runTs.slice(from, from + 1200)
    expect(from).toBeGreaterThan(-1)
    expect(block).not.toMatch(/draft\[(?:t|tier)\] = null/)
    expect(block).not.toMatch(/needs_inspection/)
    expect(block).not.toMatch(/forcedInspection/)
  })
})
