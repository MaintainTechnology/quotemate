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

/** A brand-defined photo slot id (e.g. 'storefront', 'drive_thru',
 *  'gelato_display'). Each brand declares its own shot list in
 *  `brands.shots`, so this is an open string, not a fixed union. A rule
 *  declares which slots can satisfy it via `required_shots`. */
export type ShotSlot = string

/** One guided photo a brand asks its locations to take. */
export type ShotDef = {
  slot: ShotSlot
  label: string
  /** Franchisee-facing camera guidance shown on the upload page. */
  instruction: string
}

/** Per-brand config (a `brands` row) the engine reads instead of F45
 *  constants — so the same pipeline audits any franchise. */
export type BrandConfig = {
  slug: string
  name: string
  /** What a site is called: "studio" | "restaurant" | "store". */
  location_noun: string
  location_noun_plural: string
  /** Who approves: "F45 HQ" | "McDonald's Corporate". */
  hq_name: string
  /** How the AI is framed: "F45 fitness studios". */
  vision_persona: string
  shots: ShotDef[]
  /** Brand's Gemini File Search store(s) for the rule SUPPLEMENT pass
   *  (migration 094 `brands.kb_store_ids`). Optional + data-driven; when
   *  absent the per-brand default map in `kb-supplement.ts` is used. */
  kb_store_ids?: string[]
}

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

// ════════════════════════════════════════════════════════════════════
// Two-stage assessment (Step 2 = brand file-store cross-check + merge).
// ════════════════════════════════════════════════════════════════════

/** Step 2's per-rule verdict — produced by re-looking at the photo with the
 *  brand-standard passages retrieved from the brand's Gemini File Search
 *  store(s). Same three statuses as Step 1, plus a page/section citation. */
export type KbRuleVerdict = {
  rule_key: string
  status: VerdictStatus
  confidence: Confidence
  /** One short sentence grounded in BOTH the photo and the cited standard. */
  evidence: string
  /** Where in the brand docs this came from, when the store cited it. */
  citation: string | null
}

/** A brand-standard issue Step 2 surfaced that has NO matching DB rule.
 *  Has no rule_key, so it can never be auto-decided — it always routes to
 *  HQ review and is shown in the franchisee report's advisory group. */
export type AdvisoryFinding = {
  shot: ShotSlot
  description: string
  citation: string | null
  /** The brand store that raised it. */
  store: string
}

/** How a rule's final verdict was decided across the two stages. */
export type ProvenanceStage =
  | 'agreed' // both stages reached the same decisive verdict
  | 'conflict' // the stages disagreed → routed to HQ review
  | 'db_only' // Step 2 abstained / didn't cover it → Step 1 stands
  | 'kb_only' // Step 1 abstained; Step 2 weighed in (never a solo pass)

/** Per-rule audit trail of the merge — drives the franchisee provenance
 *  note + citation and the HQ side-by-side. */
export type RuleProvenance = {
  rule_key: string
  stage: ProvenanceStage
  db_status: VerdictStatus
  kb_status: VerdictStatus | 'absent'
  /** Short human note explaining a conflict / kb-only outcome (else null). */
  note: string | null
  citation: string | null
}

/** The full two-stage breakdown persisted on `signage_assessments.two_stage`. */
export type TwoStageDetail = {
  step1: RuleVerdict[]
  kb: KbRuleVerdict[]
  provenance: RuleProvenance[]
  advisory: AdvisoryFinding[]
  stores: string[]
  /** True when Step 2 was meant to run but failed (outage/keys) — HQ signal. */
  kb_degraded: boolean
}
