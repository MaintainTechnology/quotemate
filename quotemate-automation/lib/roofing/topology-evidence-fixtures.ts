// Synthetic SVG fixtures for the dashboard-only topology-evidence preview.
//
// These are deliberately normalised drawing coordinates, not property geometry.
// They carry no imagery, source URLs, credentials, customer data, or money data.

import type { RoofTopologyBenchmarkScenario } from './edge-analysis-fixtures'

export const TOPOLOGY_EVIDENCE_KINDS = ['ridge', 'hip', 'valley', 'eave', 'unknown'] as const
export type TopologyEvidenceKind = (typeof TOPOLOGY_EVIDENCE_KINDS)[number]

export type NormalizedSvgPoint = readonly [number, number]

export type NormalizedSvgLine = {
  readonly type: 'LineString'
  readonly coordinates: readonly NormalizedSvgPoint[]
}

export type TopologyEvidenceCandidateFixture = {
  readonly id: string
  readonly kind: TopologyEvidenceKind
  readonly geometry: NormalizedSvgLine
  readonly planLengthM: number
  readonly surfaceLengthM: number | null
  readonly confidence: number
  readonly reasons: readonly string[]
}

export type TopologyEvidenceFixture = {
  /** Matches the existing benchmark fixture identifier exactly. */
  readonly id: string
  readonly scenario: RoofTopologyBenchmarkScenario
  /** Every visual coordinate here is hand-authored synthetic SVG geometry. */
  readonly geometryOrigin: 'synthetic'
  readonly title: string
  readonly description: string
  readonly reviewRequired: true
  readonly sourceLabel: 'Synthetic normalized SVG benchmark'
  readonly mainDwelling: {
    readonly structureIndex: number
    readonly label: string
    readonly confirmed: true
  }
  readonly excludedStructures: readonly string[]
  /** Normalised SVG polygon points in a 0–100 viewBox. */
  readonly roofOutline: readonly NormalizedSvgPoint[]
  readonly candidates: readonly TopologyEvidenceCandidateFixture[]
}

export const EAVE_CANDIDATE_DISCLAIMER =
  'Eave candidate — roof-boundary evidence only; it is not a gutter measurement.'

const line = (coordinates: readonly NormalizedSvgPoint[]): NormalizedSvgLine => ({
  type: 'LineString',
  coordinates,
})

export const ROOF_TOPOLOGY_EVIDENCE_FIXTURES: readonly TopologyEvidenceFixture[] = [
  {
    id: 'synthetic-gable-01',
    scenario: 'gable',
    geometryOrigin: 'synthetic',
    title: 'Gable baseline',
    description: 'Simple gable roof showing a central ridge and exterior eave evidence.',
    reviewRequired: true,
    sourceLabel: 'Synthetic normalized SVG benchmark',
    mainDwelling: { structureIndex: 1, label: 'Main dwelling', confirmed: true },
    excludedStructures: [],
    roofOutline: [[15, 18], [85, 18], [85, 82], [15, 82]],
    candidates: [
      {
        id: 'gable-ridge-01',
        kind: 'ridge',
        geometry: line([[24, 50], [76, 50]]),
        planLengthM: 12.4,
        surfaceLengthM: 12.4,
        confidence: 91,
        reasons: ['Synthetic plane intersection', 'Continuous crest'],
      },
      {
        id: 'gable-eave-01',
        kind: 'eave',
        geometry: line([[15, 75], [85, 75]]),
        planLengthM: 14.8,
        surfaceLengthM: 14.8,
        confidence: 88,
        reasons: ['Synthetic exterior boundary'],
      },
    ],
  },
  {
    id: 'synthetic-hip-01',
    scenario: 'hip',
    geometryOrigin: 'synthetic',
    title: 'Hip baseline',
    description: 'Four-sided hip roof with a ridge, paired hips, and eave evidence.',
    reviewRequired: true,
    sourceLabel: 'Synthetic normalized SVG benchmark',
    mainDwelling: { structureIndex: 1, label: 'Main dwelling', confirmed: true },
    excludedStructures: [],
    roofOutline: [[22, 16], [78, 16], [92, 50], [78, 84], [22, 84], [8, 50]],
    candidates: [
      {
        id: 'hip-ridge-01',
        kind: 'ridge',
        geometry: line([[34, 50], [66, 50]]),
        planLengthM: 8.2,
        surfaceLengthM: 8.3,
        confidence: 89,
        reasons: ['Synthetic crest alignment'],
      },
      {
        id: 'hip-run-01',
        kind: 'hip',
        geometry: line([[34, 50], [22, 18]]),
        planLengthM: 6.3,
        surfaceLengthM: 7,
        confidence: 85,
        reasons: ['Synthetic sloping crest'],
      },
      {
        id: 'hip-run-02',
        kind: 'hip',
        geometry: line([[66, 50], [78, 18]]),
        planLengthM: 6.3,
        surfaceLengthM: 7,
        confidence: 85,
        reasons: ['Synthetic sloping crest'],
      },
      {
        id: 'hip-eave-01',
        kind: 'eave',
        geometry: line([[8, 50], [22, 84], [78, 84], [92, 50]]),
        planLengthM: 21.1,
        surfaceLengthM: 21.1,
        confidence: 86,
        reasons: ['Synthetic exterior boundary'],
      },
    ],
  },
  {
    id: 'synthetic-l-valley-01',
    scenario: 'l_valley',
    geometryOrigin: 'synthetic',
    title: 'L-shaped valley',
    description: 'L-shaped main dwelling with a candidate valley kept separate from the eave.',
    reviewRequired: true,
    sourceLabel: 'Synthetic normalized SVG benchmark',
    mainDwelling: { structureIndex: 1, label: 'Main dwelling', confirmed: true },
    excludedStructures: [],
    roofOutline: [[12, 15], [60, 15], [60, 35], [88, 35], [88, 86], [12, 86]],
    candidates: [
      {
        id: 'l-valley-ridge-01',
        kind: 'ridge',
        geometry: line([[24, 46], [53, 46]]),
        planLengthM: 7.1,
        surfaceLengthM: 7.2,
        confidence: 86,
        reasons: ['Synthetic internal crest'],
      },
      {
        id: 'l-valley-hip-01',
        kind: 'hip',
        geometry: line([[53, 46], [60, 35]]),
        planLengthM: 3.8,
        surfaceLengthM: 4.1,
        confidence: 79,
        reasons: ['Synthetic sloping crest'],
      },
      {
        id: 'l-valley-run-01',
        kind: 'valley',
        geometry: line([[60, 35], [60, 68]]),
        planLengthM: 6.7,
        surfaceLengthM: 7.2,
        confidence: 83,
        reasons: ['Synthetic trough alignment', 'Continuous contact'],
      },
      {
        id: 'l-valley-eave-01',
        kind: 'eave',
        geometry: line([[12, 86], [88, 86]]),
        planLengthM: 16.4,
        surfaceLengthM: 16.4,
        confidence: 87,
        reasons: ['Synthetic exterior boundary'],
      },
    ],
  },
  {
    id: 'licensed-dormer-01',
    scenario: 'dormer',
    geometryOrigin: 'synthetic',
    title: 'Dormer ambiguity',
    description: 'Dormer geometry preserves an ambiguous small contact as unknown evidence.',
    reviewRequired: true,
    sourceLabel: 'Synthetic normalized SVG benchmark',
    mainDwelling: { structureIndex: 1, label: 'Main dwelling', confirmed: true },
    excludedStructures: [],
    roofOutline: [[12, 18], [88, 18], [88, 82], [12, 82]],
    candidates: [
      {
        id: 'dormer-ridge-01',
        kind: 'ridge',
        geometry: line([[22, 54], [78, 54]]),
        planLengthM: 13.6,
        surfaceLengthM: 13.7,
        confidence: 82,
        reasons: ['Synthetic primary crest'],
      },
      {
        id: 'dormer-valley-01',
        kind: 'valley',
        geometry: line([[44, 54], [38, 34]]),
        planLengthM: 4.2,
        surfaceLengthM: 4.7,
        confidence: 68,
        reasons: ['Synthetic dormer trough'],
      },
      {
        id: 'dormer-eave-01',
        kind: 'eave',
        geometry: line([[12, 77], [88, 77]]),
        planLengthM: 15.8,
        surfaceLengthM: 15.8,
        confidence: 84,
        reasons: ['Synthetic exterior boundary'],
      },
      {
        id: 'dormer-unknown-01',
        kind: 'unknown',
        geometry: line([[56, 54], [62, 39]]),
        planLengthM: 3.1,
        surfaceLengthM: null,
        confidence: 39,
        reasons: ['Synthetic ambiguous dormer contact'],
      },
    ],
  },
  {
    id: 'licensed-tree-cover-01',
    scenario: 'tree_covered',
    geometryOrigin: 'synthetic',
    title: 'Tree-cover review',
    description: 'Occluded section leaves a low-confidence candidate explicitly unknown.',
    reviewRequired: true,
    sourceLabel: 'Synthetic normalized SVG benchmark',
    mainDwelling: { structureIndex: 1, label: 'Main dwelling', confirmed: true },
    excludedStructures: [],
    roofOutline: [[15, 16], [85, 16], [91, 50], [78, 84], [22, 84], [9, 50]],
    candidates: [
      {
        id: 'tree-ridge-01',
        kind: 'ridge',
        geometry: line([[29, 50], [64, 50]]),
        planLengthM: 9.4,
        surfaceLengthM: 9.5,
        confidence: 74,
        reasons: ['Synthetic visible crest'],
      },
      {
        id: 'tree-eave-01',
        kind: 'eave',
        geometry: line([[22, 80], [65, 80]]),
        planLengthM: 10.6,
        surfaceLengthM: 10.6,
        confidence: 67,
        reasons: ['Synthetic visible exterior boundary'],
      },
      {
        id: 'tree-unknown-01',
        kind: 'unknown',
        geometry: line([[65, 80], [79, 67]]),
        planLengthM: 4.5,
        surfaceLengthM: null,
        confidence: 31,
        reasons: ['Synthetic tree-obscured boundary'],
      },
    ],
  },
  {
    id: 'licensed-solar-cover-01',
    scenario: 'solar_covered',
    geometryOrigin: 'synthetic',
    title: 'Solar-cover review',
    description: 'Rooftop panel obstruction leaves the covered boundary as unknown.',
    reviewRequired: true,
    sourceLabel: 'Synthetic normalized SVG benchmark',
    mainDwelling: { structureIndex: 1, label: 'Main dwelling', confirmed: true },
    excludedStructures: [],
    roofOutline: [[14, 18], [86, 18], [86, 82], [14, 82]],
    candidates: [
      {
        id: 'solar-ridge-01',
        kind: 'ridge',
        geometry: line([[24, 48], [76, 48]]),
        planLengthM: 12.8,
        surfaceLengthM: 12.9,
        confidence: 77,
        reasons: ['Synthetic visible crest'],
      },
      {
        id: 'solar-eave-01',
        kind: 'eave',
        geometry: line([[14, 76], [86, 76]]),
        planLengthM: 15.2,
        surfaceLengthM: 15.2,
        confidence: 82,
        reasons: ['Synthetic exterior boundary'],
      },
      {
        id: 'solar-unknown-01',
        kind: 'unknown',
        geometry: line([[51, 48], [51, 68]]),
        planLengthM: 4.4,
        surfaceLengthM: null,
        confidence: 34,
        reasons: ['Synthetic panel-obscured contact'],
      },
    ],
  },
  {
    id: 'synthetic-multi-structure-01',
    scenario: 'multi_structure',
    geometryOrigin: 'synthetic',
    title: 'Main dwelling selection',
    description: 'Confirmed main dwelling remains selected while a larger detached shed is excluded.',
    reviewRequired: true,
    sourceLabel: 'Synthetic normalized SVG benchmark',
    mainDwelling: { structureIndex: 1, label: 'Main dwelling', confirmed: true },
    excludedStructures: ['Larger detached shed'],
    roofOutline: [[18, 17], [74, 17], [89, 49], [74, 83], [18, 83], [5, 49]],
    candidates: [
      {
        id: 'multi-ridge-01',
        kind: 'ridge',
        geometry: line([[30, 49], [62, 49]]),
        planLengthM: 8.5,
        surfaceLengthM: 8.6,
        confidence: 90,
        reasons: ['Synthetic main dwelling crest'],
      },
      {
        id: 'multi-hip-01',
        kind: 'hip',
        geometry: line([[30, 49], [18, 18]]),
        planLengthM: 6.1,
        surfaceLengthM: 6.8,
        confidence: 84,
        reasons: ['Synthetic main dwelling hip'],
      },
      {
        id: 'multi-eave-01',
        kind: 'eave',
        geometry: line([[18, 79], [74, 79]]),
        planLengthM: 12.6,
        surfaceLengthM: 12.6,
        confidence: 86,
        reasons: ['Synthetic main dwelling exterior boundary'],
      },
    ],
  },
] as const

export function getTopologyEvidenceFixture(id: string): TopologyEvidenceFixture | null {
  return ROOF_TOPOLOGY_EVIDENCE_FIXTURES.find((fixture) => fixture.id === id) ?? null
}
