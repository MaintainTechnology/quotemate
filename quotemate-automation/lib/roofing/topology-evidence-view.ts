// Pure display model for the topology-evidence fixture preview.
//
// It deliberately knows only about candidate geometry and review metadata. It
// does not read quotes, call providers, or calculate commercial values.

import {
  EAVE_CANDIDATE_DISCLAIMER,
  TOPOLOGY_EVIDENCE_KINDS,
  getTopologyEvidenceFixture,
  type NormalizedSvgLine,
  type TopologyEvidenceFixture,
  type TopologyEvidenceKind,
} from './topology-evidence-fixtures'

export type TopologyEdgePresentation = {
  readonly label: string
  readonly tagPrefix: string
  readonly color: string
  readonly dashArray: string
  readonly description: string
}

// Colour is paired with an initial and line pattern so the eventual overlay
// remains legible without relying on colour alone.
export const TOPOLOGY_EDGE_PRESENTATION: Record<TopologyEvidenceKind, TopologyEdgePresentation> = {
  ridge: {
    label: 'Ridge',
    tagPrefix: 'R',
    color: '#FF375F',
    dashArray: '12 3',
    description: 'Candidate crest run',
  },
  hip: {
    label: 'Hip',
    tagPrefix: 'H',
    color: '#FF9F0A',
    dashArray: '8 2',
    description: 'Candidate sloping crest run',
  },
  valley: {
    label: 'Valley',
    tagPrefix: 'V',
    color: '#0A84FF',
    dashArray: '4 2',
    description: 'Candidate trough run',
  },
  eave: {
    label: 'Eave',
    tagPrefix: 'E',
    color: '#30D158',
    dashArray: '16 4',
    description: 'Candidate exterior roof boundary',
  },
  unknown: {
    label: 'Unknown',
    tagPrefix: 'U',
    color: '#BF5AF2',
    dashArray: '3 4',
    description: 'Ambiguous evidence retained for review',
  },
}

export type TopologyEvidenceDisplayCandidate = {
  readonly id: string
  readonly kind: TopologyEvidenceKind
  readonly number: number
  readonly tag: string
  readonly label: string
  readonly color: string
  readonly dashArray: string
  readonly geometry: NormalizedSvgLine
  readonly planLengthM: number
  readonly surfaceLengthM: number | null
  readonly confidence: number
  readonly reasons: readonly string[]
}

export type TopologyEvidenceSummary = {
  readonly kind: TopologyEvidenceKind
  readonly label: string
  readonly color: string
  readonly count: number
  readonly planLengthM: number
  readonly surfaceLengthM: number | null
}

export type TopologyEvidenceView = {
  readonly fixtureMode: 'synthetic_preview'
  readonly fixtureId: string
  readonly title: string
  readonly description: string
  readonly sourceLabel: string
  readonly reviewRequired: true
  readonly mainDwelling: TopologyEvidenceFixture['mainDwelling']
  readonly excludedStructures: readonly string[]
  readonly roofOutline: TopologyEvidenceFixture['roofOutline']
  readonly eaveNotice: string
  readonly candidates: readonly TopologyEvidenceDisplayCandidate[]
  readonly summaries: readonly TopologyEvidenceSummary[]
  readonly legend: readonly (TopologyEdgePresentation & { readonly kind: TopologyEvidenceKind })[]
}

export type BuildTopologyEvidenceViewOptions = {
  /** Filters only overlay lines; the summary remains complete for context. */
  readonly visibleKinds?: readonly TopologyEvidenceKind[]
}

function roundMetres(value: number): number {
  return Math.round(value * 10) / 10
}

function displayCandidate(
  fixture: TopologyEvidenceFixture,
  candidateIndex: number,
): TopologyEvidenceDisplayCandidate {
  const candidate = fixture.candidates[candidateIndex]
  const presentation = TOPOLOGY_EDGE_PRESENTATION[candidate.kind]
  const number = fixture.candidates
    .slice(0, candidateIndex + 1)
    .filter((item) => item.kind === candidate.kind).length
  const suffix = String(number).padStart(2, '0')
  return {
    id: candidate.id,
    kind: candidate.kind,
    number,
    tag: presentation.tagPrefix + '-' + suffix,
    label: presentation.label + ' ' + suffix,
    color: presentation.color,
    dashArray: presentation.dashArray,
    geometry: candidate.geometry,
    planLengthM: candidate.planLengthM,
    surfaceLengthM: candidate.surfaceLengthM,
    confidence: candidate.confidence,
    reasons: candidate.reasons,
  }
}

function summariesFor(fixture: TopologyEvidenceFixture): readonly TopologyEvidenceSummary[] {
  return TOPOLOGY_EVIDENCE_KINDS.map((kind) => {
    const candidates = fixture.candidates.filter((candidate) => candidate.kind === kind)
    const hasUnknownSurfaceLength = candidates.some((candidate) => candidate.surfaceLengthM === null)
    const presentation = TOPOLOGY_EDGE_PRESENTATION[kind]
    return {
      kind,
      label: presentation.label,
      color: presentation.color,
      count: candidates.length,
      planLengthM: roundMetres(candidates.reduce((sum, candidate) => sum + candidate.planLengthM, 0)),
      surfaceLengthM: hasUnknownSurfaceLength
        ? null
        : roundMetres(candidates.reduce((sum, candidate) => sum + (candidate.surfaceLengthM ?? 0), 0)),
    }
  })
}

export function buildTopologyEvidenceView(
  fixtureOrId: TopologyEvidenceFixture | string,
  options: BuildTopologyEvidenceViewOptions = {},
): TopologyEvidenceView {
  const fixture =
    typeof fixtureOrId === 'string' ? getTopologyEvidenceFixture(fixtureOrId) : fixtureOrId
  if (!fixture) {
    throw new Error(
      'Unknown topology evidence fixture: ' +
        (typeof fixtureOrId === 'string' ? fixtureOrId : fixtureOrId.id),
    )
  }

  const allowedKinds = options.visibleKinds ? new Set(options.visibleKinds) : null
  const candidates = fixture.candidates
    .map((_candidate, index) => displayCandidate(fixture, index))
    .filter((candidate) => allowedKinds === null || allowedKinds.has(candidate.kind))

  return {
    fixtureMode: 'synthetic_preview',
    fixtureId: fixture.id,
    title: fixture.title,
    description: fixture.description,
    sourceLabel: fixture.sourceLabel,
    reviewRequired: fixture.reviewRequired,
    mainDwelling: fixture.mainDwelling,
    excludedStructures: fixture.excludedStructures,
    roofOutline: fixture.roofOutline,
    eaveNotice: EAVE_CANDIDATE_DISCLAIMER,
    candidates,
    summaries: summariesFor(fixture),
    legend: TOPOLOGY_EVIDENCE_KINDS.map((kind) => ({ kind, ...TOPOLOGY_EDGE_PRESENTATION[kind] })),
  }
}
