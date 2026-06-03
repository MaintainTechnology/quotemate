import { describe, it, expect } from 'vitest'
import { validateSignageAssessment, tally } from './validate-verdicts'
import type { RuleVerdict, SignageRule } from './types'

function rule(partial: Partial<SignageRule> & { rule_key: string }): SignageRule {
  return {
    rule_text: 'A rule',
    rule_group: 'logo_wall',
    modality: 'must',
    applicability: 'auto_vision',
    confidence: 'high',
    mvp_tier: 'mvp_core',
    required_shots: ['logo_wall'],
    check_hint: null,
    source_citation: null,
    ...partial,
  }
}

function verdict(partial: Partial<RuleVerdict> & { rule_key: string }): RuleVerdict {
  return {
    status: 'compliant',
    confidence: 'high',
    evidence: 'seen in photo',
    red_flags: [],
    ...partial,
  }
}

describe('validateSignageAssessment — applicability gate', () => {
  it('forces every non-auto rule to cannot_determine regardless of model output', () => {
    const rules: SignageRule[] = [
      rule({ rule_key: 'meta', applicability: 'needs_metadata_or_context' }),
      rule({ rule_key: 'scale', applicability: 'needs_scale_reference' }),
      rule({ rule_key: 'legal', applicability: 'human_review_only' }),
    ]
    // Even if the model "decided" them, they must not pass/fail.
    const model: RuleVerdict[] = [
      verdict({ rule_key: 'meta', status: 'compliant' }),
      verdict({ rule_key: 'scale', status: 'non_compliant' }),
      verdict({ rule_key: 'legal', status: 'compliant' }),
    ]
    const { verdicts, overall } = validateSignageAssessment(rules, model)
    expect(verdicts.every((v) => v.status === 'cannot_determine')).toBe(true)
    expect(overall).toBe('needs_review')
  })
})

describe('validateSignageAssessment — confidence floor', () => {
  it('keeps a high-confidence pass on a high-prior rule', () => {
    const rules = [rule({ rule_key: 'a', confidence: 'high' })]
    const { verdicts, overall } = validateSignageAssessment(rules, [
      verdict({ rule_key: 'a', status: 'compliant', confidence: 'high' }),
    ])
    expect(verdicts[0].status).toBe('compliant')
    expect(overall).toBe('pass')
  })

  it('downgrades a medium-confidence pass on a high-prior rule', () => {
    const rules = [rule({ rule_key: 'a', confidence: 'high' })]
    const { verdicts } = validateSignageAssessment(rules, [
      verdict({ rule_key: 'a', status: 'compliant', confidence: 'medium' }),
    ])
    expect(verdicts[0].status).toBe('cannot_determine')
  })

  it('allows a medium-confidence pass when the registry prior is only medium', () => {
    const rules = [rule({ rule_key: 'a', confidence: 'medium' })]
    const { verdicts } = validateSignageAssessment(rules, [
      verdict({ rule_key: 'a', status: 'compliant', confidence: 'medium' }),
    ])
    expect(verdicts[0].status).toBe('compliant')
  })

  it('always downgrades a low-confidence verdict', () => {
    const rules = [rule({ rule_key: 'a', confidence: 'medium' })]
    const { verdicts } = validateSignageAssessment(rules, [
      verdict({ rule_key: 'a', status: 'non_compliant', confidence: 'low' }),
    ])
    expect(verdicts[0].status).toBe('cannot_determine')
  })
})

describe('validateSignageAssessment — evidence + missing verdicts', () => {
  it('downgrades a non_compliant with empty evidence', () => {
    const rules = [rule({ rule_key: 'a' })]
    const { verdicts } = validateSignageAssessment(rules, [
      verdict({ rule_key: 'a', status: 'non_compliant', evidence: '   ' }),
    ])
    expect(verdicts[0].status).toBe('cannot_determine')
  })

  it('fills a missing model verdict as cannot_determine', () => {
    const rules = [rule({ rule_key: 'a' })]
    const { verdicts } = validateSignageAssessment(rules, [])
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0].status).toBe('cannot_determine')
  })

  it('ignores stray model verdicts for rules not in scope', () => {
    const rules = [rule({ rule_key: 'a' })]
    const { verdicts } = validateSignageAssessment(rules, [
      verdict({ rule_key: 'a', status: 'compliant' }),
      verdict({ rule_key: 'ghost', status: 'compliant' }),
    ])
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0].rule_key).toBe('a')
  })
})

describe('validateSignageAssessment — overall rollup', () => {
  it('fix_needed when any surviving non_compliant exists', () => {
    const rules = [rule({ rule_key: 'a' }), rule({ rule_key: 'b' })]
    const { overall } = validateSignageAssessment(rules, [
      verdict({ rule_key: 'a', status: 'compliant', confidence: 'high' }),
      verdict({ rule_key: 'b', status: 'non_compliant', confidence: 'high', evidence: 'no V visible' }),
    ])
    expect(overall).toBe('fix_needed')
  })

  it('pass only when every rule is compliant', () => {
    const rules = [rule({ rule_key: 'a' }), rule({ rule_key: 'b' })]
    const { overall } = validateSignageAssessment(rules, [
      verdict({ rule_key: 'a', status: 'compliant', confidence: 'high' }),
      verdict({ rule_key: 'b', status: 'compliant', confidence: 'high' }),
    ])
    expect(overall).toBe('pass')
  })

  it('prefers the more decisive verdict when two shots scored the same rule', () => {
    const rules = [rule({ rule_key: 'a', required_shots: ['logo_wall', 'v_design_close'] })]
    const { verdicts } = validateSignageAssessment(rules, [
      verdict({ rule_key: 'a', status: 'cannot_determine', confidence: 'low', evidence: '' }),
      verdict({ rule_key: 'a', status: 'compliant', confidence: 'high' }),
    ])
    expect(verdicts[0].status).toBe('compliant')
  })
})

describe('tally', () => {
  it('counts compliant / fix / review', () => {
    expect(
      tally([
        verdict({ rule_key: 'a', status: 'compliant' }),
        verdict({ rule_key: 'b', status: 'non_compliant' }),
        verdict({ rule_key: 'c', status: 'cannot_determine' }),
        verdict({ rule_key: 'd', status: 'cannot_determine' }),
      ]),
    ).toEqual({ compliant: 1, fix: 1, review: 2 })
  })
})
