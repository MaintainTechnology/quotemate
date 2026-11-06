import { describe, expect, it } from 'vitest'
import type { Checks } from '../checks'
import type { RoofPlanTakeoff } from '../schema'
import { packTakeoff, redact, redactLabel } from './privacy'

// Made-up people, as a title block or a careless reading might carry them.
const NAMES = ['Smith', 'Citizen', 'Nguyen', 'Papadopoulos', 'jane.citizen@example.com', '0412 345 678', '07 3812 0000']

describe('redact', () => {
  it.each([
    ['Client: Mr J Smith', 'Smith'],
    ['Mr & Mrs Smith', 'Smith'],
    ['Mrs. Nguyen asked for the roof to stay', 'Nguyen'],
    ['Proposed residence for Jane Citizen', 'Citizen'],
    ['Smith Residence', 'Smith'],
    ['The Papadopoulos Family home', 'Papadopoulos'],
    ['OWNER: JANE CITIZEN', 'CITIZEN'],
    ['Prepared for: Jane Citizen.', 'Citizen'],
    ['Email jane.citizen@example.com for access', 'jane.citizen@example.com'],
    ['Call 0412 345 678 before arriving', '0412 345 678'],
    ['Office on (07) 3812 0000', '3812 0000'],
    ['Mobile +61 412 345 678', '412 345 678'],
  ])('takes the name or contact out of %j', (text, gone) => {
    const out = redact(text)
    expect(out).not.toContain(gone)
    expect(out).toMatch(/removed/)
  })

  it.each([
    'House 1',
    'Proposed residence, roof plan',
    'Existing Residence',
    'New dwelling roof RF:01',
    'Lysaght Custom Orb 0.42 BMT',
    'Falls south, to the street',
    '5 Whittaker St, North Ipswich QLD 4305',
    '12 Banksia Dr, Eastern Heights',
    'Insulated roof over the new deck: 1:20 fall',
    'Is the carport in the scope?',
  ])('leaves %j as it is', (text) => {
    expect(redact(text)).toBe(text)
  })
})

describe('redactLabel', () => {
  it('names a roof by its id when its label carried a name', () => {
    expect(redactLabel('Smith Residence', 'S1')).toBe('Roof S1')
    expect(redactLabel('House for Mr Nguyen', 'S2')).toBe('Roof S2')
  })

  it('keeps a label with no name in it', () => {
    expect(redactLabel('Carport, west bay', 'S3')).toBe('Carport, west bay')
  })
})

const hostile: RoofPlanTakeoff = {
  version: 1,
  scale: { stated: '1:100', sheet_size: 'A1', pdf_page: [2384, 1684], calibration: { method: 'title_block', reference_mm: 841, factor: 35.3, delta_pct: 0.1 } },
  sheets: [
    { file: 'Smith Residence plans.pdf', page: 2, number: 'A104', title: 'Roof plan, Smith Residence', revision: 'P3', status_text: 'PRELIMINARY for Mr J Smith', kind: 'roof_plan', used: true },
    { file: 'Smith Residence plans.pdf', page: 3, number: null, title: 'Elevations', revision: null, status_text: 'FOR CONSTRUCTION', kind: 'elevation', used: true },
    { file: 'Engineering Citizen.pdf', page: 1, number: 'S202', title: 'Roof framing', revision: 'A', status_text: null, kind: 'roof_framing', used: false },
  ],
  structures: [{
    id: 'S1',
    label: 'Smith Residence',
    role: 'primary',
    source: 'plans',
    planes: [{
      id: 'S1-P1',
      plan_dims_mm: [10000, 8000],
      polygon_mm: null,
      plan_area_m2: 80,
      pitch_deg: 5,
      pitch_source: 'note',
      fall: 'south, per Mrs Nguyen',
      profile: 'Custom Orb, as Mr Smith chose',
      finish_tag: 'RF:01',
      sloped_area_m2: 80.3,
      confidence: 'high',
      evidence: [
        { file: 'Smith Residence plans.pdf', page: 2, text: 'CLIENT: J & K SMITH 0412 345 678', bbox: null },
        { file: 'Smith Residence plans.pdf', page: 3, text: '5 DEG FALL', bbox: null },
        { file: 'Engineering Citizen.pdf', page: 1, text: 'jane.citizen@example.com', bbox: null },
      ],
    }],
    edges: [{ type: 'eave', length_m: 10, source: 'measured', confidence: 'high' }],
    exclusions: [{ label: 'Deck for Mrs Papadopoulos', reason: 'Owner: Jane Citizen asked to leave it', area_m2: 12 }],
  }],
  scope: {
    includes: ['Roof sheeting for the Smith Residence'],
    excludes: ['Mr Nguyen will do the gutters'],
    questions: ['Ask Jane Citizen on 07 3812 0000 about the colour'],
  },
}

const checks: Checks = {
  version: 1,
  ran_at: '2026-11-06T00:00:00Z',
  status: 'needs_review',
  results: [
    { id: 'C1', result: 'pass', detail: 'Scale checked on A104.' },
    { id: 'C8', result: 'warning', detail: 'The drawings are PRELIMINARY for Mr J Smith.', evidence: { file: 'Smith Residence plans.pdf', page: 2 } },
  ],
  schedule: [{ label: 'Smith footprint', m2: 80, file: 'Smith Residence plans.pdf', page: 2 }],
}

describe('packTakeoff', () => {
  const pack = packTakeoff(hostile, checks)
  const all = JSON.stringify(pack)

  it('carries no name, contact detail or file name from the drawings', () => {
    for (const name of NAMES) expect(all).not.toContain(name)
    expect(all).not.toContain('.pdf')
    expect(all).not.toMatch(/CLIENT/i)
  })

  it('drops the drawing text and cites each value by its sheet', () => {
    const plane = pack.structures[0].planes[0]
    expect(plane).not.toHaveProperty('evidence')
    expect(plane.sheets).toEqual(['A104', 'file 1 page 3', 'S202'])
    expect(pack.sheets.map((s) => s.ref)).toEqual(['A104', 'file 1 page 3', 'S202'])
    expect(pack.sheets[0]).toMatchObject({ number: 'A104', revision: 'P3', kind: 'roof_plan', used: true, preliminary: true })
    expect(pack.sheets[1].preliminary).toBe(false)
    expect(pack.sheets[0]).not.toHaveProperty('status_text')
    expect(pack.checks?.results[1]).toMatchObject({ id: 'C8', result: 'warning', sheet: 'A104' })
    expect(pack.checks).not.toHaveProperty('schedule')
  })

  it('keeps the numbers and the words that carry no name', () => {
    const plane = pack.structures[0].planes[0]
    expect(plane).toMatchObject({ plan_dims_mm: [10000, 8000], plan_area_m2: 80, pitch_deg: 5, sloped_area_m2: 80.3, finish_tag: 'RF:01', confidence: 'high' })
    expect(plane.fall).toMatch(/^south/)
    expect(plane.profile).toMatch(/^Custom Orb/)
    expect(pack.structures[0]).toMatchObject({ id: 'S1', label: 'Roof S1', role: 'primary', source: 'plans' })
    expect(pack.structures[0].exclusions[0].area_m2).toBe(12)
    expect(pack.scale).toMatchObject({ stated: '1:100', sheet_size: 'A1', calibration: { method: 'title_block' } })
  })

  it('leaves the takeoff it was given as it was', () => {
    expect(hostile.structures[0].label).toBe('Smith Residence')
    expect(hostile.structures[0].planes[0].evidence).toHaveLength(3)
  })
})
