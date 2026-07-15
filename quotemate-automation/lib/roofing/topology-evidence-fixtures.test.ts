import { describe, expect, it } from 'vitest'
import {
  ROOF_TOPOLOGY_BENCHMARK_FIXTURES,
  REQUIRED_ROOF_TOPOLOGY_BENCHMARK_SCENARIOS,
} from './edge-analysis-fixtures'
import {
  EAVE_CANDIDATE_DISCLAIMER,
  ROOF_TOPOLOGY_EVIDENCE_FIXTURES,
  getTopologyEvidenceFixture,
} from './topology-evidence-fixtures'

describe('roof topology evidence fixtures', () => {
  it('covers every existing benchmark fixture id with synthetic normalized SVG geometry', () => {
    expect(ROOF_TOPOLOGY_EVIDENCE_FIXTURES).toHaveLength(7)
    expect(ROOF_TOPOLOGY_EVIDENCE_FIXTURES.map((fixture) => fixture.id).sort()).toEqual(
      ROOF_TOPOLOGY_BENCHMARK_FIXTURES.map((fixture) => fixture.id).sort(),
    )
    expect(ROOF_TOPOLOGY_EVIDENCE_FIXTURES.map((fixture) => fixture.scenario).sort()).toEqual(
      [...REQUIRED_ROOF_TOPOLOGY_BENCHMARK_SCENARIOS].sort(),
    )

    for (const fixture of ROOF_TOPOLOGY_EVIDENCE_FIXTURES) {
      expect(fixture.geometryOrigin).toBe('synthetic')
      expect(fixture.roofOutline.length).toBeGreaterThanOrEqual(3)
      for (const [x, y] of fixture.roofOutline) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(100)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(100)
      }
      expect(fixture.candidates.length).toBeGreaterThan(0)
      expect(new Set(fixture.candidates.map((candidate) => candidate.id)).size).toBe(
        fixture.candidates.length,
      )
      for (const candidate of fixture.candidates) {
        expect(candidate.geometry.type).toBe('LineString')
        expect(candidate.geometry.coordinates.length).toBeGreaterThanOrEqual(2)
        expect(candidate.planLengthM).toBeGreaterThanOrEqual(0)
        expect(candidate.surfaceLengthM === null || candidate.surfaceLengthM >= 0).toBe(true)
        expect(candidate.confidence).toBeGreaterThanOrEqual(0)
        expect(candidate.confidence).toBeLessThanOrEqual(100)
      }
    }
  })

  it('contains no provider URLs, keys, imagery bytes, or money fields', () => {
    const serialized = JSON.stringify(ROOF_TOPOLOGY_EVIDENCE_FIXTURES)

    expect(serialized).not.toMatch(/(?:https?|gs|s3|ftp):/i)
    expect(serialized).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/)
    expect(serialized).not.toMatch(/(?:api[_-]?key|access[_-]?token|secret|authorization)\s*[:=]/i)
    expect(serialized).not.toMatch(/(?:price|tier|gst|currency|amount)/i)
  })

  it('keeps eave candidates distinct from gutter measurements', () => {
    expect(EAVE_CANDIDATE_DISCLAIMER).toMatch(/not a gutter measurement/i)
    expect(
      ROOF_TOPOLOGY_EVIDENCE_FIXTURES.some((fixture) =>
        fixture.candidates.some((candidate) => candidate.kind === 'eave'),
      ),
    ).toBe(true)
  })

  it('looks up a known fixture and returns null for an unknown id', () => {
    expect(getTopologyEvidenceFixture('synthetic-l-valley-01')?.scenario).toBe('l_valley')
    expect(getTopologyEvidenceFixture('not-a-fixture')).toBeNull()
  })
})
