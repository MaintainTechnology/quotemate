// R17 — reconcile the job_type classifications produced at different pipeline
// stages (the SMS dialog's guess, the slot extractor, the intake structurer).
//
// THE RISK: three independent LLM calls each classify the job. When they
// DISAGREE and the code silently picks one, a quote can ground against the
// WRONG assembly — a correct price for the wrong job, which no downstream guard
// catches. This module makes the disagreement explicit and decides, by policy:
//   • unanimous / single source → use it.
//   • clear majority (>50%, no tie) → use the majority, marked as such.
//   • a tie / no majority (genuine conflict) → DO NOT pick. The caller asks one
//     targeted clarifying question, or routes to inspection.
//
// Pure + I/O-free → unit-tested without the pipeline. "unknown"/"other"/
// "out_of_scope"/blank are treated as NOT-a-classification (they don't vote and
// don't conflict — they just mean "this source didn't classify").

export type JobTypeCandidate = {
  source: string
  jobType: string | null | undefined
}

export type ReconcileAgreement = 'none' | 'single' | 'unanimous' | 'majority' | 'conflict'
export type ReconcileAction = 'use' | 'clarify' | 'inspect'

export type ReconcileResult = {
  /** The agreed/winning job_type, or null when unresolved. */
  resolved: string | null
  agreement: ReconcileAgreement
  /** 'use' = safe to proceed; 'clarify' = ask one question; 'inspect' = route to $99. */
  action: ReconcileAction
  /** The known (classified) candidates, normalised. */
  candidates: Array<{ source: string; jobType: string }>
}

const NOT_A_CLASSIFICATION = new Set(['', 'unknown', 'other', 'out_of_scope', 'unsure'])

function isKnown(jt: string | null | undefined): jt is string {
  return !!jt && !NOT_A_CLASSIFICATION.has(jt.trim().toLowerCase())
}

export function reconcileJobType(raw: JobTypeCandidate[]): ReconcileResult {
  const known = raw
    .filter((c) => isKnown(c.jobType))
    .map((c) => ({ source: c.source, jobType: (c.jobType as string).trim().toLowerCase() }))

  if (known.length === 0) {
    return { resolved: null, agreement: 'none', action: 'clarify', candidates: [] }
  }

  const distinct = [...new Set(known.map((k) => k.jobType))]
  if (distinct.length === 1) {
    return {
      resolved: distinct[0],
      agreement: known.length === 1 ? 'single' : 'unanimous',
      action: 'use',
      candidates: known,
    }
  }

  // Disagreement — count votes.
  const counts = new Map<string, number>()
  for (const k of known) counts.set(k.jobType, (counts.get(k.jobType) ?? 0) + 1)
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const [topJt, topN] = sorted[0]
  const tie = sorted.filter(([, n]) => n === topN).length > 1

  if (!tie && topN > known.length / 2) {
    return { resolved: topJt, agreement: 'majority', action: 'use', candidates: known }
  }

  // Genuine conflict (tie / no majority) — never silently pick.
  return { resolved: null, agreement: 'conflict', action: 'clarify', candidates: known }
}

/** A targeted clarifying question naming the two leading candidates (R17). */
export function clarifyQuestionFor(result: ReconcileResult): string {
  const opts = [...new Set(result.candidates.map((c) => c.jobType.replace(/_/g, ' ')))]
  if (opts.length >= 2) {
    return `Quick one so I quote the right job - is this ${opts[0]} or ${opts[1]} work?`
  }
  return 'Quick one - what work do you need quoted?'
}
