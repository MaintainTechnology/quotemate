import { describe, expect, it } from 'vitest'
import type { Checks } from '../checks'
import type { RoofPlanTakeoff } from '../schema'
import { briefHtml } from './brief'
import { packGeometry } from './geometry'
import { packTakeoff } from './privacy'

const takeoff: RoofPlanTakeoff = {
  version: 1,
  scale: { stated: '1:100', sheet_size: 'A1', pdf_page: [2384, 1684], calibration: { method: 'title_block', reference_mm: 841, factor: 35.32, delta_pct: 0.1 } },
  sheets: [
    { file: 'Architectural.pdf', page: 6, number: 'A1001A', title: 'Site plan', revision: '12', status_text: 'FOR CONSTRUCTION', kind: 'site_plan', used: true },
    { file: 'Architectural.pdf', page: 9, number: 'A2100', title: 'Sections', revision: '6', status_text: 'PRELIMINARY', kind: 'section', used: true },
    { file: 'Architectural.pdf', page: 1, number: 'A0000', title: 'Cover', revision: '3', status_text: null, kind: 'other', used: false },
  ],
  structures: [
    {
      id: 'S1', label: 'House <1>', role: 'primary', source: 'plans',
      planes: [{
        id: 'S1-P1', plan_dims_mm: [10130, 9600], polygon_mm: null, plan_area_m2: 97.25, pitch_deg: 5, pitch_source: 'note',
        fall: 'south, to the street', profile: 'Lysaght Custom Orb', finish_tag: 'RF:01', sloped_area_m2: 97.62, confidence: 'high',
        evidence: [{ file: 'Architectural.pdf', page: 6, text: 'CLIENT: J SMITH 10130 x 9600', bbox: null }],
      }],
      edges: [
        { type: 'eave', length_m: 10.13, source: 'measured', confidence: 'high' },
        { type: 'high_side', length_m: 10.13, source: 'measured', confidence: 'high' },
        { type: 'barge', length_m: 9.6, source: 'measured', confidence: 'high' },
        { type: 'barge', length_m: 9.6, source: 'measured', confidence: 'high' },
      ],
      exclusions: [{ label: 'Deck roof', reason: 'Left out by the scope note', area_m2: 14.2 }],
    },
    {
      id: 'S2', label: 'Carport', role: 'secondary', source: 'plans',
      planes: [{
        id: 'S2-P1', plan_dims_mm: null, polygon_mm: null, plan_area_m2: null, pitch_deg: 3, pitch_source: 'note',
        fall: null, profile: 'Trimdek', finish_tag: 'RF:03', sloped_area_m2: null, confidence: 'medium', evidence: [],
      }],
      edges: [],
      exclusions: [],
    },
  ],
  scope: {
    includes: ['Roof sheeting on both roofs'],
    excludes: ['The deck roof'],
    questions: ['Is the carport in the package?'],
  },
}

const checks: Checks = {
  version: 1,
  ran_at: '2026-11-06T00:00:00Z',
  status: 'needs_review',
  results: [
    { id: 'C1', result: 'pass', detail: 'Calibrated from the title block.' },
    { id: 'C5', result: 'fail', detail: 'S2-P1 has no area.' },
    { id: 'C8', result: 'warning', detail: 'A2100 is marked preliminary.', evidence: { file: 'Architectural.pdf', page: 9 } },
  ],
  schedule: [],
}

const pack = packTakeoff(takeoff, checks)
const html = briefHtml({
  branding: { businessName: 'Peppers Roofing & Co', contactLine: '07 0000 0000' },
  run: { job_ref: 'J14997', job_name: 'Grange Rd dual occupancy', site_address: '59 Grange Rd, Eastern Heights QLD 4305', scope_note: 'Roofing - Steel (Supply & Fit). Exclude the deck roof.', builder_business: 'Example Constructions Pty Ltd' },
  pack,
  geometry: packGeometry(pack.structures),
  date: new Date('2026-11-06T02:00:00Z'),
})
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('briefHtml', () => {
  it('heads the brief with the job, the site and the builder from the request', () => {
    expect(text).toContain('Roof brief')
    expect(text).toContain('J14997')
    expect(text).toContain('59 Grange Rd, Eastern Heights QLD 4305')
    expect(text).toContain('Example Constructions Pty Ltd')
    expect(text).toContain('6 November 2026')
    expect(text).toContain('Roofing - Steel (Supply &amp; Fit). Exclude the deck roof.')
  })

  it('totals the roofs and lists each with its areas and pitch', () => {
    expect(text).toMatch(/2\s*roofs/i)
    expect(text).toContain('97.62')
    expect(text).toContain('97.25')
    expect(text).toContain('House &lt;1&gt;')
    expect(html).not.toContain('House <1>')
    expect(text).toContain('Lysaght Custom Orb')
    expect(text).toMatch(/5°/)
  })

  it('draws the key plan from the pack’s geometry', () => {
    const svg = html.match(/<svg[^>]*class="keyplan"[\s\S]*?<\/svg>/)?.[0]
    expect(svg).toBeDefined()
    expect(svg!.match(/<polygon /g)).toHaveLength(1) // S2 has nothing to draw
    expect(svg).toContain('S1')
  })

  it('gives each roof its section with its planes, edges, exclusions and sheets', () => {
    expect(text).toContain('S1-P1')
    expect(text).toContain('10130 × 9600')
    expect(text).toContain('A1001A')
    expect(text).toMatch(/eave/i)
    expect(text).toContain('10.13')
    expect(text).toContain('Deck roof')
    expect(text).toMatch(/S2-P1[\s\S]*not given/i)
  })

  it('lists the scope, the questions, the checks and the drawings used', () => {
    expect(text).toContain('Roof sheeting on both roofs')
    expect(text).toContain('Is the carport in the package?')
    expect(text).toContain('Complete')
    expect(text).toContain('S2-P1 has no area.')
    expect(text).toContain('Drawing status')
    expect(text).toMatch(/needs review/i)
    expect(text).toMatch(/A2100[\s\S]*Preliminary/)
    expect(text).not.toContain('A0000') // not used
  })

  it('never totals an unknown value as zero', () => {
    // S2 has no area: the job's totals say so instead of leaving it out.
    expect(text).toMatch(/97\.25\s*\+ not given\s*m² on plan/)
    expect(text).toMatch(/97\.62\s*\+ not given\s*m² of roof/)
    const unknown = packTakeoff({ ...takeoff, structures: [takeoff.structures[1]] }, null)
    const none = briefHtml({ branding: { businessName: 'Peppers' }, run: { job_ref: null, job_name: null, site_address: '1 Test St', scope_note: null, builder_business: null }, pack: unknown, geometry: packGeometry(unknown.structures), date: new Date() })
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    expect(none).not.toContain('0.00')
    expect(none).toMatch(/not given\s*m² of roof/)
    const edgesOnly = packTakeoff({ ...takeoff, structures: [{ ...takeoff.structures[0], edges: [{ type: 'ridge', length_m: null, source: 'derived', confidence: 'low' }] }] }, null)
    const ridge = briefHtml({ branding: { businessName: 'Peppers' }, run: { job_ref: null, job_name: null, site_address: '1 Test St', scope_note: null, builder_business: null }, pack: edgesOnly, geometry: packGeometry(edgesOnly.structures), date: new Date() })
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    expect(ridge).toMatch(/ridge\s*not given\s*not given/)
  })

  it('carries no drawing text and no price', () => {
    expect(text).not.toContain('SMITH')
    expect(text).not.toContain('Architectural.pdf')
    expect(text).not.toMatch(/\$\s?\d/)
    expect(text).toMatch(/quantities only/i)
  })
})
