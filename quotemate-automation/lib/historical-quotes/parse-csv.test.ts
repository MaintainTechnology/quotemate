import { describe, it, expect } from 'vitest'
import { parseHistoricalCsv } from './parse-csv'

describe('parseHistoricalCsv', () => {
  it('parses lowercased headers and rows', () => {
    const csv = 'Description,Total,Date\nInstall 6 downlights,660,10/01/2026\nReplace tap,180,11/02/2026\n'
    const r = parseHistoricalCsv(csv)
    expect(r.error).toBeNull()
    expect(r.header).toEqual(['description', 'total', 'date'])
    expect(r.records).toHaveLength(2)
    expect(r.records[0].description).toBe('Install 6 downlights')
    expect(r.records[0].total).toBe('660')
  })

  it('caps at maxRows and flags truncation', () => {
    const lines = ['desc,total']
    for (let i = 0; i < 5; i++) lines.push(`job ${i},${i * 100}`)
    const r = parseHistoricalCsv(lines.join('\n'), 3)
    expect(r.truncated).toBe(true)
    expect(r.records).toHaveLength(3)
  })

  it('returns no records for an empty file', () => {
    const r = parseHistoricalCsv('')
    expect(r.records).toHaveLength(0)
  })
})
