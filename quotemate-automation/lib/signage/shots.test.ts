import { describe, it, expect } from 'vitest'
import { coerceShots, autoRulesForShot, shotSlots, shotLabel } from './shots'
import type { ShotDef, SignageRule } from './types'

const SHOTS: ShotDef[] = [
  { slot: 'storefront', label: 'Storefront', instruction: 'x' },
  { slot: 'logo_wall', label: 'Logo wall', instruction: 'y' },
]

function rule(partial: Partial<SignageRule> & { rule_key: string }): SignageRule {
  return {
    rule_text: '',
    rule_group: 'g',
    modality: 'must',
    applicability: 'auto_vision',
    confidence: 'high',
    mvp_tier: 'mvp_core',
    verdict_mode: 'pass_fail',
    required_shots: ['logo_wall'],
    check_hint: null,
    source_citation: null,
    ...partial,
  }
}

describe('coerceShots', () => {
  it('de-dupes, preserves input order, drops empties/non-strings', () => {
    expect(coerceShots(['reception', 'storefront', 'storefront', ''])).toEqual(['reception', 'storefront'])
    expect(coerceShots('not array')).toEqual([])
    expect(coerceShots([1, 'a', null, 'a'])).toEqual(['a'])
  })
  it('filters to the valid set when provided (brand shot list)', () => {
    expect(coerceShots(['storefront', 'bogus', 'logo_wall'], ['storefront', 'logo_wall'])).toEqual([
      'storefront',
      'logo_wall',
    ])
  })
})

describe('shotSlots / shotLabel', () => {
  it('extracts slot ids from brand shot defs', () => {
    expect(shotSlots(SHOTS)).toEqual(['storefront', 'logo_wall'])
  })
  it('looks up a label, falling back to the slot id', () => {
    expect(shotLabel('logo_wall', SHOTS)).toBe('Logo wall')
    expect(shotLabel('unknown', SHOTS)).toBe('unknown')
  })
})

describe('autoRulesForShot', () => {
  const rules: SignageRule[] = [
    rule({ rule_key: 'a', verdict_mode: 'pass_fail', required_shots: ['logo_wall'] }),
    rule({ rule_key: 'b', verdict_mode: 'needs_reference', required_shots: ['logo_wall'] }), // not scored
    rule({ rule_key: 'c', verdict_mode: 'detect_only', required_shots: ['storefront'] }),
  ]
  it('returns only pass_fail/detect_only rules whose required_shots include the slot', () => {
    expect(autoRulesForShot(rules, 'logo_wall').map((r) => r.rule_key)).toEqual(['a'])
    expect(autoRulesForShot(rules, 'storefront').map((r) => r.rule_key)).toEqual(['c'])
    expect(autoRulesForShot(rules, 'reception')).toEqual([])
  })
})
