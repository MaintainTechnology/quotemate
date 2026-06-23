// ════════════════════════════════════════════════════════════════════
// Signage Compliance — franchisee-facing report composer.
//
// PURE (mirrors lib/sms/roofing-compose.ts). Turns the grounded verdicts
// + the rule set into a grouped, human-readable report. The HQ queue
// renders from the same verdicts; this shapes the franchisee view.
// ════════════════════════════════════════════════════════════════════

import type { AdvisoryFinding, RuleProvenance, RuleVerdict, SignageRule, VerdictCounts } from './types'

export type ReportItemState = 'compliant' | 'fix' | 'review'

export type ReportItem = {
  rule_key: string
  rule_text: string
  state: ReportItemState
  /** What the franchisee should do / why it can't be auto-checked. */
  detail: string
  source_citation: string | null
  /** Provenance label when the file-store cross-check (Step 2) was involved
   *  (e.g. "Flagged by a second brand-standards check"); null otherwise. */
  note: string | null
  /** Brand-standard page/section Step 2 cited, when any. */
  kb_citation: string | null
}

/** A short provenance label for the franchisee — only when Step 2 changed,
 *  confirmed, or added something. `db_only` (Step 1 alone) shows nothing. */
function provLabel(p: RuleProvenance | undefined): string | null {
  if (!p) return null
  switch (p.stage) {
    case 'conflict':
      return 'Flagged by a second brand-standards check'
    case 'kb_only':
      return 'Raised by the brand-standards reference'
    case 'agreed':
      return 'Confirmed against the brand standard'
    default:
      return null // db_only
  }
}

/** A rule is "unscored" when no verdict was returned for it — its shot wasn't
 *  photographed, or the vision call returned nothing. Both backstop variants
 *  start with "No verdict returned". These are pure noise on the report. */
function isUnscored(v: RuleVerdict): boolean {
  return v.status === 'cannot_determine' && v.evidence.trim().startsWith('No verdict returned')
}

export type ReportGroup = {
  group: string
  items: ReportItem[]
}

export type ComplianceReport = {
  counts: VerdictCounts
  groups: ReportGroup[]
  /** One-line SMS-friendly summary. */
  summary: string
  disclaimer: string
}

function disclaimerFor(hqName: string): string {
  return `This is an automated pre-check, not ${hqName} approval. Final compliance is determined by ${hqName}.`
}

function stateOf(v: RuleVerdict): ReportItemState {
  if (v.status === 'compliant') return 'compliant'
  if (v.status === 'non_compliant') return 'fix'
  return 'review'
}

function prettyGroup(group: string): string {
  return group
    .split(/[-_]/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/** PURE — compose the grouped report. `rules` supplies the rule text +
 *  citation + group; `verdicts` supplies the per-rule state + evidence;
 *  `opts.provenance` adds the two-stage source label + brand citation per
 *  rule, and `opts.advisory` appends a group of Step-2-only observations. */
export function composeReport(
  rules: SignageRule[],
  verdicts: RuleVerdict[],
  hqName = 'HQ',
  opts: { provenance?: RuleProvenance[]; advisory?: AdvisoryFinding[] } = {},
): ComplianceReport {
  const verdictByKey = new Map(verdicts.map((v) => [v.rule_key, v]))
  const provByKey = new Map((opts.provenance ?? []).map((p) => [p.rule_key, p]))
  const advisory = opts.advisory ?? []

  const groupOrder: string[] = []
  const grouped = new Map<string, ReportItem[]>()
  let compliant = 0
  let fix = 0
  let review = 0

  for (const rule of rules) {
    const v = verdictByKey.get(rule.rule_key)
    // Omit rules that weren't actually assessed (no photo for their shot, or
    // the model returned no verdict) — otherwise the report is a wall of
    // "No verdict returned — routed to HQ review." rows. HQ still sees them in
    // the raw assessment; this only trims the franchisee + instant-audit report.
    if (!v || isUnscored(v)) continue
    const state: ReportItemState = stateOf(v)
    if (state === 'compliant') compliant += 1
    else if (state === 'fix') fix += 1
    else review += 1

    const detail =
      state === 'compliant'
        ? v.evidence.trim() || 'Looks right in your photo.'
        : state === 'fix'
          ? `${v.evidence.trim() || 'Does not meet the standard.'} — ${rule.rule_text}`
          : v.evidence.trim() || 'Needs an HQ reviewer to confirm.'

    const prov = provByKey.get(rule.rule_key)
    const item: ReportItem = {
      rule_key: rule.rule_key,
      rule_text: rule.rule_text,
      state,
      detail,
      source_citation: rule.source_citation,
      note: provLabel(prov),
      kb_citation: prov?.citation ?? null,
    }
    if (!grouped.has(rule.rule_group)) {
      grouped.set(rule.rule_group, [])
      groupOrder.push(rule.rule_group)
    }
    grouped.get(rule.rule_group)!.push(item)
  }

  // Within each group: fixes first, then review, then compliant — the
  // franchisee sees what needs action at the top.
  const stateRank: Record<ReportItemState, number> = { fix: 0, review: 1, compliant: 2 }
  const groups: ReportGroup[] = groupOrder.map((group) => ({
    group: prettyGroup(group),
    items: (grouped.get(group) ?? []).sort((a, b) => stateRank[a.state] - stateRank[b.state]),
  }))

  // Step-2-only findings → their own group. They have no DB rule, so they
  // are always "needs HQ review" and count toward review.
  if (advisory.length > 0) {
    groups.push({
      group: 'Other observations',
      items: advisory.map((a, i) => ({
        rule_key: `advisory-${i}`,
        rule_text: a.description,
        state: 'review' as const,
        detail: a.description,
        source_citation: null,
        note: 'New brand-standard observation from the file-store check',
        kb_citation: a.citation,
      })),
    })
  }

  review += advisory.length
  const counts: VerdictCounts = { compliant, fix, review }
  const summary = `${compliant} compliant · ${fix} to fix · ${review} need HQ review`

  return { counts, groups, summary, disclaimer: disclaimerFor(hqName) }
}
