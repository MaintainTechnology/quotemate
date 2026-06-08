import { describe, expect, it } from 'vitest'
import { mergeOne, mergeRuleVerdicts } from './merge'
import type { AdvisoryFinding, KbRuleVerdict, RuleVerdict, SignageRule, VerdictStatus } from './types'

function rule(partial: Partial<SignageRule> & { rule_key: string }): SignageRule {
  return {
    rule_key: partial.rule_key,
    rule_text: partial.rule_text ?? 'Some rule',
    rule_group: partial.rule_group ?? 'storefront',
    modality: partial.modality ?? 'must',
    applicability: partial.applicability ?? 'auto_vision',
    confidence: partial.confidence ?? 'high',
    mvp_tier: partial.mvp_tier ?? 'mvp_core',
    verdict_mode: partial.verdict_mode ?? 'pass_fail',
    required_shots: partial.required_shots ?? ['storefront'],
    check_hint: partial.check_hint ?? null,
    source_citation: partial.source_citation ?? 'Page 1',
  }
}

function s1(rule_key: string, status: VerdictStatus, evidence = 'step1 evidence'): RuleVerdict {
  return { rule_key, status, confidence: 'high', evidence, red_flags: [] }
}

function kb(rule_key: string, status: VerdictStatus, evidence = 'kb evidence'): KbRuleVerdict {
  return { rule_key, status, confidence: 'high', evidence, citation: 'AF Design Manual p.12' }
}

const R = rule({ rule_key: 'r1' })

describe('mergeOne — truth table', () => {
  it('compliant + compliant → compliant / agreed', () => {
    const out = mergeOne(R, s1('r1', 'compliant'), kb('r1', 'compliant'))
    expect(out.verdict.status).toBe('compliant')
    expect(out.provenance.stage).toBe('agreed')
  })

  it('compliant + absent → compliant / db_only (Step 2 abstaining never blocks)', () => {
    const out = mergeOne(R, s1('r1', 'compliant'), undefined)
    expect(out.verdict.status).toBe('compliant')
    expect(out.provenance.stage).toBe('db_only')
  })

  it('compliant + cannot_determine → compliant / db_only', () => {
    const out = mergeOne(R, s1('r1', 'compliant'), kb('r1', 'cannot_determine'))
    expect(out.verdict.status).toBe('compliant')
    expect(out.provenance.stage).toBe('db_only')
  })

  it('compliant + non_compliant → review / conflict (catches the false pass)', () => {
    const out = mergeOne(R, s1('r1', 'compliant'), kb('r1', 'non_compliant', 'logo is the old wordmark'))
    expect(out.verdict.status).toBe('cannot_determine')
    expect(out.provenance.stage).toBe('conflict')
    expect(out.verdict.evidence).toContain('old wordmark')
    expect(out.provenance.citation).toBe('AF Design Manual p.12')
  })

  it('non_compliant + non_compliant → fix / agreed', () => {
    const out = mergeOne(R, s1('r1', 'non_compliant'), kb('r1', 'non_compliant'))
    expect(out.verdict.status).toBe('non_compliant')
    expect(out.provenance.stage).toBe('agreed')
  })

  it('non_compliant + absent → fix / db_only (grounded fail stands)', () => {
    const out = mergeOne(R, s1('r1', 'non_compliant'), undefined)
    expect(out.verdict.status).toBe('non_compliant')
    expect(out.provenance.stage).toBe('db_only')
  })

  it('non_compliant + compliant → review / conflict (Step 2 disputes the fail)', () => {
    const out = mergeOne(R, s1('r1', 'non_compliant'), kb('r1', 'compliant'))
    expect(out.verdict.status).toBe('cannot_determine')
    expect(out.provenance.stage).toBe('conflict')
  })

  it('cannot_determine + non_compliant → review / kb_only (Step-2-only flag)', () => {
    const out = mergeOne(R, s1('r1', 'cannot_determine'), kb('r1', 'non_compliant', 'wrong colour family'))
    expect(out.verdict.status).toBe('cannot_determine')
    expect(out.provenance.stage).toBe('kb_only')
    expect(out.verdict.evidence).toContain('wrong colour family')
  })

  it('cannot_determine + compliant → review / kb_only (no machine certifies a pass alone)', () => {
    const out = mergeOne(R, s1('r1', 'cannot_determine'), kb('r1', 'compliant'))
    expect(out.verdict.status).toBe('cannot_determine')
    expect(out.provenance.stage).toBe('kb_only')
  })

  it('cannot_determine + absent → review / db_only (unchanged)', () => {
    const out = mergeOne(R, s1('r1', 'cannot_determine'), undefined)
    expect(out.verdict.status).toBe('cannot_determine')
    expect(out.provenance.stage).toBe('db_only')
  })
})

describe('mergeRuleVerdicts — rollup', () => {
  const rules = [rule({ rule_key: 'a' }), rule({ rule_key: 'b' }), rule({ rule_key: 'c' })]

  it('is the identity over Step 1 when kb is empty', () => {
    const step1 = [s1('a', 'compliant'), s1('b', 'non_compliant'), s1('c', 'cannot_determine')]
    const out = mergeRuleVerdicts(rules, step1, [], [])
    expect(out.verdicts.map((v) => v.status)).toEqual(['compliant', 'non_compliant', 'cannot_determine'])
    expect(out.provenance.every((p) => p.stage === 'db_only')).toBe(true)
    expect(out.overall).toBe('fix_needed')
    expect(out.counts).toEqual({ compliant: 1, fix: 1, review: 1 })
  })

  it('passes only when every rule is compliant and unobjected', () => {
    const step1 = [s1('a', 'compliant'), s1('b', 'compliant'), s1('c', 'compliant')]
    const kbv = [kb('a', 'compliant'), kb('b', 'compliant')] // c abstains
    const out = mergeRuleVerdicts(rules, step1, kbv, [])
    expect(out.overall).toBe('pass')
    expect(out.counts).toEqual({ compliant: 3, fix: 0, review: 0 })
  })

  it('a single false-pass catch downgrades the whole overall to needs_review', () => {
    const step1 = [s1('a', 'compliant'), s1('b', 'compliant'), s1('c', 'compliant')]
    const kbv = [kb('c', 'non_compliant')]
    const out = mergeRuleVerdicts(rules, step1, kbv, [])
    expect(out.overall).toBe('needs_review')
    expect(out.verdicts.find((v) => v.rule_key === 'c')!.status).toBe('cannot_determine')
  })

  it('advisory findings count as review and force needs_review', () => {
    const step1 = [s1('a', 'compliant'), s1('b', 'compliant'), s1('c', 'compliant')]
    const kbv = [kb('a', 'compliant'), kb('b', 'compliant'), kb('c', 'compliant')]
    const advisory: AdvisoryFinding[] = [
      { shot: 'storefront', description: 'Window decals not in the 2025 set.', citation: 'p.4', store: 's' },
    ]
    const out = mergeRuleVerdicts(rules, step1, kbv, advisory)
    expect(out.overall).toBe('needs_review')
    expect(out.counts).toEqual({ compliant: 3, fix: 0, review: 1 })
    expect(out.advisory).toHaveLength(1)
  })

  it('de-duplicates advisory findings by shot + description', () => {
    const advisory: AdvisoryFinding[] = [
      { shot: 'storefront', description: 'Decals off.', citation: 'p.4', store: 's' },
      { shot: 'storefront', description: 'decals off', citation: 'p.4', store: 's2' },
    ]
    const out = mergeRuleVerdicts([rule({ rule_key: 'a' })], [s1('a', 'compliant')], [kb('a', 'compliant')], advisory)
    expect(out.advisory).toHaveLength(1)
  })

  it('empty rule set is never a pass', () => {
    expect(mergeRuleVerdicts([], [], [], []).overall).toBe('needs_review')
  })

  it('manufactures a review verdict for a rule with no Step-1 verdict', () => {
    const out = mergeRuleVerdicts([rule({ rule_key: 'z' })], [], [], [])
    expect(out.verdicts[0].status).toBe('cannot_determine')
    expect(out.overall).toBe('needs_review')
  })
})
