// ════════════════════════════════════════════════════════════════════
// Signage Compliance — two-stage merge (PURE).
//
// Compiles the final per-rule verdict from BOTH stages:
//   • Step 1 — the grounded DB rule-check (validate-verdicts.ts output).
//   • Step 2 — the brand file-store cross-check (kb-assess.ts output).
//
// The single safety law: a green PASS survives only when Step 1 says
// compliant AND Step 2 does not object. Any disagreement, or a Step-2-only
// finding, routes to HQ review. No machine ever auto-certifies a pass.
//
// Calling this with empty `kbVerdicts` + `advisory` is the IDENTITY over
// Step 1 — so run.ts / the audit route use one code path whether or not
// the two-stage check ran.
// ════════════════════════════════════════════════════════════════════

import type {
  AdvisoryFinding,
  AssessmentOverall,
  Confidence,
  KbRuleVerdict,
  RuleProvenance,
  RuleVerdict,
  SignageRule,
  VerdictCounts,
  VerdictStatus,
} from './types'

export type MergeResult = {
  /** The merged authoritative verdicts — one per rule, in `rules` order. */
  verdicts: RuleVerdict[]
  /** One provenance entry per rule (same order). */
  provenance: RuleProvenance[]
  /** Step-2-only findings, de-duplicated. Each routes to HQ review. */
  advisory: AdvisoryFinding[]
  overall: AssessmentOverall
  /** `review` includes the advisory findings. */
  counts: VerdictCounts
}

/** Keep the more decisive of two verdicts when a rule is judged twice
 *  (e.g. by more than one shot): a decisive status beats cannot_determine;
 *  among decisive, higher confidence wins. */
function kbDecisiveness(v: KbRuleVerdict): number {
  const statusScore = v.status === 'cannot_determine' ? 0 : 2
  const confScore = v.confidence === 'high' ? 2 : v.confidence === 'medium' ? 1 : 0
  return statusScore + confScore
}

function review(rule_key: string, evidence: string, red_flags: string[] = []): RuleVerdict {
  return { rule_key, status: 'cannot_determine', confidence: 'low', evidence, red_flags }
}

function maxConfidence(a: Confidence, b: Confidence | undefined): Confidence {
  const rank = (c: Confidence | undefined) => (c === 'high' ? 2 : c === 'medium' ? 1 : 0)
  return rank(b) > rank(a) ? (b as Confidence) : a
}

type MergeOne = { verdict: RuleVerdict; provenance: RuleProvenance }

/** PURE — merge one rule's two-stage verdicts per the truth table. */
export function mergeOne(
  rule: SignageRule,
  s1: RuleVerdict,
  kb: KbRuleVerdict | undefined,
): MergeOne {
  const db = s1.status
  const kbStatus: VerdictStatus | 'absent' = kb ? kb.status : 'absent'
  const citation = kb?.citation ?? null

  // "abstains" = Step 2 didn't object or affirm (absent or cannot_determine).
  const kbObjects = !!kb && kb.status === 'non_compliant'
  const kbClears = !!kb && kb.status === 'compliant'

  const prov = (stage: RuleProvenance['stage'], note: string | null): RuleProvenance => ({
    rule_key: rule.rule_key,
    stage,
    db_status: db,
    kb_status: kbStatus,
    note,
    citation,
  })

  // 1. Step 1 said COMPLIANT.
  if (db === 'compliant') {
    if (kbObjects) {
      // The second check disputes a clean pass → HQ review (false-pass catch).
      const why = (kb!.evidence || '').trim() || 'A second check against the brand standard flagged a possible issue.'
      return { verdict: review(rule.rule_key, why, s1.red_flags), provenance: prov('conflict', why) }
    }
    if (kbClears) {
      return {
        verdict: { ...s1, confidence: maxConfidence(s1.confidence, kb?.confidence) },
        provenance: prov('agreed', null),
      }
    }
    // kb abstains → Step 1's pass stands.
    return { verdict: s1, provenance: prov('db_only', null) }
  }

  // 2. Step 1 said NON_COMPLIANT (a grounded, confidence-gated fail).
  if (db === 'non_compliant') {
    if (kbClears) {
      // The second check disputes the fail → HQ review (don't auto-clear it).
      const why = `A second check against the brand standard read this as compliant, but Step 1 flagged it — HQ to confirm.`
      return { verdict: review(rule.rule_key, why, s1.red_flags), provenance: prov('conflict', why) }
    }
    // Both agree it's a fail, OR Step 2 abstained → the grounded fail stands.
    return { verdict: s1, provenance: prov(kbObjects ? 'agreed' : 'db_only', null) }
  }

  // 3. Step 1 could NOT determine (already routed to review by the backstop).
  if (kbObjects) {
    // A Step-2-only flag on a rule Step 1 couldn't see → HQ review with the reason.
    const why = (kb!.evidence || '').trim() || 'The brand-standards reference flagged a possible issue.'
    return { verdict: review(rule.rule_key, why, s1.red_flags), provenance: prov('kb_only', why) }
  }
  if (kbClears) {
    const why = `The brand-standards reference read this as compliant, but it can't certify a pass on its own — HQ to confirm.`
    return { verdict: review(rule.rule_key, s1.evidence || why, s1.red_flags), provenance: prov('kb_only', why) }
  }
  // kb abstains too → Step 1's review stands unchanged.
  return { verdict: s1, provenance: prov('db_only', null) }
}

/** Normalised key for advisory de-dupe. */
function advisorySig(a: AdvisoryFinding): string {
  return `${a.shot}::${a.description.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120)}`
}

function tally(verdicts: RuleVerdict[]): VerdictCounts {
  let compliant = 0
  let fix = 0
  let reviewN = 0
  for (const v of verdicts) {
    if (v.status === 'compliant') compliant += 1
    else if (v.status === 'non_compliant') fix += 1
    else reviewN += 1
  }
  return { compliant, fix, review: reviewN }
}

/**
 * PURE — compile the two stages into the final assessment.
 *
 * @param rules       the scoped rule set (defines the order + coverage)
 * @param step1       grounded Step-1 verdicts (one per rule; defensive if not)
 * @param kbVerdicts  Step-2 per-rule verdicts (may be empty / partial)
 * @param advisory    Step-2-only findings (may be empty)
 */
export function mergeRuleVerdicts(
  rules: SignageRule[],
  step1: RuleVerdict[],
  kbVerdicts: KbRuleVerdict[] = [],
  advisory: AdvisoryFinding[] = [],
): MergeResult {
  const s1ByKey = new Map<string, RuleVerdict>()
  for (const v of step1) if (!s1ByKey.has(v.rule_key)) s1ByKey.set(v.rule_key, v)

  const kbByKey = new Map<string, KbRuleVerdict>()
  for (const v of kbVerdicts) {
    const prev = kbByKey.get(v.rule_key)
    if (!prev || kbDecisiveness(v) > kbDecisiveness(prev)) kbByKey.set(v.rule_key, v)
  }

  const verdicts: RuleVerdict[] = []
  const provenance: RuleProvenance[] = []
  for (const rule of rules) {
    const s1 =
      s1ByKey.get(rule.rule_key) ??
      review(rule.rule_key, 'No verdict returned — routed to HQ review.')
    const { verdict, provenance: prov } = mergeOne(rule, s1, kbByKey.get(rule.rule_key))
    verdicts.push(verdict)
    provenance.push(prov)
  }

  // De-dupe advisory findings.
  const seen = new Set<string>()
  const advisoryOut: AdvisoryFinding[] = []
  for (const a of advisory) {
    if (!a.description?.trim()) continue
    const sig = advisorySig(a)
    if (seen.has(sig)) continue
    seen.add(sig)
    advisoryOut.push(a)
  }

  const base = tally(verdicts)
  const counts: VerdictCounts = { ...base, review: base.review + advisoryOut.length }

  // Same gravity as validate-verdicts: an empty rule set is never a pass.
  const overall: AssessmentOverall =
    rules.length === 0
      ? 'needs_review'
      : base.fix > 0
        ? 'fix_needed'
        : base.review > 0 || advisoryOut.length > 0
          ? 'needs_review'
          : 'pass'

  return { verdicts, provenance, advisory: advisoryOut, overall, counts }
}
