import { describe, expect, it } from 'vitest'
import { buildRoofCandidateOverlay, ROOF_CANDIDATE_PRESENTATION } from './roof-candidate-overlay'
import type { GeoJSONPolygon } from './types'

const CENTER = { lat: -27.47, lng: 153.02 }
const D = 0.0001

const square: GeoJSONPolygon = {
  type: 'Polygon',
  coordinates: [[
    [CENTER.lng - D, CENTER.lat - D],
    [CENTER.lng + D, CENTER.lat - D],
    [CENTER.lng + D, CENTER.lat + D],
    [CENTER.lng - D, CENTER.lat + D],
    [CENTER.lng - D, CENTER.lat - D],
  ]],
}

const lShape: GeoJSONPolygon = {
  type: 'Polygon',
  coordinates: [[
    [CENTER.lng - D, CENTER.lat - D],
    [CENTER.lng + D, CENTER.lat - D],
    [CENTER.lng + D, CENTER.lat],
    [CENTER.lng, CENTER.lat],
    [CENTER.lng, CENTER.lat + D],
    [CENTER.lng - D, CENTER.lat + D],
    [CENTER.lng - D, CENTER.lat - D],
  ]],
}

function facetAreas(svg: string): number[] {
  return [...svg.matchAll(/<polygon data-facet="\d+" points="([^"]+)"/g)].map((match) => {
    const points = match[1].split(' ').map((pair) => pair.split(',').map(Number))
    let twiceArea = 0
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index]
      const next = points[(index + 1) % points.length]
      twiceArea += current[0] * next[1] - next[0] * current[1]
    }
    return Math.abs(twiceArea / 2)
  })
}

function inside(point: readonly [number, number], polygon: readonly number[][]): boolean {
  let result = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]
    const b = polygon[j]
    const crosses =
      (a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    if (crosses) result = !result
  }
  return result
}

describe('buildRoofCandidateOverlay', () => {
  it('draws numbered zones without semantic edge guides or large edge bubbles', () => {
    const result = buildRoofCandidateOverlay({
      polygon: square,
      form: 'hip',
      hips: 4,
      valleys: 0,
      ridgeLm: 8.2,
      roofSegmentCount: 8,
      pitchDegrees: 25,
      hipEstimateLm: 22.4,
      valleyEstimateLm: 0,
    })

    expect(result).not.toBeNull()
    expect(result?.mode).toBe('footprint_candidate')
    expect(result?.facetCount).toBe(8)
    expect(result?.facetCountSource).toBe('solar_segment_count')
    expect(result?.svg).not.toContain('FOOTPRINT CANDIDATE · REVIEW REQUIRED')
    expect(result?.svg).toContain('data-facet="8"')
    expect(result?.svg).not.toContain('data-candidate-kind=')
    expect(result?.svg).not.toContain('data-candidate-tag=')
    expect(result?.svg).not.toContain('<line ')
    expect(result?.svg).toContain('fill="#F7C948" fill-opacity="0.3" stroke="#F7C948"')
    expect(result?.imageSrc).toMatch(/^data:image\/svg\+xml/)
    expect(facetAreas(result!.svg)).toHaveLength(8)
    expect(facetAreas(result!.svg).every((area) => area > 0)).toBe(true)
  })

  it('keeps semantic colours in summaries without drawing semantic lines', () => {
    const result = buildRoofCandidateOverlay({
      polygon: lShape,
      form: 'gable_hip',
      hips: 2,
      valleys: 1,
      ridgeLm: 7,
      roofSegmentCount: null,
      pitchDegrees: 22,
    })!

    for (const [kind, presentation] of Object.entries(ROOF_CANDIDATE_PRESENTATION)) {
      const summary = result.summaries.find((item) => item.kind === kind)
      expect(summary?.color).toBe(presentation.color)
    }
    expect(result.svg).not.toContain('data-candidate-kind=')
    expect(result.svg).not.toContain('data-candidate-tag=')
  })

  it('treats only the two longest gable boundaries as eave candidates', () => {
    const result = buildRoofCandidateOverlay({
      polygon: square,
      form: 'gable',
      hips: 0,
      valleys: 0,
      ridgeLm: 16,
      roofSegmentCount: 2,
      pitchDegrees: 20,
    })!
    const eave = result.summaries.find((summary) => summary.kind === 'eave')
    const hip = result.summaries.find((summary) => summary.kind === 'hip')

    expect(eave?.locatedCount).toBe(2)
    expect(hip?.locatedCount).toBe(0)
    expect(result.guides.filter((guide) => guide.kind === 'ridge')).toHaveLength(1)
    expect(result.svg).not.toContain('data-candidate-kind=')
    expect(facetAreas(result.svg)).toHaveLength(2)
    expect(facetAreas(result.svg).every((area) => area > 0)).toBe(true)
  })

  it('fills a one-zone fallback without creating a degenerate polygon', () => {
    const result = buildRoofCandidateOverlay({
      polygon: square,
      form: 'skillion',
      hips: 0,
      valleys: 0,
      ridgeLm: 0,
      roofSegmentCount: 1,
      pitchDegrees: 8,
    })!

    expect(facetAreas(result.svg)).toHaveLength(1)
    expect(facetAreas(result.svg)[0]).toBeGreaterThan(0)
  })

  it('does not draw internal candidates through a concave roof courtyard', () => {
    const uShape: GeoJSONPolygon = {
      type: 'Polygon',
      coordinates: [[
        [CENTER.lng - D * 1.5, CENTER.lat - D],
        [CENTER.lng + D * 1.5, CENTER.lat - D],
        [CENTER.lng + D * 1.5, CENTER.lat + D],
        [CENTER.lng + D * 0.5, CENTER.lat + D],
        [CENTER.lng + D * 0.5, CENTER.lat],
        [CENTER.lng - D * 0.5, CENTER.lat],
        [CENTER.lng - D * 0.5, CENTER.lat + D],
        [CENTER.lng - D * 1.5, CENTER.lat + D],
        [CENTER.lng - D * 1.5, CENTER.lat - D],
      ]],
    }
    const result = buildRoofCandidateOverlay({
      polygon: uShape,
      form: 'gable_hip',
      hips: 6,
      valleys: 2,
      ridgeLm: 12,
      roofSegmentCount: 8,
      pitchDegrees: 20,
    })!
    const outlineMatch = result.svg.match(
      /<polygon data-roof-outline="true" points="([^"]+)"/,
    )
    expect(outlineMatch).not.toBeNull()
    const outline = outlineMatch![1].split(' ').map((pair) => pair.split(',').map(Number))

    for (const guide of result.guides.filter((candidate) => candidate.kind !== 'eave')) {
      const [start, end] = guide.points
      for (let step = 1; step < 24; step += 1) {
        const t = step / 24
        expect(inside([
          start[0] + (end[0] - start[0]) * t,
          start[1] + (end[1] - start[1]) * t,
        ], outline)).toBe(true)
      }
    }
  })

  it('respects an explicit zero ridge length for pyramidal hip roofs', () => {
    const result = buildRoofCandidateOverlay({
      polygon: square,
      form: 'hip',
      hips: 4,
      valleys: 0,
      ridgeLm: 0,
      roofSegmentCount: 4,
      pitchDegrees: 25,
    })!

    expect(result.guides.filter((guide) => guide.kind === 'ridge')).toHaveLength(0)
    expect(result.summaries.find((summary) => summary.kind === 'ridge')?.existingEstimateLm).toBe(0)
  })

  it('does not truncate detailed eave boundaries and reports visual facet capping', () => {
    const ring: number[][] = []
    for (let index = 0; index < 30; index += 1) {
      const angle = (index * Math.PI * 2) / 30
      ring.push([
        CENTER.lng + Math.cos(angle) * D,
        CENTER.lat + Math.sin(angle) * D,
      ])
    }
    ring.push([...ring[0]])
    const result = buildRoofCandidateOverlay({
      polygon: { type: 'Polygon', coordinates: [ring] },
      form: 'hip',
      hips: 0,
      valleys: 0,
      ridgeLm: 0,
      roofSegmentCount: 30,
      pitchDegrees: 25,
    })!

    expect(result.summaries.find((summary) => summary.kind === 'eave')?.locatedCount).toBe(30)
    expect(result.facetCount).toBe(24)
    expect(result.reportedFacetCount).toBe(30)
  })

  it('keeps reported scalar counts separate when the footprint cannot locate every guide', () => {
    const result = buildRoofCandidateOverlay({
      polygon: square,
      form: 'hip',
      hips: 6,
      valleys: 0,
      ridgeLm: 8,
      roofSegmentCount: null,
      pitchDegrees: null,
    })!
    const hips = result.summaries.find((summary) => summary.kind === 'hip')

    expect(hips?.reportedCount).toBe(6)
    expect(hips?.locatedCount).toBe(4)
  })

  it('returns null instead of inventing an overlay without usable property geometry', () => {
    expect(buildRoofCandidateOverlay({
      polygon: null,
      form: 'unknown',
      hips: null,
      valleys: null,
      ridgeLm: null,
      roofSegmentCount: null,
      pitchDegrees: null,
    })).toBeNull()
  })

  it('contains no provider URL, source asset, or credential-shaped value', () => {
    const result = buildRoofCandidateOverlay({
      polygon: square,
      form: 'hip',
      hips: 4,
      valleys: 0,
      ridgeLm: 8,
      roofSegmentCount: 4,
      pitchDegrees: 25,
    })!

    // The SVG namespace is an XML identifier, not a fetched provider asset.
    expect(result.svg).not.toMatch(/<(?:image|a)\b[^>]*(?:href|src)=["']https?:\/\//i)
    expect(result.svg).not.toMatch(/AIza|api[_-]?key|retained[_-]?asset/i)
  })

  it('uses subtle sub-pixel zone boundaries and roof outline', () => {
    const result = buildRoofCandidateOverlay({
      polygon: square,
      form: 'hip',
      hips: 4,
      valleys: 0,
      ridgeLm: 8,
      roofSegmentCount: 4,
      pitchDegrees: 25,
    })!

    expect(result.svg).toMatch(
      /data-facet="1"[^>]*fill-opacity="0\.3"[^>]*stroke-opacity="0\.28"[^>]*stroke-width="0\.6"/,
    )
    expect(result.svg).toMatch(
      /data-roof-outline="true"[^>]*stroke-opacity="0\.38"[^>]*stroke-width="0\.7"/,
    )
  })
})
