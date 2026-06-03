import { describe, it, expect } from 'vitest'
import { composeReport } from './compose-report'
import type { RuleVerdict, SignageRule } from './types'

const rules: SignageRule[] = [
  {
    rule_key: 'wall-logo-required',
    rule_text: 'Wall logo must be present.',
    rule_group: 'logo_wall',
    modality: 'must',
    applicability: 'auto_vision',
    confidence: 'high',
    mvp_tier: 'mvp_core',
    verdict_mode: 'pass_fail',
    required_shots: ['logo_wall'],
    check_hint: null,
    source_citation: 'Page 12',
  },
  {
    rule_key: 'red-stripe',
    rule_text: 'Red stripe must sit above the dark-grey band.',
    rule_group: 'paint',
    modality: 'must',
    applicability: 'auto_vision',
    confidence: 'high',
    mvp_tier: 'mvp_core',
    verdict_mode: 'pass_fail',
    required_shots: ['workout_walls'],
    check_hint: null,
    source_citation: 'Page 15',
  },
  {
    rule_key: 'paint-sku',
    rule_text: 'Walls must use Sherwin Williams SW6261.',
    rule_group: 'paint',
    modality: 'must',
    applicability: 'needs_metadata_or_context',
    confidence: 'high',
    mvp_tier: 'human_queue_metadata',
    verdict_mode: 'review',
    required_shots: ['workout_walls'],
    check_hint: null,
    source_citation: 'Page 9',
  },
]

const verdicts: RuleVerdict[] = [
  { rule_key: 'wall-logo-required', status: 'compliant', confidence: 'high', evidence: 'logo present', red_flags: [] },
  { rule_key: 'red-stripe', status: 'non_compliant', confidence: 'high', evidence: 'no red stripe visible', red_flags: [] },
  { rule_key: 'paint-sku', status: 'cannot_determine', confidence: 'low', evidence: 'needs receipt', red_flags: [] },
]

describe('composeReport', () => {
  it('tallies compliant / fix / review', () => {
    const r = composeReport(rules, verdicts)
    expect(r.counts).toEqual({ compliant: 1, fix: 1, review: 1 })
    expect(r.summary).toContain('1 compliant')
    expect(r.summary).toContain('1 to fix')
    expect(r.summary).toContain('1 need HQ review')
  })

  it('groups by rule_group and prettifies the label', () => {
    const r = composeReport(rules, verdicts)
    const groups = r.groups.map((g) => g.group)
    expect(groups).toContain('Logo Wall')
    expect(groups).toContain('Paint')
  })

  it('orders items fix → review → compliant within a group', () => {
    const r = composeReport(rules, verdicts)
    const paint = r.groups.find((g) => g.group === 'Paint')!
    expect(paint.items.map((i) => i.state)).toEqual(['fix', 'review'])
  })

  it('carries a not-approval disclaimer parametrised by the brand HQ name', () => {
    const r = composeReport(rules, verdicts, 'F45 HQ')
    expect(r.disclaimer.toLowerCase()).toContain('not f45 hq approval')
    const r2 = composeReport(rules, verdicts, "McDonald's Corporate")
    expect(r2.disclaimer).toContain("not McDonald's Corporate approval")
  })

  it('treats a rule with no verdict as review', () => {
    const r = composeReport(rules, verdicts.slice(0, 1))
    expect(r.counts.review).toBe(2)
  })
})
