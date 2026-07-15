/**
 * Pure raster-to-plane facet reconstruction.
 *
 * This module deliberately knows nothing about providers, storage, buildings,
 * or semantic roof edges. The caller must supply the already-selected roof
 * mask component and plane seeds in raster pixel coordinates. A successful
 * result is still only a plane assignment; it is not a hip, valley, ridge, or
 * eave measurement.
 */

const UNASSIGNED_LABEL = -1
const MAX_DIMENSION = 4_096
const MAX_PIXEL_COUNT = 4_194_304
const MAX_PLANE_COUNT = 256
const MAX_ASSIGNMENT_COMPARISONS = 100_000_000
const MAX_PLANE_INDEX = 32_766
const MIN_PIXEL_SIZE_METERS = 0.01
const MAX_PIXEL_SIZE_METERS = 10
const MAX_ABSOLUTE_HEIGHT_METERS = 50_000
const MAX_ABSOLUTE_PIXEL_COORDINATE = 1_000_000

const SMOOTHING_ITERATIONS = 3
const SMOOTHING_MAJORITY_COUNT = 5
const SMOOTHING_RESIDUAL_TOLERANCE_METERS = 0.35

export type FacetPixelBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type FacetPlaneSeed = {
  /** Stable provider/application identifier retained in the output. */
  id: string
  /** Stable Int16-compatible label written into the output label raster. */
  index: number
  pitchDegrees: number
  /** Compass bearing of downslope direction, clockwise from north. */
  azimuthDegrees: number
  planeHeightAtCenterMeters: number
  /** Plane centre in the same [x, y] pixel coordinate system as the rasters. */
  centerPixel: readonly [number, number]
  /** Optional candidate window. If no window contains a pixel, all planes are considered. */
  boundsPixel?: FacetPixelBounds
}

export type FacetReconstructionInput = {
  width: number
  height: number
  pixelSizeM: number
  /** Row-major DSM values. Non-finite no-data is allowed only outside the selected mask. */
  dsm: ArrayLike<number>
  /** Row-major, already-selected component: positive is selected and zero is excluded. */
  mask: ArrayLike<number>
  planes: readonly FacetPlaneSeed[]
}

export type ReconstructedFacetStats = {
  id: string
  index: number
  pixelCount: number
  centroidPixel: readonly [number, number] | null
  medianResidualM: number | null
  p90ResidualM: number | null
}

export type FacetReconstructionFitSummary = {
  planeSeedCount: number
  assignedFacetCount: number
  maskedPixelCount: number
  assignedPixelCount: number
  unassignedPixelCount: number
  medianResidualM: number | null
  p90ResidualM: number | null
}

export type FacetReconstruction = {
  width: number
  height: number
  pixelSizeM: number
  /** Row-major plane indices; -1 means outside the mask or unassigned. */
  labels: Int16Array
  /** Row-major absolute height residuals in metres; unassigned pixels are +Infinity. */
  residuals: Float32Array
  facets: ReconstructedFacetStats[]
  fitSummary: FacetReconstructionFitSummary
}

export type FacetReconstructionFailureCode =
  | 'invalid_input'
  | 'limits_exceeded'
  | 'empty_mask'

export type FacetReconstructionResult =
  | { ok: true; reconstruction: FacetReconstruction }
  | { ok: false; code: FacetReconstructionFailureCode; detail: string }

type NormalizedPlane = FacetPlaneSeed & {
  gradientEast: number
  gradientNorth: number
}

type NormalizedInput = {
  width: number
  height: number
  pixelSizeM: number
  pixelCount: number
  maskedPixelCount: number
  dsm: ArrayLike<number>
  mask: ArrayLike<number>
  planes: NormalizedPlane[]
}

/**
 * Assign selected DSM pixels to their least-residual seed plane, then apply a
 * conservative synchronous 8-neighbour majority smoothing pass.
 *
 * All expected failures are returned as a discriminated union. A defensive
 * catch also keeps malformed ArrayLike implementations from escaping as an
 * exception across this pure boundary.
 */
export function reconstructRoofFacets(
  input: FacetReconstructionInput,
): FacetReconstructionResult {
  try {
    const normalized = normalizeInput(input)
    if (!normalized.ok) return normalized
    return reconstruct(normalized.input)
  } catch {
    return failure('invalid_input', 'Facet reconstruction input could not be read safely.')
  }
}

function reconstruct(input: NormalizedInput): FacetReconstructionResult {
  const { width, height, pixelSizeM, pixelCount, planes } = input
  const labels = new Int16Array(pixelCount)
  labels.fill(UNASSIGNED_LABEL)
  const residuals = new Float32Array(pixelCount)
  residuals.fill(Number.POSITIVE_INFINITY)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const rasterIndex = y * width + x
      if (input.mask[rasterIndex] <= 0) continue

      const observedHeight = input.dsm[rasterIndex]
      let foundBoundedCandidate = false
      let bestLabel = UNASSIGNED_LABEL
      let bestResidual = Number.POSITIVE_INFINITY

      for (const plane of planes) {
        if (plane.boundsPixel && !containsPixel(plane.boundsPixel, x, y)) continue
        foundBoundedCandidate = true
        const residual = planeResidual(plane, x, y, pixelSizeM, observedHeight)
        if (
          residual < bestResidual ||
          (residual === bestResidual && (bestLabel < 0 || plane.index < bestLabel))
        ) {
          bestLabel = plane.index
          bestResidual = residual
        }
      }

      // Bounding boxes are only candidate accelerators. Sparse or imperfect
      // provider boxes must not leave a selected roof pixel unassigned.
      if (!foundBoundedCandidate) {
        for (const plane of planes) {
          const residual = planeResidual(plane, x, y, pixelSizeM, observedHeight)
          if (
            residual < bestResidual ||
            (residual === bestResidual && (bestLabel < 0 || plane.index < bestLabel))
          ) {
            bestLabel = plane.index
            bestResidual = residual
          }
        }
      }

      labels[rasterIndex] = bestLabel
      residuals[rasterIndex] = bestResidual
    }
  }

  smoothAssignments(input, labels, residuals)
  const statistics = calculateStatistics(input, labels, residuals)

  return {
    ok: true,
    reconstruction: {
      width,
      height,
      pixelSizeM,
      labels,
      residuals,
      facets: statistics.facets,
      fitSummary: statistics.fitSummary,
    },
  }
}

function smoothAssignments(
  input: NormalizedInput,
  labels: Int16Array,
  residuals: Float32Array,
): void {
  const { width, height, pixelCount, pixelSizeM, planes } = input
  const planeByIndex = new Map(planes.map((plane) => [plane.index, plane]))
  const nextLabels = new Int16Array(pixelCount)
  const nextResiduals = new Float32Array(pixelCount)
  // At most eight distinct labels can be touched for one pixel. Reusing these
  // typed buffers avoids allocating a Map for every selected raster cell.
  const neighbourCounts = new Uint8Array(MAX_PLANE_INDEX + 1)
  const touchedLabels = new Int16Array(8)

  for (let iteration = 0; iteration < SMOOTHING_ITERATIONS; iteration += 1) {
    nextLabels.set(labels)
    nextResiduals.set(residuals)

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const rasterIndex = y * width + x
        if (input.mask[rasterIndex] <= 0) continue

        let touchedCount = 0
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue
            const neighbourX = x + dx
            const neighbourY = y + dy
            if (
              neighbourX < 0 ||
              neighbourX >= width ||
              neighbourY < 0 ||
              neighbourY >= height
            ) {
              continue
            }
            const label = labels[neighbourY * width + neighbourX]
            if (label < 0) continue
            if (neighbourCounts[label] === 0) touchedLabels[touchedCount++] = label
            neighbourCounts[label] += 1
          }
        }

        let majorityLabel = labels[rasterIndex]
        let majorityCount = 0
        for (let touchedOffset = 0; touchedOffset < touchedCount; touchedOffset += 1) {
          const label = touchedLabels[touchedOffset]
          const count = neighbourCounts[label]
          if (
            count > majorityCount ||
            (count === majorityCount && count > 0 && label < majorityLabel)
          ) {
            majorityLabel = label
            majorityCount = count
          }
          neighbourCounts[label] = 0
        }

        if (
          majorityLabel === labels[rasterIndex] ||
          majorityCount < SMOOTHING_MAJORITY_COUNT
        ) {
          continue
        }

        const proposedPlane = planeByIndex.get(majorityLabel)
        if (!proposedPlane) continue
        const proposedResidual = planeResidual(
          proposedPlane,
          x,
          y,
          pixelSizeM,
          input.dsm[rasterIndex],
        )
        if (
          proposedResidual <=
          residuals[rasterIndex] + SMOOTHING_RESIDUAL_TOLERANCE_METERS
        ) {
          nextLabels[rasterIndex] = majorityLabel
          nextResiduals[rasterIndex] = proposedResidual
        }
      }
    }

    labels.set(nextLabels)
    residuals.set(nextResiduals)
  }
}

function calculateStatistics(
  input: NormalizedInput,
  labels: Int16Array,
  residuals: Float32Array,
): {
  facets: ReconstructedFacetStats[]
  fitSummary: FacetReconstructionFitSummary
} {
  const planeOffsetByIndex = new Int16Array(MAX_PLANE_INDEX + 1)
  planeOffsetByIndex.fill(-1)
  input.planes.forEach((plane, offset) => {
    planeOffsetByIndex[plane.index] = offset
  })
  const pixelCounts = new Uint32Array(input.planes.length)
  const sumX = new Float64Array(input.planes.length)
  const sumY = new Float64Array(input.planes.length)
  let assignedPixelCount = 0

  for (let rasterIndex = 0; rasterIndex < labels.length; rasterIndex += 1) {
    const label = labels[rasterIndex]
    const planeOffset = label >= 0 ? planeOffsetByIndex[label] : -1
    if (planeOffset < 0 || !Number.isFinite(residuals[rasterIndex])) continue
    const x = rasterIndex % input.width
    const y = Math.floor(rasterIndex / input.width)
    pixelCounts[planeOffset] += 1
    sumX[planeOffset] += x
    sumY[planeOffset] += y
    assignedPixelCount += 1
  }

  const residualsByPlane = Array.from(
    pixelCounts,
    (count) => new Float32Array(count),
  )
  const writeOffsets = new Uint32Array(input.planes.length)
  const allResiduals = new Float32Array(assignedPixelCount)
  let allResidualOffset = 0

  for (let rasterIndex = 0; rasterIndex < labels.length; rasterIndex += 1) {
    const label = labels[rasterIndex]
    const planeOffset = label >= 0 ? planeOffsetByIndex[label] : -1
    if (planeOffset < 0 || !Number.isFinite(residuals[rasterIndex])) continue
    const residual = residuals[rasterIndex]
    residualsByPlane[planeOffset][writeOffsets[planeOffset]++] = residual
    allResiduals[allResidualOffset++] = residual
  }

  const facets = input.planes.map((plane, offset): ReconstructedFacetStats => {
    const pixelCount = pixelCounts[offset]
    const facetResiduals = residualsByPlane[offset]
    facetResiduals.sort()
    return {
      id: plane.id,
      index: plane.index,
      pixelCount,
      centroidPixel:
        pixelCount > 0
          ? ([sumX[offset] / pixelCount, sumY[offset] / pixelCount] as const)
          : null,
      medianResidualM: percentile(facetResiduals, 0.5),
      p90ResidualM: percentile(facetResiduals, 0.9),
    }
  })

  allResiduals.sort()
  return {
    facets,
    fitSummary: {
      planeSeedCount: input.planes.length,
      assignedFacetCount: pixelCounts.reduce(
        (count, pixels) => count + (pixels > 0 ? 1 : 0),
        0,
      ),
      maskedPixelCount: input.maskedPixelCount,
      assignedPixelCount,
      unassignedPixelCount: input.maskedPixelCount - assignedPixelCount,
      medianResidualM: percentile(allResiduals, 0.5),
      p90ResidualM: percentile(allResiduals, 0.9),
    },
  }
}

function normalizeInput(
  input: FacetReconstructionInput,
):
  | { ok: true; input: NormalizedInput }
  | { ok: false; code: FacetReconstructionFailureCode; detail: string } {
  if (!input || typeof input !== 'object') {
    return failure('invalid_input', 'Facet reconstruction input must be an object.')
  }

  const { width, height, pixelSizeM } = input
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return failure('invalid_input', 'Raster width and height must be positive integers.')
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return failure('limits_exceeded', 'Raster width or height exceeds the reconstruction limit.')
  }

  const pixelCount = width * height
  if (!Number.isSafeInteger(pixelCount) || pixelCount > MAX_PIXEL_COUNT) {
    return failure('limits_exceeded', 'Raster pixel count exceeds the reconstruction limit.')
  }
  if (
    !Number.isFinite(pixelSizeM) ||
    pixelSizeM < MIN_PIXEL_SIZE_METERS ||
    pixelSizeM > MAX_PIXEL_SIZE_METERS
  ) {
    return failure(
      'invalid_input',
      `Pixel size must be between ${MIN_PIXEL_SIZE_METERS} and ${MAX_PIXEL_SIZE_METERS} metres.`,
    )
  }

  if (!hasExpectedLength(input.dsm, pixelCount) || !hasExpectedLength(input.mask, pixelCount)) {
    return failure('invalid_input', 'DSM and mask lengths must equal width multiplied by height.')
  }
  if (!Array.isArray(input.planes) || input.planes.length === 0) {
    return failure('invalid_input', 'At least one plane seed is required.')
  }
  if (input.planes.length > MAX_PLANE_COUNT) {
    return failure('limits_exceeded', 'Plane seed count exceeds the reconstruction limit.')
  }

  const normalizedPlanesResult = normalizePlanes(input.planes)
  if (!normalizedPlanesResult.ok) return normalizedPlanesResult

  let maskedPixelCount = 0
  for (let index = 0; index < pixelCount; index += 1) {
    const maskValue = input.mask[index]
    if (typeof maskValue !== 'number' || !Number.isFinite(maskValue) || maskValue < 0) {
      return failure('invalid_input', 'Mask values must be finite, non-negative numbers.')
    }
    if (maskValue <= 0) continue

    const heightValue = input.dsm[index]
    if (
      typeof heightValue !== 'number' ||
      !Number.isFinite(heightValue) ||
      Math.abs(heightValue) > MAX_ABSOLUTE_HEIGHT_METERS
    ) {
      return failure(
        'invalid_input',
        'DSM values inside the selected mask must be finite, sensible heights.',
      )
    }
    maskedPixelCount += 1
  }

  if (maskedPixelCount === 0) {
    return failure('empty_mask', 'The selected roof mask contains no pixels.')
  }
  if (maskedPixelCount * normalizedPlanesResult.planes.length > MAX_ASSIGNMENT_COMPARISONS) {
    return failure('limits_exceeded', 'Raster and plane seed combination exceeds the work limit.')
  }

  return {
    ok: true,
    input: {
      width,
      height,
      pixelSizeM,
      pixelCount,
      maskedPixelCount,
      dsm: input.dsm,
      mask: input.mask,
      planes: normalizedPlanesResult.planes,
    },
  }
}

function normalizePlanes(
  planes: readonly FacetPlaneSeed[],
):
  | { ok: true; planes: NormalizedPlane[] }
  | { ok: false; code: 'invalid_input'; detail: string } {
  const normalized: NormalizedPlane[] = []
  const ids = new Set<string>()
  const indices = new Set<number>()

  for (const plane of planes) {
    if (!plane || typeof plane !== 'object') {
      return failure('invalid_input', 'Every plane seed must be an object.')
    }
    if (typeof plane.id !== 'string' || !plane.id.trim() || plane.id.length > 128) {
      return failure('invalid_input', 'Every plane seed requires a short, non-empty id.')
    }
    if (ids.has(plane.id)) {
      return failure('invalid_input', 'Plane seed ids must be unique.')
    }
    if (
      !Number.isInteger(plane.index) ||
      plane.index < 0 ||
      plane.index > MAX_PLANE_INDEX ||
      indices.has(plane.index)
    ) {
      return failure(
        'invalid_input',
        'Plane indices must be unique integers compatible with the label raster.',
      )
    }
    if (
      !Number.isFinite(plane.pitchDegrees) ||
      plane.pitchDegrees < 0 ||
      plane.pitchDegrees >= 90
    ) {
      return failure('invalid_input', 'Plane pitch must be finite and in [0, 90) degrees.')
    }
    if (
      !Number.isFinite(plane.azimuthDegrees) ||
      plane.azimuthDegrees < 0 ||
      plane.azimuthDegrees >= 360
    ) {
      return failure('invalid_input', 'Plane azimuth must be finite and in [0, 360) degrees.')
    }
    if (
      !Number.isFinite(plane.planeHeightAtCenterMeters) ||
      Math.abs(plane.planeHeightAtCenterMeters) > MAX_ABSOLUTE_HEIGHT_METERS
    ) {
      return failure('invalid_input', 'Plane centre height must be finite and sensible.')
    }
    if (
      !Array.isArray(plane.centerPixel) ||
      plane.centerPixel.length !== 2 ||
      !isSensiblePixelCoordinate(plane.centerPixel[0]) ||
      !isSensiblePixelCoordinate(plane.centerPixel[1])
    ) {
      return failure('invalid_input', 'Plane centre must be a finite [x, y] pixel coordinate.')
    }
    if (plane.boundsPixel && !isValidBounds(plane.boundsPixel)) {
      return failure('invalid_input', 'Plane bounds must be finite ordered pixel coordinates.')
    }

    const pitchRadians = (plane.pitchDegrees * Math.PI) / 180
    const azimuthRadians = (plane.azimuthDegrees * Math.PI) / 180
    const tangent = Math.tan(pitchRadians)
    const gradientEast = -tangent * Math.sin(azimuthRadians)
    const gradientNorth = -tangent * Math.cos(azimuthRadians)
    if (!Number.isFinite(gradientEast) || !Number.isFinite(gradientNorth)) {
      return failure('invalid_input', 'Plane slope produced a non-finite gradient.')
    }

    ids.add(plane.id)
    indices.add(plane.index)
    normalized.push({ ...plane, gradientEast, gradientNorth })
  }

  // Stable index order makes equal-residual tie breaking independent of the
  // provider array order and keeps facet statistics deterministic.
  normalized.sort((left, right) => left.index - right.index)
  return { ok: true, planes: normalized }
}

function planeResidual(
  plane: NormalizedPlane,
  x: number,
  y: number,
  pixelSizeM: number,
  observedHeight: number,
): number {
  const eastFromCenterM = (x - plane.centerPixel[0]) * pixelSizeM
  const northFromCenterM = (plane.centerPixel[1] - y) * pixelSizeM
  const predictedHeight =
    plane.planeHeightAtCenterMeters +
    plane.gradientEast * eastFromCenterM +
    plane.gradientNorth * northFromCenterM
  return Math.abs(observedHeight - predictedHeight)
}

function containsPixel(bounds: FacetPixelBounds, x: number, y: number): boolean {
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY
}

function percentile(sortedValues: Float32Array, percentileValue: number): number | null {
  if (sortedValues.length === 0) return null
  return sortedValues[Math.floor((sortedValues.length - 1) * percentileValue)]
}

function hasExpectedLength(value: ArrayLike<number>, expected: number): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    Number.isInteger(value.length) &&
    value.length === expected
  )
}

function isSensiblePixelCoordinate(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value) <= MAX_ABSOLUTE_PIXEL_COORDINATE
  )
}

function isValidBounds(value: FacetPixelBounds): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    isSensiblePixelCoordinate(value.minX) &&
    isSensiblePixelCoordinate(value.minY) &&
    isSensiblePixelCoordinate(value.maxX) &&
    isSensiblePixelCoordinate(value.maxY) &&
    value.minX <= value.maxX &&
    value.minY <= value.maxY
  )
}

function failure<TCode extends FacetReconstructionFailureCode>(
  code: TCode,
  detail: string,
): { ok: false; code: TCode; detail: string } {
  return { ok: false, code, detail }
}
