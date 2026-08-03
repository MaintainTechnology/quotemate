// Phase 5 — does the quote match the recipe?
//
// Per-line grounding proves each PRICE traces to a DB row. Sanity bounds prove
// the TOTAL is not absurd. Neither can see that a quote is missing a part the
// job needs, or carries three parts the job never asked for: a line can be
// perfectly grounded, correctly priced, inside every band, and still be for a
// product that has nothing to do with the job.
//
// WHERE THIS ACTUALLY BITES: the Opus path. On the deterministic path
// buildBomQuoteLines already walks the recipe and reports missingRequired, so
// coverage is close to tautological there. Opus, by contrast, is handed the
// recipe as a HINT and can quietly omit a required part or invent extras. That
// is the gap Phase 5 exists to see.
//
// SHADOW BY DEFAULT, per the spec, matching lib/estimate/spec-guard.ts. This
// module returns findings; it never decides validity. The caller surfaces them
// as risk_flags. Deliberate: the recipe is a description of the USUAL job, and
// a real job legitimately varies — an extra GPO because the wall was already
// open, a part skipped because the customer supplied it. Enforcing on day one
// would route honest quotes to the $99 inspection, which this phase has
// already done once by accident. Watch first, then choose.
//
// ⚠ DEPARTURE FROM THE SPEC'S WORDING. Phase 5 says "give
// validateQuoteGrounding the intake and the resolved BOM". This is a sibling
// pure function instead, called next to the validator rather than inside it.
// Two reasons. Shadow mode means the result must NOT affect `valid`, and
// threading a check into the validator only to ignore its verdict muddies the
// one contract in this codebase that must stay unambiguous: a false from
// validateQuoteGrounding means "do not ship this price". Second, ~8 callers
// share that signature and none of them have a recipe to pass.
//
// Pure and I/O-free, so it is directly unit-testable.

import type { BomLine } from './catalogue'

/** Material lines as they appear on a built tier. */
export type CoverageLine = {
  description?: string | null
  source?: string | null
  material_category?: string | null
}

export type CoverageInput = {
  /** The tiers present on the draft. A null tier is simply not checked. */
  tiers: Partial<Record<'good' | 'better' | 'best', { line_items?: CoverageLine[] | null } | null>>
  /** The recipe this job resolved to. Empty/absent = nothing to compare. */
  recipe?: readonly BomLine[] | null
  /** How many material lines beyond the recipe are acceptable before it is
   *  worth reporting. A real job varies; this is the explicit allowance the
   *  spec asks for rather than a hidden tolerance. */
  extrasAllowance?: number
}

export type CoverageResult = { findings: string[] }

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()

/** Non-material lines are out of scope: labour, call-out, after-hours and
 *  tradie-typed manual lines are not recipe parts and never were. */
const isMaterialLine = (l: CoverageLine) => {
  const s = norm(l.source)
  return s === '' || s === 'material' || s.startsWith('material:')
}

/**
 * Compare each priced tier against the recipe.
 *
 * Reports two things:
 *   · a `required` recipe category with no matching line on a tier
 *   · more unmatched material lines on a tier than the extras allowance
 *
 * A line is matched to a recipe category by `material_category` when the
 * builder stamped one, else by the category name appearing in the line's
 * description. The description fallback exists because Opus writes prose
 * ("Supply and install LED downlight") and never stamps a category — without
 * it every Opus line would read as an extra and the check would be noise.
 */
export function checkRecipeCoverage(input: CoverageInput): CoverageResult {
  const recipe = (input.recipe ?? []).filter((r) => norm(r.material_category) !== '')
  if (recipe.length === 0) return { findings: [] }

  const allowance = Number.isFinite(Number(input.extrasAllowance))
    ? Math.max(0, Number(input.extrasAllowance))
    : 0
  const findings: string[] = []

  for (const tierKey of ['good', 'better', 'best'] as const) {
    const tier = input.tiers[tierKey]
    if (!tier || !Array.isArray(tier.line_items)) continue
    const lines = tier.line_items.filter(isMaterialLine)
    if (lines.length === 0) continue

    // Each line may satisfy at most one recipe category, and each category is
    // satisfied by at most one line. Without the pairing, one "downlight +
    // driver kit" line would satisfy both categories and hide a real omission.
    const unmatched = new Set(lines.map((_, i) => i))
    const missing: string[] = []

    for (const row of recipe) {
      const cat = norm(row.material_category)
      let hit = -1
      for (const i of unmatched) {
        const l = lines[i]
        if (norm(l.material_category) === cat) { hit = i; break }
      }
      if (hit < 0) {
        for (const i of unmatched) {
          if (norm(lines[i].description).includes(cat.replace(/_/g, ' '))) { hit = i; break }
        }
      }
      if (hit >= 0) unmatched.delete(hit)
      // Only a REQUIRED category is a finding. An optional one is expected to
      // come and go, and after Phase 4 R7 a conditional line is expected to
      // vanish whenever its condition says the part is not needed — reporting
      // that would make the feature look like a fault.
      else if ((row.required ?? true) && !row.include_when) missing.push(cat)
    }

    if (missing.length > 0) {
      findings.push(
        `${tierKey}: recipe requires [${missing.join(', ')}] but no line covers ` +
          `${missing.length === 1 ? 'it' : 'them'}`,
      )
    }
    if (unmatched.size > allowance) {
      const extras = [...unmatched].map((i) => norm(lines[i].description) || '(unnamed)')
      findings.push(
        `${tierKey}: ${unmatched.size} material line(s) outside the recipe ` +
          `(allowance ${allowance}) — ${extras.slice(0, 4).join(' | ')}`,
      )
    }
  }

  return { findings }
}
