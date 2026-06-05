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
  // An EMPTY rule set is not a pass — it means the studio was never checked
  // (e.g. the brand has no rules loaded, or the requested shots matched none).
  // A vacuous 'pass' here would show a false green on the HQ dashboard while
  // the per-rule report is blank. Route it to HQ review instead — the same
  // "never a false pass" posture as every other downgrade in this file.
  const overall: AssessmentOverall =
    rules.length === 0
      ? 'needs_review'
      : counts.fix > 0
        ? 'fix_needed'
        : counts.review > 0
          ? 'needs_review'
          : 'pass'

  return { verdicts, overall, counts }
}

/** Build a cannot_determine ("needs HQ review") verdict for a rule. */
function review(rule: SignageRule, evidence: string, redFlags: string[] = []): RuleVerdict {
  return { rule_key: rule.rule_key, status: 'cannot_determine', confidence: 'low', evidence, red_flags: redFlags }
}

function reviewReason(rule: SignageRule): string {
  if (rule.verdict_mode === 'needs_reference') {
    return 'Requires a tape measure or known object in frame — routed to HQ review (Phase 2).'
  }
  return NON_AUTO_REASON[rule.applicability] ?? 'Routed to HQ review.'
}

/** Ground a single rule into its final verdict, keyed on verdict_mode. */
function groundOne(rule: SignageRule, model: RuleVerdict | undefined): RuleVerdict {
  const mode = rule.verdict_mode

  // review / needs_reference are never auto-decided — materialise as review.
  if (mode === 'review' || mode === 'needs_reference') {
    return review(rule, reviewReason(rule))
  }

  // pass_fail + detect_only expect a model verdict.
  if (!model) return review(rule, 'No verdict returned — routed to HQ review.')
  if (model.status === 'cannot_determine') return { ...model, rule_key: rule.rule_key }

  if (mode === 'detect_only') {
    // The AI may FLAG a violation but never CERTIFY compliance.
    if (model.status === 'compliant') {
      return review(rule, "Looks right, but this rule can't be auto-certified from a photo — routed to HQ review.", model.red_flags)
    }
    // non_compliant — must be evidenced and confident enough to accuse.
    if (model.evidence.trim() === '') {
      return review(rule, 'Possible issue flagged without a photo-grounded reason — routed to HQ review.', model.red_flags)
    }
    if (!confidenceSurvives(model.confidence, rule.confidence)) {
      return review(rule, 'Possible issue but not confident enough to flag — routed to HQ review.', model.red_flags)
    }
    return { ...model, rule_key: rule.rule_key } // keep the violation
  }

  // pass_fail — the AI may confirm AND deny.
  if (model.status === 'non_compliant' && model.evidence.trim() === '') {
    return review(rule, 'Flagged non-compliant without a photo-grounded reason — routed to HQ review.', model.red_flags)
  }
  if (!confidenceSurvives(model.confidence, rule.confidence)) {
    return review(rule, 'Model not confident enough to decide automatically — routed to HQ review.', model.red_flags)
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
