import { describe, it, expect } from 'vitest'
import { buildBrandExtractionPrompt, buildShotProposalPrompt, parseBrandExtraction } from './extract-brand'

describe('buildBrandExtractionPrompt', () => {
  it('frames the brand + location noun and demands strict JSON with shots + rules', () => {
    const p = buildBrandExtractionPrompt({ brandName: "McDonald's", locationNoun: 'restaurant', docText: 'Standards…' })
    expect(p).toContain("McDonald's")
    expect(p).toContain('restaurant')
    expect(p).toContain('STRICT JSON')
    expect(p).toContain('verdict_mode')
    expect(p).toContain('pass_fail')
    expect(p).toContain('detect_only')
    // Default mode asks the model to PROPOSE its own shots.
    expect(p).toContain('Propose the guided PHOTO SHOTS')
  })

  it('with targetShots, pins the fixed list and asks for rules only', () => {
    const p = buildBrandExtractionPrompt({
      brandName: 'Anytime Fitness',
      locationNoun: 'club',
      docText: 'Standards…',
      targetShots: [
        { slot: 'logo_wall', label: 'Logo Wall', instruction: 'Square-on shot of the logo wall.' },
        { slot: 'bathroom', label: 'Bathroom', instruction: 'Wide shot of the bathroom.' },
      ],
    })
    expect(p).toContain('Use EXACTLY this fixed photo-shot list')
    expect(p).toContain('logo_wall')
    expect(p).toContain('bathroom')
    expect(p).not.toContain('Propose the guided PHOTO SHOTS')
    expect(p).toContain('rules ONLY')
  })
})

describe('buildShotProposalPrompt', () => {
  it('asks for a coherent shot list only, as strict JSON', () => {
    const p = buildShotProposalPrompt({ brandName: 'Anytime Fitness', locationNoun: 'club', docText: 'Standards…' })
    expect(p).toContain('Anytime Fitness')
    expect(p).toContain('club')
    expect(p).toContain('"shots"')
    expect(p).toContain('STRICT JSON')
    expect(p).not.toContain('verdict_mode')
  })
})

describe('parseBrandExtraction', () => {
  const good = JSON.stringify({
    shots: [{ slot: 'drive_thru', label: 'Drive-thru', instruction: 'Capture the drive-thru lane.' }],
    rules: [
      { rule_key: 'menu-board-lit', rule_text: 'Drive-thru menu board must be lit.', rule_group: 'signage', modality: 'must', shot: 'drive_thru', verdict_mode: 'pass_fail', check_hint: 'is it lit', confidence: 'high', source_citation: 'p3' },
    ],
  })

  it('parses shots + rules from clean JSON', () => {
    const r = parseBrandExtraction(good)
    expect(r.shots).toHaveLength(1)
    expect(r.shots[0].slot).toBe('drive_thru')
    expect(r.rules).toHaveLength(1)
    expect(r.rules[0].verdict_mode).toBe('pass_fail')
  })

  it('tolerates markdown fences', () => {
    const r = parseBrandExtraction('```json\n' + good + '\n```')
    expect(r.rules).toHaveLength(1)
  })

  it('coerces an unknown verdict_mode to review', () => {
    const t = JSON.stringify({ shots: [], rules: [{ rule_key: 'x', rule_text: 'y', verdict_mode: 'wat' }] })
    expect(parseBrandExtraction(t).rules[0].verdict_mode).toBe('review')
  })

  it('forces a shot not in the shot list to "na"', () => {
    const t = JSON.stringify({
      shots: [{ slot: 'a', label: 'A', instruction: '' }],
      rules: [{ rule_key: 'k', rule_text: 'r', shot: 'ghost', verdict_mode: 'pass_fail' }],
    })
    expect(parseBrandExtraction(t).rules[0].shot).toBe('na')
  })

  it('drops rules missing a key or text, and de-dupes keys', () => {
    const t = JSON.stringify({
      shots: [],
      rules: [
        { rule_key: '', rule_text: 'no key' },
        { rule_key: 'dup', rule_text: 'first' },
        { rule_key: 'dup', rule_text: 'second' },
      ],
    })
    const r = parseBrandExtraction(t)
    expect(r.rules).toHaveLength(1)
    expect(r.rules[0].rule_text).toBe('first')
  })

  it('returns empty on unreadable input', () => {
    expect(parseBrandExtraction('nonsense')).toEqual({ shots: [], rules: [] })
    expect(parseBrandExtraction('')).toEqual({ shots: [], rules: [] })
    expect(parseBrandExtraction(null)).toEqual({ shots: [], rules: [] })
  })

  it('validates rule shots against validSlotOverride when shots are omitted', () => {
    // Fixed-shot mode: the model emits rules only (no shots array), so slot
    // validity must come from the override, not the parsed shots.
    const t = JSON.stringify({
      rules: [
        { rule_key: 'a', rule_text: 'in scope', shot: 'bathroom', verdict_mode: 'pass_fail' },
        { rule_key: 'b', rule_text: 'out of scope', shot: 'ghost', verdict_mode: 'pass_fail' },
      ],
    })
    const r = parseBrandExtraction(t, ['logo_wall', 'bathroom'])
    expect(r.rules).toHaveLength(2)
    expect(r.rules.find((x) => x.rule_key === 'a')!.shot).toBe('bathroom')
    expect(r.rules.find((x) => x.rule_key === 'b')!.shot).toBe('na')
  })
})
