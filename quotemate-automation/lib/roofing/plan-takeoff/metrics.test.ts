// The takeoff mapped onto the roofing pricer (TKO-16), on takeoffs made up for
// each rule, and Grange's hand-measured reference priced on the default card.

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { priceMultiRoof } from '@/lib/roofing/pricing'
import { materialOf, toRoofStructures } from './metrics'
import { RoofPlanTakeoffSchema, type RoofPlanTakeoff } from './schema'

type Structure = RoofPlanTakeoff['structures'][number]
type Plane = Structure['planes'][number]
type Edge = Structure['edges'][number]

const plane = (id: string, over: Partial<Plane> = {}): Plane => ({
  id, plan_dims_mm: null, polygon_mm: null, plan_area_m2: 100, pitch_deg: 5, pitch_source: 'note', fall: null,
  profile: 'Lysaght Custom Orb', finish_tag: null, sloped_area_m2: null, confidence: 'high', evidence: [], ...over,
})
const edge = (type: Edge['type'], length_m: number | null = 5): Edge => ({ type, length_m, source: 'measured', confidence: 'high' })
const structure = (id: string, planes: Plane[], over: Partial<Structure> = {}): Structure => ({
  id, label: `Roof ${id}`, role: 'primary', source: 'plans', planes, edges: [], exclusions: [], ...over,
})
const takeoff = (...structures: Structure[]): RoofPlanTakeoff => ({
  version: 1,
  scale: { stated: '1:100', sheet_size: 'A1', pdf_page: [1000, 1000], calibration: { method: 'dimension_string', reference_mm: 3000, factor: 50, delta_pct: 0 } },
  sheets: [],
  structures,
  scope: { includes: [], excludes: [], questions: [] },
})

describe('materialOf', () => {
  it('reads the profiles drawings name, and guesses none it does not know', () => {
    expect(['Lysaght Custom Orb', 'Corrugated 0.42 BMT', 'TRIMDEK', 'Spandek', 'Klip-Lok 700', 'Terracotta tiles', 'Concrete roof tile', 'Smartascreen', null]
      .map(materialOf)).toEqual(['colorbond_corrugated', 'colorbond_corrugated', 'colorbond_trimdek', 'colorbond_spandek', 'colorbond_kliplok', 'terracotta_tile', 'concrete_tile', null, null])
  })

  it('matches a long profile in linear time, and concrete tiles named either way round', () => {
    const started = performance.now()
    expect(materialOf('concrete '.repeat(15_000))).toBeNull()
    expect(performance.now() - started).toBeLessThan(200)
    expect(['Tile, concrete', 'CONCRETE TILES'].map(materialOf)).toEqual(['concrete_tile', 'concrete_tile'])
  })
})

describe('storeys', () => {
  it('reads a roof\'s storeys whatever its id, "constructor" included', () => {
    const roof = structure('constructor', [plane('p')])
    expect(toRoofStructures(takeoff(roof), { storeys: {} }).structures[0].metrics.storeys).toBe(1)
    expect(toRoofStructures(takeoff(roof), { storeys: { constructor: 2 } }).structures[0].metrics.storeys).toBe(2)
  })
})

describe('toRoofStructures', () => {
  it('maps a skillion: its areas, its pitch as measured and bucketed, and the re-roof intent', () => {
    const { structures, unpriced, unknown } = toRoofStructures(takeoff(structure('S1', [plane('S1-P1', { plan_area_m2: 97.25, pitch_deg: 5, sloped_area_m2: 97.62 })])))
    expect([unpriced, unknown]).toEqual([[], []])
    expect(structures).toEqual([{
      buildingId: 'S1', role: 'primary', label: 'Roof S1',
      metrics: {
        footprint_m2: 97.25, sloped_area_m2: 97.62, storeys: 1, form: 'skillion', hips: 0, valleys: 0, ridge_lm: null,
        polygon_geojson: null, capture_date: null, pitch_degrees: 5, pitch_source: 'measured', area_source: 'measured',
      },
      inputs: { material: 'colorbond_corrugated', pitch: 'shallow', intent: 'full_reroof', building_year_built: null },
    }])
  })

  it('weights the pitch by area, derives a sloped area the reading left out, and counts hips and valleys', () => {
    const hip = structure('S1', [plane('a', { plan_area_m2: 20, pitch_deg: 5 }), plane('b', { plan_area_m2: 80, pitch_deg: 25 })], {
      edges: [edge('hip', 4), edge('hip', 4), edge('valley', 3), edge('ridge', 6)],
    })
    const [mapped] = toRoofStructures(takeoff(hip)).structures
    expect(mapped.metrics).toMatchObject({ form: 'hip', hips: 2, valleys: 1, ridge_lm: 14, pitch_degrees: 21 })
    expect(mapped.metrics.sloped_area_m2).toBeCloseTo(20 / Math.cos(Math.PI / 36) + 80 / Math.cos((25 * Math.PI) / 180), 1)
    expect(mapped.inputs.pitch).toBe('standard')
  })

  it('names the form the pricer needs: gable, and complex for what fits no form', () => {
    const two = [plane('a'), plane('b')]
    expect(toRoofStructures(takeoff(structure('S1', two, { edges: [edge('ridge')] }))).structures[0].metrics.form).toBe('gable')
    expect(toRoofStructures(takeoff(structure('S1', [...two, plane('c')]))).structures[0].metrics.form).toBe('complex')
    // An unknown ridge length leaves the ridge's total unknown.
    expect(toRoofStructures(takeoff(structure('S1', two, { edges: [edge('ridge', null)] }))).structures[0].metrics.ridge_lm).toBeNull()
  })

  it('leaves out a roof it cannot price, saying why, rather than price it at $0', () => {
    const { structures, unpriced } = toRoofStructures(takeoff(
      structure('S1', [plane('S1-P1', { plan_area_m2: null })]),
      structure('S2', [plane('S2-P1', { pitch_deg: null })]),
      structure('S3', [plane('S3-P1', { profile: 'Smartascreen' })]),
      structure('S4', [plane('S4-P1'), plane('S4-P2', { profile: 'Trimdek' })]),
      structure('S5', []),
      structure('S6', [plane('S6-P1')]),
    ))
    expect(structures.map((s) => s.buildingId)).toEqual(['S6'])
    expect(unpriced).toEqual([
      { structure_id: 'S1', reason: 'No area for S1-P1' },
      { structure_id: 'S2', reason: 'No pitch for S2-P1' },
      { structure_id: 'S3', reason: 'No rate for the profile "Smartascreen"' },
      { structure_id: 'S4', reason: 'Its planes are in more than one profile' },
      { structure_id: 'S5', reason: 'Its planes have no area' },
    ])
  })

  it('prices only the included roofs, at the storeys given, and names ids the takeoff lacks', () => {
    const job = takeoff(structure('S1', [plane('S1-P1')]), structure('S2', [plane('S2-P1')], { role: 'secondary' }))
    const { structures, unknown } = toRoofStructures(job, { included: ['S2', 'S9'], storeys: { S2: 2 } })
    expect(structures.map((s) => [s.buildingId, s.role, s.metrics.storeys])).toEqual([['S2', 'secondary', 2]])
    expect(unknown).toEqual(['S9'])
  })
})

const REFERENCE = 'eval/roof-takeoff/grange/takeoff.json'

describe.skipIf(!existsSync(REFERENCE))('Grange, priced', () => {
  it('prices the hand-measured takeoff as four roofs for the tradie to review', () => {
    const { structures, unpriced } = toRoofStructures(RoofPlanTakeoffSchema.parse(JSON.parse(readFileSync(REFERENCE, 'utf8'))))
    expect(unpriced).toEqual([])
    expect(structures.map((s) => [s.inputs.material, s.metrics.form, s.inputs.pitch])).toEqual([
      ['colorbond_corrugated', 'skillion', 'shallow'],
      ['colorbond_corrugated', 'skillion', 'shallow'],
      ['colorbond_trimdek', 'skillion', 'shallow'],
      ['colorbond_trimdek', 'skillion', 'shallow'],
    ])
    expect(structures.reduce((total, s) => total + s.metrics.footprint_m2, 0)).toBeCloseTo(230.55, 1)
    const quote = priceMultiRoof({ structures })
    expect(quote.routing.decision).toBe('tradie_review')
    expect(quote.inspection_structures).toEqual([])
  })
})
