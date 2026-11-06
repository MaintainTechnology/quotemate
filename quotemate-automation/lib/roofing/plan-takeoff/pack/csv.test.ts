import { describe, expect, it } from 'vitest'
import { CSV_COLUMNS, toCsv } from './csv'
import { packGeometry } from './geometry'
import type { PackStructure } from './privacy'

const house: PackStructure = {
  id: 'S1',
  label: 'House 1',
  role: 'primary',
  source: 'plans',
  planes: [{
    id: 'S1-P1', plan_dims_mm: [10130, 9600], polygon_mm: null, plan_area_m2: 97.25, pitch_deg: 5, pitch_source: 'note',
    fall: 'south, to the street', profile: 'Lysaght Custom Orb', finish_tag: 'RF:01', sloped_area_m2: 97.62, confidence: 'high', sheets: ['A1001A', 'A2100'],
  }],
  edges: [
    { type: 'eave', length_m: 10.13, source: 'measured', confidence: 'high' },
    { type: 'high_side', length_m: 10.13, source: 'measured', confidence: 'high' },
    { type: 'barge', length_m: 9.6, source: 'measured', confidence: 'high' },
    { type: 'apron', length_m: 9.6, source: 'derived', confidence: 'medium' },
  ],
  exclusions: [{ label: 'Deck roof', reason: 'Left out by the scope note', area_m2: 14.2 }],
}
const carport: PackStructure = {
  ...house,
  id: 'S2',
  label: 'Carport',
  role: 'secondary',
  planes: [{ ...house.planes[0], id: 'S2-P1', plan_dims_mm: null, plan_area_m2: null, sloped_area_m2: null, sheets: [] }],
  edges: [{ type: 'eave', length_m: null, source: 'derived', confidence: 'low' }],
  exclusions: [],
}

/** The CSV's rows as a spreadsheet reads them: BOM, CRLF, quoted cells. */
function rows(csv: string): string[][] {
  expect(csv.startsWith('﻿')).toBe(true)
  expect(csv.endsWith('\r\n')).toBe(true)
  const out: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const text = csv.slice(1)
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' } else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); out.push(row); row = []; cell = ''; i++ } else cell += c
  }
  return out
}

const at = (row: string[], column: string) => row[CSV_COLUMNS.indexOf(column as (typeof CSV_COLUMNS)[number])]

describe('toCsv', () => {
  const structures = [house, carport]
  const table = rows(toCsv(structures, packGeometry(structures)))
  const [header, ...body] = table
  const of = (record: string, structure?: string) => body.filter((r) => at(r, 'record') === record && (structure === undefined || at(r, 'structure_id') === structure))

  it('has one header and the same number of cells in every row', () => {
    expect(header).toEqual([...CSV_COLUMNS])
    expect(table.every((r) => r.length === CSV_COLUMNS.length)).toBe(true)
  })

  it('gives each plane its size, areas, pitch, profile and sheets', () => {
    const [plane] = of('plane', 'S1')
    expect(at(plane, 'item')).toBe('S1-P1')
    expect(at(plane, 'structure')).toBe('House 1')
    expect(at(plane, 'plan_length_mm')).toBe('10130')
    expect(at(plane, 'plan_width_mm')).toBe('9600')
    expect(at(plane, 'plan_area_m2')).toBe('97.25')
    expect(at(plane, 'roof_area_m2')).toBe('97.62')
    expect(at(plane, 'pitch_deg')).toBe('5')
    expect(at(plane, 'profile')).toBe('Lysaght Custom Orb')
    expect(at(plane, 'fall')).toBe('south, to the street')
    expect(at(plane, 'sheets')).toBe('A1001A; A2100')
    expect(at(plane, 'drawn')).toBe('size')
  })

  it('lists every edge, saying which the outline draws on its layer', () => {
    const edges = of('edge', 'S1')
    expect(edges.map((r) => [at(r, 'item'), at(r, 'type'), at(r, 'length_m'), at(r, 'length_source'), at(r, 'drawn')])).toEqual([
      ['E1', 'eave', '10.13', 'measured', 'yes'],
      ['E2', 'high_side', '10.13', 'measured', 'yes'],
      ['E3', 'barge', '9.6', 'measured', 'no'],
      ['E4', 'apron', '9.6', 'derived', 'no'],
    ])
  })

  it('leaves a value the drawings don’t give empty, and says a plane isn’t drawn', () => {
    const [plane] = of('plane', 'S2')
    expect(at(plane, 'plan_area_m2')).toBe('')
    expect(at(plane, 'drawn')).toBe('no')
    expect(at(of('edge', 'S2')[0], 'length_m')).toBe('')
  })

  it('lists the exclusions and totals each roof, the job and each edge type', () => {
    const [deck] = of('exclusion', 'S1')
    expect([at(deck, 'item'), at(deck, 'plan_area_m2'), at(deck, 'note')]).toEqual(['Deck roof', '14.2', 'Left out by the scope note'])
    const [s1] = of('total', 'S1')
    expect([at(s1, 'plan_area_m2'), at(s1, 'roof_area_m2')]).toEqual(['97.25', '97.62'])
    const [s2] = of('total', 'S2')
    expect(at(s2, 'note')).toMatch(/1 plane has no area/)
    const [job] = of('total', 'all')
    expect([at(job, 'plan_area_m2'), at(job, 'roof_area_m2')]).toEqual(['97.25', '97.62'])
    const totals = Object.fromEntries(of('edge_total').map((r) => [at(r, 'type'), [at(r, 'length_m'), at(r, 'note')]]))
    expect(totals.eave).toEqual(['10.13', '1 edge has no length'])
    expect(totals.barge).toEqual(['9.6', ''])
  })

  it('quotes a cell a spreadsheet would run as a formula, and one with commas or quotes', () => {
    const hostile: PackStructure = { ...house, label: '=HYPERLINK("http://x.test","Open")', planes: [{ ...house.planes[0], profile: '+cmd|/c calc', fall: '@SUM(A1)' }] }
    const csv = toCsv([hostile], packGeometry([hostile]))
    const [plane] = rows(csv).slice(1).filter((r) => at(r, 'record') === 'plane')
    expect(at(plane, 'structure')).toBe('\'=HYPERLINK("http://x.test","Open")')
    expect(at(plane, 'profile')).toBe("'+cmd|/c calc")
    expect(at(plane, 'fall')).toBe("'@SUM(A1)")
    expect(csv).toContain('"\'=HYPERLINK(""http://x.test"",""Open"")"')
  })
})
