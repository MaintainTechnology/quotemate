import { describe, it, expect } from 'vitest'
import { buildExtractionPrompt, parseExtraction } from './extract'

describe('buildExtractionPrompt', () => {
  it('embeds the sheet hint', () => {
    expect(buildExtractionPrompt('ELECTRICAL / POWER & DATA')).toContain('"ELECTRICAL / POWER & DATA"')
  })
  it('falls back to a default hint when blank', () => {
    expect(buildExtractionPrompt('   ')).toContain('POWER & DATA LAYOUT')
  })
})

describe('parseExtraction', () => {
  it('returns null when there is no JSON object', () => {
    expect(parseExtraction('sorry, I could not read the plan')).toBeNull()
  })

  it('extracts a JSON object embedded in prose', () => {
    const text = 'Here is the take-off:\n{"items":[{"type":"Double GPO","symbol":"▲▲","count":40,"confidence":"medium"}]}\nDone.'
    const parsed = parseExtraction(text)
    expect(parsed).not.toBeNull()
    expect(parsed!.items).toHaveLength(1)
    expect(parsed!.items[0]).toMatchObject({ type: 'Double GPO', count: 40, confidence: 'medium' })
  })

  it('normalises the item shape: type/item/name, rounds count, defaults confidence', () => {
    const text = JSON.stringify({
      items: [
        { type: 'Downlight', count: 53.6, confidence: 'low' },        // rounds to 54
        { name: 'Data point', count: '4' },                            // name→type, string count, default conf
        { item: 'Exit sign', count: -2, confidence: 'weird' },         // item→type, clamp to 0, bad conf→medium
        { symbol: 'X', count: 3 },                                     // no name → dropped
        'garbage',                                                     // non-object → dropped
      ],
    })
    const parsed = parseExtraction(text)!
    expect(parsed.items.map((i) => i.type)).toEqual(['Downlight', 'Data point', 'Exit sign'])
    expect(parsed.items[0].count).toBe(54)
    expect(parsed.items[1]).toMatchObject({ type: 'Data point', count: 4, confidence: 'medium' })
    expect(parsed.items[2].count).toBe(0)
    expect(parsed.items[2].confidence).toBe('medium')
  })

  it('captures sheets_used, legend_symbols and overall_note when present', () => {
    const text = JSON.stringify({
      sheets_used: ['104 - Power & Data'],
      legend_symbols: [{ symbol: '▲▲', means: 'Double GPO' }, null],
      items: [],
      overall_note: 'reception cluster was dense',
    })
    const parsed = parseExtraction(text)!
    expect(parsed.sheets_used).toEqual(['104 - Power & Data'])
    expect(parsed.legend_symbols).toEqual([{ symbol: '▲▲', means: 'Double GPO' }])
    expect(parsed.overall_note).toBe('reception cluster was dense')
  })

  it('parses per-symbol locations, clamping x/y and dropping invalid entries', () => {
    const text = JSON.stringify({
      items: [
        {
          type: 'Single GPO',
          count: 4,
          locations: [
            { page: 3, x: 12.34, y: 56.78 },     // kept (rounded to 1dp)
            { page: 3, x: 150, y: -5 },           // clamped to 100 / 0
            { page: 0, x: 50, y: 50 },            // bad page → dropped
            { page: 3, x: 'left', y: 10 },        // bad x → dropped
          ],
        },
        { type: 'EDB', count: 1 },                // no locations → field omitted
      ],
    })
    const parsed = parseExtraction(text)!
    expect(parsed.items[0].locations).toEqual([
      { page: 3, x: 12.3, y: 56.8 },
      { page: 3, x: 100, y: 0 },
    ])
    expect(parsed.items[1].locations).toBeUndefined()
  })

  it('tolerates missing fields (defaults to empty arrays / string)', () => {
    const parsed = parseExtraction('{"items":[]}')!
    expect(parsed.items).toEqual([])
    expect(parsed.sheets_used).toEqual([])
    expect(parsed.legend_symbols).toEqual([])
    expect(parsed.overall_note).toBe('')
  })
})
