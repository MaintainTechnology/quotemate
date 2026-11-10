import { describe, expect, it } from 'vitest'
import { dxfText, EDGE_LAYERS, toDxf } from './dxf'
import { packGeometry } from './geometry'
import type { PackStructure } from './privacy'

const skillion = (over: Partial<PackStructure> = {}): PackStructure => ({
  id: 'S1',
  label: 'House 1',
  role: 'primary',
  source: 'plans',
  planes: [{
    id: 'S1-P1', plan_dims_mm: [10130, 9600], polygon_mm: null, plan_area_m2: 97.25, pitch_deg: 5, pitch_source: 'note',
    fall: 'south', profile: 'Custom Orb', finish_tag: 'RF:01', sloped_area_m2: 97.62, confidence: 'high', sheets: ['A1001A'],
  }],
  edges: [
    { type: 'eave', length_m: 10.13, source: 'measured', confidence: 'high' },
    { type: 'high_side', length_m: 10.13, source: 'measured', confidence: 'high' },
    { type: 'barge', length_m: 9.6, source: 'measured', confidence: 'high' },
    { type: 'barge', length_m: 9.6, source: 'measured', confidence: 'high' },
  ],
  exclusions: [],
  ...over,
})

/** The file as group code and value pairs, as a DXF reader takes it. */
function pairs(dxf: string): Array<[number, string]> {
  const lines = dxf.split('\r\n')
  expect(lines.pop()).toBe('') // ends with a line break
  expect(lines.length % 2).toBe(0)
  const out: Array<[number, string]> = []
  for (let i = 0; i < lines.length; i += 2) {
    expect(lines[i]).toMatch(/^ *\d{1,4}$/)
    out.push([Number(lines[i]), lines[i + 1]])
  }
  return out
}

/** Each entity: its type, layer and the values it carries. */
function entities(dxf: string) {
  const all = pairs(dxf)
  const start = all.findIndex(([c, v], i) => c === 2 && v === 'ENTITIES' && all[i - 1][1] === 'SECTION')
  const list: Array<{ type: string; layer: string; values: Array<[number, string]> }> = []
  for (const [code, value] of all.slice(start + 1)) {
    if (code === 0) {
      if (value === 'ENDSEC') break
      list.push({ type: value, layer: '', values: [] })
    } else {
      const last = list.at(-1)!
      if (code === 8) last.layer = value
      last.values.push([code, value])
    }
  }
  return list
}

const build = (structures: PackStructure[]) => toDxf(packGeometry(structures), structures)

describe('toDxf', () => {
  it('writes an R12 file in sections, closed by EOF', () => {
    const { dxf } = build([skillion()])
    const all = pairs(dxf)
    expect(all.slice(0, 4)).toEqual([[0, 'SECTION'], [2, 'HEADER'], [9, '$ACADVER'], [1, 'AC1009']])
    expect(all.filter(([c, v]) => c === 0 && v === 'SECTION').map((_, i) => i)).toHaveLength(3)
    expect(all.at(-1)).toEqual([0, 'EOF'])
    expect(dxf).not.toMatch(/e[+-]\d/i) // no exponent in any number
  })

  it('declares a layer for each roof, each aerial footprint, every edge type and the labels', () => {
    const ring = [[152.75, -27.59], [152.7501, -27.59], [152.7501, -27.5899], [152.75, -27.59]]
    const aerial = { building_id: 'b', footprint_m2: 110, drawn_plan_m2: 97, polygon: { type: 'Polygon' as const, coordinates: [ring] } }
    const { dxf, layers } = build([skillion(), skillion({ id: 'S2', source: 'hybrid', aerial })])
    expect(layers).toEqual(['ROOF-S1', 'ROOF-S2', 'FOOTPRINT-S2', ...EDGE_LAYERS, 'LABELS'])
    expect(EDGE_LAYERS).toEqual(['EDGE-RIDGE', 'EDGE-HIP', 'EDGE-VALLEY', 'EDGE-BARGE', 'EDGE-EAVE', 'EDGE-HIGH_SIDE', 'EDGE-APRON', 'EDGE-BOX_GUTTER', 'EDGE-PARAPET'])
    const declared = pairs(dxf).filter(([c], i, all) => c === 2 && all[i - 1][1] === 'LAYER').map(([, v]) => v)
    expect(declared).toEqual(['0', ...layers])
  })

  it('draws a skillion as a closed outline in millimetres, with its edges on their layers', () => {
    const list = entities(build([skillion()]).dxf)
    const outline = list.filter((e) => e.type === 'VERTEX' && e.layer === 'ROOF-S1')
    expect(outline).toHaveLength(4)
    const polyline = list.find((e) => e.type === 'POLYLINE')!
    expect(polyline.layer).toBe('ROOF-S1')
    expect(polyline.values).toContainEqual([70, '1']) // closed
    const xs = outline.map((v) => Number(v.values.find(([c]) => c === 10)![1]))
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10130, 3)
    const lines = list.filter((e) => e.type === 'LINE' && e.layer.startsWith('EDGE-'))
    expect(lines.map((e) => e.layer).sort()).toEqual(['EDGE-BARGE', 'EDGE-BARGE', 'EDGE-EAVE', 'EDGE-HIGH_SIDE'])
  })

  it('labels each roof and plane, with its pitch and an arrow down its fall', () => {
    const list = entities(build([skillion()]).dxf)
    const texts = list.filter((e) => e.type === 'TEXT').map((e) => e.values.find(([c]) => c === 1)![1])
    expect(texts).toContain('S1 House 1')
    expect(texts).toContain('S1-P1 5%%d')
    expect(texts.some((t) => /millimetres at 1:1, north up/i.test(t))).toBe(true)
    expect(list.filter((e) => e.type === 'LINE' && e.layer === 'LABELS').length).toBe(3) // shaft and two barbs
  })

  it('keeps text the model wrote to one line of ASCII, so it can add no entity', () => {
    const hostile = skillion({ label: 'House\r\n  0\r\nLINE\r\n  8\r\nEVIL\nCafé 100% ²' })
    const list = entities(build([hostile]).dxf)
    expect(list.some((e) => e.layer === 'EVIL')).toBe(false)
    const label = list.filter((e) => e.type === 'TEXT').map((e) => e.values.find(([c]) => c === 1)![1]).find((t) => t.startsWith('S1 '))!
    expect(label).toBe('S1 House 0 LINE 8 EVIL Cafe 100%%% 2')
  })

  it('names layers from ids as CAD allows, each once', () => {
    const { layers } = build([skillion({ id: 'house one!' }), skillion({ id: 'S1' }), skillion({ id: 's1' })])
    expect(layers.slice(0, 3)).toEqual(['ROOF-HOUSE_ONE_', 'ROOF-S1', 'ROOF-S1-2'])
    expect(layers.every((l) => l.length <= 31 && /^[A-Z0-9_$-]+$/.test(l))).toBe(true)
  })

  it('draws an aerial footprint on its own layer', () => {
    const ring = [[152.75, -27.59], [152.7501, -27.59], [152.7501, -27.5899], [152.75, -27.5899], [152.75, -27.59]]
    const hybrid = skillion({ source: 'hybrid', edges: [], aerial: { building_id: 'b', footprint_m2: 110, drawn_plan_m2: 97, polygon: { type: 'Polygon', coordinates: [ring] } } })
    const list = entities(build([hybrid]).dxf)
    expect(list.filter((e) => e.type === 'VERTEX' && e.layer === 'FOOTPRINT-S1')).toHaveLength(4)
  })

  it('leaves out a roof with nothing to draw', () => {
    const none = skillion({ id: 'S9', planes: [{ ...skillion().planes[0], id: 'S9-P1', plan_dims_mm: null }] })
    const list = entities(build([none]).dxf)
    expect(list.some((e) => e.type === 'POLYLINE')).toBe(false)
  })
})

describe('dxfText', () => {
  it('writes the degree sign as DXF does and a percent sign as itself', () => {
    expect(dxfText('25° hip, 100%')).toBe('25%%d hip, 100%%%')
  })

  it('cuts a long text', () => {
    expect(dxfText('x'.repeat(500))).toHaveLength(200)
  })
})
