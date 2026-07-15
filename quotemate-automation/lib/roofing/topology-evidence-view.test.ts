import { describe, expect, it } from 'vitest'
import {
  TOPOLOGY_EDGE_PRESENTATION,
  buildTopologyEvidenceView,
} from './topology-evidence-view'

describe('topology evidence view model', () => {
  it('creates numbered, colour-labelled candidates without quote or money fields', () => {
    const view = buildTopologyEvidenceView('synthetic-l-valley-01')

    expect(view.fixtureMode).toBe('synthetic_preview')
    expect(view.reviewRequired).toBe(true)
    expect(view.candidates.map((candidate) => candidate.tag)).toEqual(['R-01', 'H-01', 'V-01', 'E-01'])
    expect(view.candidates.find((candidate) => candidate.kind === 'valley')).toMatchObject({
      color: '#0A84FF',
      label: 'Valley 01',
    })
    expect(view.summaries.find((summary) => summary.kind === 'valley')).toMatchObject({
      count: 1,
      planLengthM: 6.7,
      surfaceLengthM: 7.2,
    })
    expect(view.eaveNotice).toMatch(/not a gutter measurement/i)

    const serialized = JSON.stringify(view)
    expect(serialized).not.toMatch(/(?:price|tier|gst|currency|amount)/i)
  })

  it('keeps label, colour, and line style distinct for every semantic kind', () => {
    expect(TOPOLOGY_EDGE_PRESENTATION.ridge).toMatchObject({ color: '#FF375F', tagPrefix: 'R' })
    expect(TOPOLOGY_EDGE_PRESENTATION.hip).toMatchObject({ color: '#FF9F0A', tagPrefix: 'H' })
    expect(TOPOLOGY_EDGE_PRESENTATION.valley).toMatchObject({ color: '#0A84FF', tagPrefix: 'V' })
    expect(TOPOLOGY_EDGE_PRESENTATION.eave).toMatchObject({ color: '#30D158', tagPrefix: 'E' })
    expect(TOPOLOGY_EDGE_PRESENTATION.unknown).toMatchObject({ color: '#BF5AF2', tagPrefix: 'U' })
    expect(new Set(Object.values(TOPOLOGY_EDGE_PRESENTATION).map((style) => style.tagPrefix)).size).toBe(5)
  })

  it('filters visible candidates while retaining the full candidate summary', () => {
    const view = buildTopologyEvidenceView('synthetic-l-valley-01', {
      visibleKinds: ['valley', 'eave'],
    })

    expect(view.candidates.map((candidate) => candidate.kind)).toEqual(['valley', 'eave'])
    expect(view.summaries.find((summary) => summary.kind === 'ridge')?.count).toBe(1)
    expect(view.summaries.find((summary) => summary.kind === 'hip')?.count).toBe(1)
  })

  it('shows selected dwelling and excluded shed context for the multi-structure fixture', () => {
    const view = buildTopologyEvidenceView('synthetic-multi-structure-01')

    expect(view.mainDwelling).toMatchObject({ structureIndex: 1, confirmed: true })
    expect(view.excludedStructures).toContain('Larger detached shed')
  })

  it('rejects an unknown fixture id', () => {
    expect(() => buildTopologyEvidenceView('not-a-fixture')).toThrow(/unknown topology evidence fixture/i)
  })
})
