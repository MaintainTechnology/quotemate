import { describe, it, expect } from 'vitest'
import { buildAssessmentPrompt, parseAssessmentResponse } from './vision-assess'
import type { SignageRule } from './types'

const RULES: SignageRule[] = [
  {
    rule_key: 'wall-logo-required',
    rule_text: 'The studio must have an internal wall logo.',
    rule_group: 'logo_wall',
    modality: 'must',
    applicability: 'auto_vision',
    confidence: 'high',
    mvp_tier: 'mvp_core',
    required_shots: ['logo_wall'],
    check_hint: 'look for the F45 logo on the main wall',
    source_citation: 'Page 12',
  },
  {
    rule_key: 'v-design-mandatory',
    rule_text: 'A painted V must sit behind the logo.',
    rule_group: 'v_design',
    modality: 'must',
    applicability: 'auto_vision',
    confidence: 'high',
    mvp_tier: 'mvp_core',
    required_shots: ['logo_wall'],
    check_hint: null,
    source_citation: 'Page 13',
  },
]

describe('buildAssessmentPrompt', () => {
  it('lists each rule key and demands strict JSON', () => {
    const p = buildAssessmentPrompt({ shotSlot: 'logo_wall', rules: RULES })
    expect(p).toContain('[wall-logo-required]')
    expect(p).toContain('[v-design-mandatory]')
    expect(p).toContain('STRICT JSON')
    expect(p).toContain('cannot_determine')
    // colour-family + no-measurement guardrails present
    expect(p.toLowerCase()).toContain('colour by family')
    expect(p.toLowerCase()).toContain('do not estimate absolute measurements')
  })
})

describe('parseAssessmentResponse', () => {
  const allow = RULES.map((r) => r.rule_key)

  it('parses a clean JSON object', () => {
    const text = JSON.stringify({
      verdicts: [
        { rule_key: 'wall-logo-required', status: 'compliant', confidence: 'high', evidence: 'logo present', red_flags: [] },
      ],
    })
    const out = parseAssessmentResponse(text, allow)
    expect(out).toHaveLength(1)
    expect(out[0].status).toBe('compliant')
  })

  it('tolerates markdown fences and surrounding prose', () => {
    const text =
      'Here you go:\n```json\n{ "verdicts": [ {"rule_key":"v-design-mandatory","status":"non_compliant","confidence":"high","evidence":"no V"} ] }\n```'
    const out = parseAssessmentResponse(text, allow)
    expect(out).toHaveLength(1)
    expect(out[0].rule_key).toBe('v-design-mandatory')
    expect(out[0].status).toBe('non_compliant')
  })

  it('drops verdicts for rule_keys not in the allow set', () => {
    const text = JSON.stringify({
      verdicts: [
        { rule_key: 'ghost-rule', status: 'compliant', confidence: 'high', evidence: 'x' },
        { rule_key: 'wall-logo-required', status: 'compliant', confidence: 'high', evidence: 'ok' },
      ],
    })
    const out = parseAssessmentResponse(text, allow)
    expect(out.map((v) => v.rule_key)).toEqual(['wall-logo-required'])
  })

  it('coerces unknown status/confidence to safe values', () => {
    const text = JSON.stringify({
      verdicts: [
        { rule_key: 'wall-logo-required', status: 'maybe', confidence: 'super', evidence: 'x' },
      ],
    })
    const out = parseAssessmentResponse(text, allow)
    expect(out[0].status).toBe('cannot_determine')
    expect(out[0].confidence).toBe('low')
  })

  it('returns [] for unreadable input', () => {
    expect(parseAssessmentResponse('not json at all', allow)).toEqual([])
    expect(parseAssessmentResponse('', allow)).toEqual([])
    expect(parseAssessmentResponse(null, allow)).toEqual([])
  })

  it('de-duplicates repeated rule_keys (first wins)', () => {
    const text = JSON.stringify({
      verdicts: [
        { rule_key: 'wall-logo-required', status: 'compliant', confidence: 'high', evidence: 'a' },
        { rule_key: 'wall-logo-required', status: 'non_compliant', confidence: 'high', evidence: 'b' },
      ],
    })
    const out = parseAssessmentResponse(text, allow)
    expect(out).toHaveLength(1)
    expect(out[0].status).toBe('compliant')
  })
})
