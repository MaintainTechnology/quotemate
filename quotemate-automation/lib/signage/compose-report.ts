// ════════════════════════════════════════════════════════════════════
// Signage Compliance — franchisee-facing report composer.
//
// PURE (mirrors lib/sms/roofing-compose.ts). Turns the grounded verdicts
// + the rule set into a grouped, human-readable report. The HQ queue
// renders from the same verdicts; this shapes the franchisee view.
// ════════════════════════════════════════════════════════════════════

import type { RuleVerdict, SignageRule, VerdictCounts } from './types'

export type ReportItemState = 'compliant' | 'fix' | 'review'

export type ReportItem = {
  rule_key: string
  rule_text: string
  state: ReportItemState
  /** What the franchisee should do / why it can't be auto-checked. */
  detail: string
  source_citation: string | null
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

const DISCLAIMER =
  'This is an automated pre-check, not F45 HQ approval. Final signage compliance is determined by F45 HQ.'

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
 *  citation + group; `verdicts` supplies the per-rule state + evidence. */
export function composeReport(
  rules: SignageRule[],
  verdicts: RuleVerdict[],
): ComplianceReport {
  const verdictByKey = new Map(verdicts.map((v) => [v.rule_key, v]))

  const groupOrder: string[] = []
  const grouped = new Map<string, ReportItem[]>()
  let compliant = 0
  let fix = 0
  let review = 0

  for (const rule of rules) {
    const v = verdictByKey.get(rule.rule_key)
    const state: ReportItemState = v ? stateOf(v) : 'review'
    if (state === 'compliant') compliant += 1
    else if (state === 'fix') fix += 1
    else review += 1

    const detail =
      state === 'compliant'
        ? v?.evidence?.trim() || 'Looks right in your photo.'
        : state === 'fix'
          ? `${v?.evidence?.trim() || 'Does not meet the standard.'} — ${rule.rule_text}`
          : v?.evidence?.trim() || 'Needs an HQ reviewer to confirm.'

    const item: ReportItem = {
      rule_key: rule.rule_key,
      rule_text: rule.rule_text,
      state,
      detail,
      source_citation: rule.source_citation,
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

  const counts: VerdictCounts = { compliant, fix, review }
  const summary = `${compliant} compliant · ${fix} to fix · ${review} need HQ review`

  return { counts, groups, summary, disclaimer: DISCLAIMER }
}
