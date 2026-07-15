import { describe, expect, it } from 'vitest'

import {
  reconstructRoofFacets,
  type FacetPlaneSeed,
  type FacetReconstructionInput,
} from './facet-reconstruction'

function flatPlane(
  index: number,
  height: number,
  overrides: Partial<FacetPlaneSeed> = {},
): FacetPlaneSeed {
  return {
    id: `plane-${index}`,
    index,
    pitchDegrees: 0,
    azimuthDegrees: 0,
    planeHeightAtCenterMeters: height,
    centerPixel: [0, 0],
    ...overrides,
  }
}

function input(overrides: Partial<FacetReconstructionInput> = {}): FacetReconstructionInput {
  return {
    width: 3,
    height: 1,
    pixelSizeM: 1,
    dsm: new Float32Array([10, 20, 10]),
    mask: new Uint8Array([1, 1, 1]),
    planes: [flatPlane(0, 10), flatPlane(1, 20)],
    ...overrides,
  }
}

describe('reconstructRoofFacets', () => {
  it('assigns masked pixels to the least-residual planes and preserves output sentinels', () => {
    const result = reconstructRoofFacets(
      input({
        width: 4,
        dsm: new Float32Array([10, 20, Number.NaN, 10]),
        mask: new Uint8Array([1, 1, 0, 1]),
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.reconstruction.labels).toBeInstanceOf(Int16Array)
    expect([...result.reconstruction.labels]).toEqual([0, 1, -1, 0])
    expect(result.reconstruction.residuals).toBeInstanceOf(Float32Array)
    expect(result.reconstruction.residuals[0]).toBe(0)
    expect(result.reconstruction.residuals[1]).toBe(0)
    expect(result.reconstruction.residuals[2]).toBe(Number.POSITIVE_INFINITY)
    expect(result.reconstruction.fitSummary).toMatchObject({
      planeSeedCount: 2,
      assignedFacetCount: 2,
      maskedPixelCount: 3,
      assignedPixelCount: 3,
      unassignedPixelCount: 0,
      medianResidualM: 0,
      p90ResidualM: 0,
    })
  })

  it('uses pitch, compass azimuth, centre pixel, and pixel size for height prediction', () => {
    const result = reconstructRoofFacets({
      width: 3,
      height: 1,
      pixelSizeM: 1,
      // A 45-degree east-facing plane descends by one metre per pixel east.
      dsm: new Float32Array([11, 10, 9]),
      mask: new Uint8Array([1, 1, 1]),
      planes: [
        {
          id: 'east-facing',
          index: 7,
          pitchDegrees: 45,
          azimuthDegrees: 90,
          planeHeightAtCenterMeters: 10,
          centerPixel: [1, 0],
        },
        flatPlane(9, 100),
      ],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([...result.reconstruction.labels]).toEqual([7, 7, 7])
    expect([...result.reconstruction.residuals]).toEqual([0, 0, 0])
  })

  it('uses optional bounds as candidate windows and falls back to all planes in gaps', () => {
    const result = reconstructRoofFacets(
      input({
        dsm: new Float32Array([20, 20, 10]),
        planes: [
          flatPlane(0, 10, {
            boundsPixel: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
          }),
          flatPlane(1, 20, {
            boundsPixel: { minX: 2, minY: 0, maxX: 2, maxY: 0 },
          }),
        ],
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // x=0 and x=2 respect their only in-window candidate; x=1 is in neither
    // box and therefore falls back to the true least-residual plane.
    expect([...result.reconstruction.labels]).toEqual([0, 1, 1])
    expect([...result.reconstruction.residuals]).toEqual([10, 0, 10])
  })

  it('applies conservative synchronous majority smoothing and updates the residual', () => {
    const dsm = new Float32Array(25)
    dsm.fill(10)
    dsm[12] = 10.2

    const result = reconstructRoofFacets({
      width: 5,
      height: 5,
      pixelSizeM: 0.25,
      dsm,
      mask: new Uint8Array(25).fill(1),
      planes: [flatPlane(0, 10), flatPlane(1, 10.2)],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.reconstruction.labels[12]).toBe(0)
    expect(result.reconstruction.residuals[12]).toBeCloseTo(0.2, 5)
    expect(result.reconstruction.facets.find((facet) => facet.index === 1)?.pixelCount).toBe(0)
  })

  it('returns deterministic per-facet centroids and lower-rank median/p90 residuals', () => {
    const result = reconstructRoofFacets({
      width: 4,
      height: 2,
      pixelSizeM: 1,
      dsm: new Float32Array([
        10, 11, 20, 22,
        12, 13, 24, 26,
      ]),
      mask: new Uint8Array(8).fill(1),
      planes: [
        flatPlane(8, 20, {
          boundsPixel: { minX: 2, minY: 0, maxX: 3, maxY: 1 },
        }),
        flatPlane(3, 10, {
          boundsPixel: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        }),
      ],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Facets are ordered by stable index, independent of input order.
    expect(result.reconstruction.facets).toEqual([
      {
        id: 'plane-3',
        index: 3,
        pixelCount: 4,
        centroidPixel: [0.5, 0.5],
        medianResidualM: 1,
        p90ResidualM: 2,
      },
      {
        id: 'plane-8',
        index: 8,
        pixelCount: 4,
        centroidPixel: [2.5, 0.5],
        medianResidualM: 2,
        p90ResidualM: 4,
      },
    ])
    expect(result.reconstruction.fitSummary.medianResidualM).toBe(2)
    expect(result.reconstruction.fitSummary.p90ResidualM).toBe(4)
  })

  it('uses every selected mask pixel without choosing or growing a centre component', () => {
    const result = reconstructRoofFacets({
      width: 5,
      height: 1,
      pixelSizeM: 1,
      dsm: new Float32Array([10, Number.NaN, Number.NaN, Number.NaN, 20]),
      // Two disconnected selected pixels are both caller-authorized input.
      mask: new Uint8Array([1, 0, 0, 0, 1]),
      planes: [flatPlane(0, 10), flatPlane(1, 20)],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([...result.reconstruction.labels]).toEqual([0, -1, -1, -1, 1])
    expect(result.reconstruction.fitSummary.maskedPixelCount).toBe(2)
  })

  it('breaks equal-residual ties by the stable plane index', () => {
    const result = reconstructRoofFacets(
      input({
        width: 1,
        dsm: new Float32Array([10]),
        mask: new Uint8Array([1]),
        planes: [flatPlane(12, 10), flatPlane(2, 10)],
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([...result.reconstruction.labels]).toEqual([2])
    expect(result.reconstruction.facets.map((facet) => facet.index)).toEqual([2, 12])
  })

  it('returns failures instead of throwing for invalid dimensions, rasters, planes, and masks', () => {
    const cases: Array<[Partial<FacetReconstructionInput>, string]> = [
      [{ width: 0 }, 'invalid_input'],
      [{ width: 5_000 }, 'limits_exceeded'],
      [{ dsm: new Float32Array(2) }, 'invalid_input'],
      [{ mask: new Float32Array([1, -1, 1]) }, 'invalid_input'],
      [{ mask: new Uint8Array([0, 0, 0]) }, 'empty_mask'],
      [{ dsm: new Float32Array([10, Number.NaN, 10]) }, 'invalid_input'],
      [{ planes: [flatPlane(0, 10), flatPlane(0, 20)] }, 'invalid_input'],
      [{ planes: [flatPlane(0, 10, { pitchDegrees: 90 })] }, 'invalid_input'],
    ]

    for (const [overrides, code] of cases) {
      expect(() => reconstructRoofFacets(input(overrides))).not.toThrow()
      expect(reconstructRoofFacets(input(overrides))).toMatchObject({ ok: false, code })
    }
  })

  it('does not produce or imply semantic roof-edge classifications', () => {
    const result = reconstructRoofFacets(input())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const serialized = JSON.stringify({
      facets: result.reconstruction.facets,
      fitSummary: result.reconstruction.fitSummary,
    })
    expect(serialized).not.toMatch(/hip|valley|ridge|eave|edge/i)
  })
})
