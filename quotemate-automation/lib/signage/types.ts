// ════════════════════════════════════════════════════════════════════
// Signage Compliance — shared types.
//
// PURE — no I/O. Imported by the vision pass, the grounding backstop, the
// report composer, the API routes, and the dashboard pages.
// ════════════════════════════════════════════════════════════════════

/** How a rule can be verified from a franchisee phone photo. Mirrors the
 *  registry tag produced by the extraction pipeline. */
export type RuleApplicability =
  | 'auto_vision' // presence/layout/text/colour-family — checkable from one photo
  | 'needs_scale_reference' // an absolute measurement — needs a tape/known object in frame
  | 'needs_metadata_or_context' // needs info not in the photo (paint SKU, approval, landlord letter)
  | 'human_review_only' // subjective or legal — never auto-decided

export type RuleModality = 'must' | 'should' | 'optional' | 'process'

export type MvpTier =
  | 'mvp_core'
  | 'mvp_candidate'
  | 'phase2_ref'
  | 'phase2_measure'
  | 'human_queue'
  | 'human_queue_metadata'
  | 'human_queue_legal'

/** The guided photo slots a studio submits. Each rule declares which
 *  slots can satisfy it (a rule is only assessed against its slots). */
export type ShotSlot =
  | 'storefront'
  | 'logo_wall'
  | 'v_design_close'
  | 'reception'
  | 'workout_walls'
  | 'retail'

export type Confidence = 'high' | 'medium' | 'low'

/** How the AI is allowed to act on a rule (migration 090). Drives which
 *  rules are sent to vision and how their verdicts are grounded:
 *   - pass_fail       AI may confirm AND deny
 *   - detect_only     AI may FLAG a violation but never certify compliance
 *                     (a "compliant" verdict is downgraded to review)
 *   - needs_reference decidable only with a tape/known object in frame →
 *                     review until that capture ships
 *   - review          not photo-checkable / legal → always human review */
export type VerdictMode = 'pass_fail' | 'detect_only' | 'needs_reference' | 'review'

/** A single compliance rule from the registry (signage_rules row). */
export type SignageRule = {
  rule_key: string
  rule_text: string
  rule_group: string
  modality: RuleModality
  applicability: RuleApplicability
  confidence: Confidence
  mvp_tier: MvpTier
  /** Drives AI participation (migration 090). */
  verdict_mode: VerdictMode
  required_shots: ShotSlot[]
  check_hint: string | null
  source_citation: string | null
}

export type VerdictStatus = 'compliant' | 'non_compliant' | 'cannot_determine'

/** One per-rule verdict. The model produces these for auto_vision rules;
 *  the backstop manufactures `cannot_determine` ones for the rest. */
export type RuleVerdict = {
  rule_key: string
  status: VerdictStatus
  confidence: Confidence
  /** One short, photo-grounded sentence. Required for any non_compliant. */
  evidence: string
  red_flags: string[]
}

/** Rollup of a full assessment. Default gravity is toward needs_review. */
export type AssessmentOverall = 'pass' | 'fix_needed' | 'needs_review'

export type VerdictCounts = {
  compliant: number
  fix: number
  review: number
}
