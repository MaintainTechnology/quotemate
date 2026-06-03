import { describe, it, expect } from 'vitest'
import { coerceShots, isShotSlot, autoRulesForShot, SHOT_DEFS, DEFAULT_SWEEP_SHOTS } from './shots'
import type { SignageRule } from './types'

describe('shot slot helpers', () => {
  it('validates known slots', () => {
    expect(isShotSlot('storefront')).toBe(true)
    expect(isShotSlot('logo_wall')).toBe(true)
    expect(isShotSlot('nope')).toBe(false)
    expect(isShotSlot(42)).toBe(false)
  })

  it('coerces and de-dupes in canonical order', () => {
    expect(coerceShots(['reception', 'storefront', 'storefront', 'bogus'])).toEqual([
      'storefront',
      'reception',
    ])
    expect(coerceShots('not array')).toEqual([])
  })

  it('default sweep shots are all valid slots', () => {
    expect(DEFAULT_SWEEP_SHOTS.every(isShotSlot)).toBe(true)
  })

  it('every shot def slot is unique', () => {
    const slots = SHOT_DEFS.map((s) => s.slot)
    expect(new Set(slots).size).toBe(slots.length)
  })
})

describe('autoRulesForShot', () => {
  const rules: SignageRule[] = [
    {
      rule_key: 'a',
      rule_text: '',
      rule_group: 'logo_wall',
      modality: 'must',
      applicability: 'auto_vision',
      confidence: 'high',
      mvp_tier: 'mvp_core',
      verdict_mode: 'pass_fail',
      required_shots: ['logo_wall'],
      check_hint: null,
      source_citation: null,
    },
    {
      rule_key: 'b',
      rule_text: '',
      rule_group: 'paint',
      modality: 'must',
      applicability: 'needs_scale_reference', // not auto — excluded
      confidence: 'high',
      mvp_tier: 'phase2_measure',
      verdict_mode: 'needs_reference',
      required_shots: ['logo_wall'],
      check_hint: null,
      source_citation: null,
    },
    {
      rule_key: 'c',
      rule_text: '',
      rule_group: 'storefront',
      modality: 'must',
      applicability: 'auto_vision',
      confidence: 'high',
      mvp_tier: 'mvp_core',
      verdict_mode: 'pass_fail',
      required_shots: ['storefront'], // wrong shot — excluded
      check_hint: null,
      source_citation: null,
    },
  ]

  it('returns only auto_vision rules for the given shot', () => {
    expect(autoRulesForShot(rules, 'logo_wall').map((r) => r.rule_key)).toEqual(['a'])
    expect(autoRulesForShot(rules, 'storefront').map((r) => r.rule_key)).toEqual(['c'])
    expect(autoRulesForShot(rules, 'reception')).toEqual([])
  })
})
