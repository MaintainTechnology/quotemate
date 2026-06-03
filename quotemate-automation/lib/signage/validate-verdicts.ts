// ════════════════════════════════════════════════════════════════════
// Signage Compliance — the grounding / safety backstop.
//
// Mirrors lib/estimate/validate.ts: a deterministic layer that runs AFTER
// the vision pass and converts anything the model couldn't ground into
// the SAFE fallback. In roofing the safe fallback is "$99 inspection";
// here it is "needs HQ review" (a cannot_determine verdict).
//
// It produces ONE verdict for EVERY applicable rule (not just the auto
// ones), so an assessment always covers the studio's full rule scope.
//
// Four downgrades, each a transposition of a validate.ts guarantee:
//   1. Applicability gate — only auto_vision rules may carry a model
//      verdict; everything else is materialised as cannot_determine with
//      a fixed reason. The legally-loaded rules are ARCHITECTURALLY
//      incapable of an automated pass/fail.
//   2. Confidence floor — low confidence (or medium where the registry
//      prior is high) → cannot_determine. A pass/fail only survives high.
//   3. Missing verdict → cannot_determine.
//   4. Evidence-required — a non_compliant with empty evidence →
//      cannot_determine (you can't fail a franchisee without a reason).
//
// Rollup gravity defaults toward needs_review.
// ════════════════════════════════════════════════════════════════════

import type {
  AssessmentOverall,
  RuleVerdict,
  SignageRule,
  VerdictCounts,
} from './types'

const NON_AUTO_REASON: Record<string, string> = {
  needs_scale_reference:
    'Requires a measurement (a tape or known object in frame) — routed to HQ review.',
  needs_metadata_or_context:
    'Requires information not in a photo (paint SKU, HQ approval, or landlord letter) — routed to HQ review.',
  human_review_only: 'Subjective or legal determination — routed to HQ review.',
}

export type ValidateResult = {
  /** One verdict per rule in `rules`, after downgrades. */
  verdicts: RuleVerdict[]
  overall: AssessmentOverall
  counts: VerdictCounts
}

/**
 * PURE. Ground the model's verdicts against the studio's rule set.
 *
 * @param rules        the studio's applicable rules (all applicability classes)
 * @param modelVerdicts the raw verdicts the vision pass returned (auto rules only)
 */
export function validateSignageAssessment(
  rules: SignageRule[],
  modelVerdicts: RuleVerdict[],
): ValidateResult {
  const byKey = new Map<string, RuleVerdict>()
  for (const v of modelVerdicts) {
    // Last-writer-wins is fine; rule_keys should be unique per shot, but a
    // rule can be scored by more than one shot — keep the most decisive.
    const prev = byKey.get(v.rule_key)
    if (!prev || decisiveness(v) > decisiveness(prev)) byKey.set(v.rule_key, v)
  }

  const verdicts: RuleVerdict[] = rules.map((rule) => groundOne(rule, byKey.get(rule.rule_key)))

  const counts = tally(verdicts)
  const overall: AssessmentOverall =
    counts.fix > 0 ? 'fix_needed' : counts.review > 0 ? 'needs_review' : 'pass'

  return { verdicts, overall, counts }
}

/** Ground a single rule into its final verdict. */
function groundOne(rule: SignageRule, model: RuleVerdict | undefined): RuleVerdict {
  // Downgrade 1 — applicability gate. Non-auto rules are never auto-decided.
  if (rule.applicability !== 'auto_vision') {
    return {
      rule_key: rule.rule_key,
      status: 'cannot_determine',
      confidence: 'low',
      evidence: NON_AUTO_REASON[rule.applicability] ?? 'Routed to HQ review.',
      red_flags: [],
    }
  }

  // Downgrade 3 — no model verdict for an auto rule.
  if (!model) {
    return {
      rule_key: rule.rule_key,
      status: 'cannot_determine',
      confidence: 'low',
      evidence: 'No verdict returned — routed to HQ review.',
      red_flags: [],
    }
  }

  // cannot_determine passes straight through.
  if (model.status === 'cannot_determine') {
    return { ...model, rule_key: rule.rule_key }
  }

  // Downgrade 4 — a fail with no stated evidence can't stand.
  if (model.status === 'non_compliant' && model.evidence.trim() === '') {
    return {
      rule_key: rule.rule_key,
      status: 'cannot_determine',
      confidence: 'low',
      evidence: 'Flagged non-compliant without a photo-grounded reason — routed to HQ review.',
      red_flags: model.red_flags,
    }
  }

  // Downgrade 2 — confidence floor. A pass/fail only survives at high
  // confidence (or medium where the registry itself only claims medium).
  if (!confidenceSurvives(model.confidence, rule.confidence)) {
    return {
      rule_key: rule.rule_key,
      status: 'cannot_determine',
      confidence: model.confidence,
      evidence: `Model not confident enough to decide automatically — routed to HQ review.`,
      red_flags: model.red_flags,
    }
  }

  return { ...model, rule_key: rule.rule_key }
}

/** A compliant/non_compliant survives only when the model is at least as
 *  sure as the rule's registry prior allows:
 *    - registry 'high'   ⇒ require model 'high'
 *    - registry 'medium' ⇒ require model 'high' or 'medium'
 *    - registry 'low'    ⇒ a low-prior rule should not have shipped as
 *      auto; require 'high' to be safe. */
function confidenceSurvives(
  model: 'high' | 'medium' | 'low',
  registry: 'high' | 'medium' | 'low',
): boolean {
  if (model === 'low') return false
  if (registry === 'high') return model === 'high'
  if (registry === 'medium') return model === 'high' || model === 'medium'
  return model === 'high'
}

function decisiveness(v: RuleVerdict): number {
  // Prefer a decisive verdict over cannot_determine; among decisive,
  // prefer higher confidence. Used when two shots scored the same rule.
  const statusScore = v.status === 'cannot_determine' ? 0 : 2
  const confScore = v.confidence === 'high' ? 2 : v.confidence === 'medium' ? 1 : 0
  return statusScore + confScore
}

export function tally(verdicts: RuleVerdict[]): VerdictCounts {
  let compliant = 0
  let fix = 0
  let review = 0
  for (const v of verdicts) {
    if (v.status === 'compliant') compliant += 1
    else if (v.status === 'non_compliant') fix += 1
    else review += 1
  }
  return { compliant, fix, review }
}
