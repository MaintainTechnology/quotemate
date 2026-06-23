import { describe, it, expect } from 'vitest'
import { composeReport } from './compose-report'
import type { AdvisoryFinding, RuleProvenance, RuleVerdict, SignageRule } from './types'

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

  it('omits rules that have no verdict at all (not assessed)', () => {
    const r = composeReport(rules, verdicts.slice(0, 1))
    expect(r.counts).toEqual({ compliant: 1, fix: 0, review: 0 })
    expect(r.groups.flatMap((g) => g.items).map((i) => i.rule_key)).toEqual(['wall-logo-required'])
  })

  it('hides "No verdict returned" placeholders but keeps real review reasons', () => {
    const vs: RuleVerdict[] = [
      { rule_key: 'wall-logo-required', status: 'compliant', confidence: 'high', evidence: 'logo present', red_flags: [] },
      { rule_key: 'red-stripe', status: 'cannot_determine', confidence: 'low', evidence: 'No verdict returned — routed to HQ review.', red_flags: [] },
      { rule_key: 'paint-sku', status: 'cannot_determine', confidence: 'low', evidence: 'Subjective or legal determination — routed to HQ review.', red_flags: [] },
    ]
    const r = composeReport(rules, vs)
    const keys = r.groups.flatMap((g) => g.items).map((i) => i.rule_key)
    expect(keys).toContain('wall-logo-required') // real verdict shown
    expect(keys).toContain('paint-sku') // meaningful review reason kept
    expect(keys).not.toContain('red-stripe') // unscored placeholder hidden
    expect(r.counts).toEqual({ compliant: 1, fix: 0, review: 1 })
  })

  it('defaults note/kb_citation to null with no provenance', () => {
    const r = composeReport(rules, verdicts)
    const allItems = r.groups.flatMap((g) => g.items)
    expect(allItems.every((i) => i.note === null && i.kb_citation === null)).toBe(true)
  })
})

describe('composeReport — two-stage provenance + advisory', () => {
  const provenance: RuleProvenance[] = [
    { rule_key: 'wall-logo-required', stage: 'agreed', db_status: 'compliant', kb_status: 'compliant', note: null, citation: 'AF Design Manual p.3' },
    { rule_key: 'red-stripe', stage: 'conflict', db_status: 'compliant', kb_status: 'non_compliant', note: 'why', citation: 'p.15' },
    { rule_key: 'paint-sku', stage: 'db_only', db_status: 'cannot_determine', kb_status: 'absent', note: null, citation: null },
  ]

  it('labels each item by provenance stage + carries the kb citation', () => {
    const r = composeReport(rules, verdicts, 'HQ', { provenance })
    const items = r.groups.flatMap((g) => g.items)
    const logo = items.find((i) => i.rule_key === 'wall-logo-required')!
    const stripe = items.find((i) => i.rule_key === 'red-stripe')!
    const sku = items.find((i) => i.rule_key === 'paint-sku')!
    expect(logo.note).toBe('Confirmed against the brand standard')
    expect(logo.kb_citation).toBe('AF Design Manual p.3')
    expect(stripe.note).toBe('Flagged by a second brand-standards check')
    expect(sku.note).toBeNull() // db_only shows no provenance label
  })

  it('appends advisory findings as an "Other observations" review group', () => {
    const advisory: AdvisoryFinding[] = [
      { shot: 'storefront', description: 'Window decals are last-season.', citation: 'p.7', store: 's' },
    ]
    const r = composeReport(rules, verdicts, 'HQ', { advisory })
    const other = r.groups.find((g) => g.group === 'Other observations')!
    expect(other.items).toHaveLength(1)
    expect(other.items[0].state).toBe('review')
    expect(other.items[0].kb_citation).toBe('p.7')
    // advisory counts toward review (1 rule review + 1 advisory = 2)
    expect(r.counts.review).toBe(2)
  })
})
