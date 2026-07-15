// Roof topology — pure rendering for a reconstructed roof-plane assignment.
//
// Google supplies the aligned RGB/DSM/mask rasters and roof-plane metadata;
// QuoteMax assigns DSM pixels to those planes. This renderer only turns the
// resulting label grid into quiet, reviewable visual evidence. It deliberately
// draws no ridge/hip/valley/eave symbols because those semantics require a
// separate vectorisation and review step.

import { PNG } from 'pngjs'

export const DEFAULT_FACET_PALETTE = [
  '#FF375F',
  '#FF9F0A',
  '#0A84FF',
  '#30D158',
  '#BF5AF2',
  '#64D2FF',
  '#FFD60A',
  '#FF453A',
  '#5E5CE6',
  '#66D4CF',
] as const

const DEFAULT_FILL_ALPHA = 72
const DEFAULT_BOUNDARY_ALPHA = 104
const MAX_PIXELS = 2048 * 2048

type RgbChannels = {
  readonly r: ArrayLike<number>
  readonly g: ArrayLike<number>
  readonly b: ArrayLike<number>
}

export type FacetEvidenceRenderInput = {
  readonly width: number
  readonly height: number
  /** -1 means outside the selected dwelling; non-negative values are plane ids. */
  readonly labels: ArrayLike<number>
  /** Optional aligned Google RGB bands. Without them, the result is an overlay PNG. */
  readonly rgb?: RgbChannels | null
  readonly palette?: readonly string[]
  /** Roof fill opacity, 0–255. Kept low by default so the aerial remains legible. */
  readonly fillAlpha?: number
  /** Single-pixel plane-boundary opacity, 0–255. */
  readonly boundaryAlpha?: number
}

export type FacetEvidenceMarker = {
  readonly planeIndex: number
  readonly number: number
  readonly x: number
  readonly y: number
  readonly xPct: number
  readonly yPct: number
  readonly pixels: number
  readonly color: string
}

export type FacetEvidenceRender = {
  readonly png: Uint8Array
  readonly width: number
  readonly height: number
  readonly markers: readonly FacetEvidenceMarker[]
  readonly roofPixelCount: number
  readonly boundaryPixelCount: number
  readonly fillAlpha: number
  readonly boundaryAlpha: number
}

export type FacetEvidenceRenderResult =
  | { readonly ok: true; readonly evidence: FacetEvidenceRender }
  | { readonly ok: false; readonly detail: string }

type ParsedColor = readonly [number, number, number]

function finiteDimension(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function byte(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(255, Math.round(value)))
    : fallback
}

function clampChannel(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round(value))) : 0
}

function parseHexColor(value: string): ParsedColor | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value)
  if (!match) return null
  const packed = Number.parseInt(match[1], 16)
  return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255]
}

function isBoundaryPixel(
  labels: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
  label: number,
): boolean {
  // Only mark contacts between two assigned planes. The outer dwelling edge
  // is left to the aerial/mask, avoiding the heavy white halo in the old UI.
  if (x > 0) {
    const other = labels[y * width + x - 1]
    if (other >= 0 && other !== label) return true
  }
  if (x + 1 < width) {
    const other = labels[y * width + x + 1]
    if (other >= 0 && other !== label) return true
  }
  if (y > 0) {
    const other = labels[(y - 1) * width + x]
    if (other >= 0 && other !== label) return true
  }
  if (y + 1 < height) {
    const other = labels[(y + 1) * width + x]
    if (other >= 0 && other !== label) return true
  }
  return false
}

function blend(base: number, overlay: number, alpha: number): number {
  const factor = alpha / 255
  return Math.round(base * (1 - factor) + overlay * factor)
}

/**
 * Render a quiet plane-assignment image. Returns a result union and never
 * throws for malformed caller data.
 */
export function renderFacetEvidencePng(
  input: FacetEvidenceRenderInput,
): FacetEvidenceRenderResult {
  const { width, height, labels } = input
  if (!finiteDimension(width) || !finiteDimension(height)) {
    return { ok: false, detail: 'Facet evidence dimensions must be positive integers.' }
  }
  const pixelCount = width * height
  if (pixelCount > MAX_PIXELS) {
    return { ok: false, detail: `Facet evidence exceeds ${MAX_PIXELS} pixels.` }
  }
  if (labels.length !== pixelCount) {
    return { ok: false, detail: 'Facet label count does not match the image dimensions.' }
  }

  const rgb = input.rgb ?? null
  if (
    rgb &&
    (rgb.r.length !== pixelCount || rgb.g.length !== pixelCount || rgb.b.length !== pixelCount)
  ) {
    return { ok: false, detail: 'Facet RGB bands do not match the label dimensions.' }
  }

  const paletteStrings = input.palette?.length ? input.palette : DEFAULT_FACET_PALETTE
  const palette: ParsedColor[] = []
  for (const value of paletteStrings) {
    const parsed = parseHexColor(value)
    if (!parsed) return { ok: false, detail: `Invalid facet palette colour: ${value}` }
    palette.push(parsed)
  }

  const fillAlpha = byte(input.fillAlpha, DEFAULT_FILL_ALPHA)
  const boundaryAlpha = byte(input.boundaryAlpha, DEFAULT_BOUNDARY_ALPHA)
  const png = new PNG({ width, height })
  const stats = new Map<number, { pixels: number; sumX: number; sumY: number }>()
  let roofPixelCount = 0
  let boundaryPixelCount = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x
      const outputIndex = pixelIndex * 4
      const rawLabel = labels[pixelIndex]
      const label = Number.isInteger(rawLabel) ? rawLabel : -1
      const hasBase = rgb !== null
      const base: ParsedColor = hasBase
        ? [
            clampChannel(rgb.r[pixelIndex]),
            clampChannel(rgb.g[pixelIndex]),
            clampChannel(rgb.b[pixelIndex]),
          ]
        : [0, 0, 0]

      if (label < 0) {
        if (hasBase) {
          png.data[outputIndex] = base[0]
          png.data[outputIndex + 1] = base[1]
          png.data[outputIndex + 2] = base[2]
          png.data[outputIndex + 3] = 255
        } else {
          png.data[outputIndex + 3] = 0
        }
        continue
      }

      roofPixelCount += 1
      const stat = stats.get(label)
      if (stat) {
        stat.pixels += 1
        stat.sumX += x
        stat.sumY += y
      } else {
        stats.set(label, { pixels: 1, sumX: x, sumY: y })
      }

      const color = palette[label % palette.length]
      const boundary = isBoundaryPixel(labels, width, height, x, y, label)
      const alpha = boundary ? boundaryAlpha : fillAlpha
      if (boundary) boundaryPixelCount += 1

      if (hasBase) {
        png.data[outputIndex] = blend(base[0], color[0], alpha)
        png.data[outputIndex + 1] = blend(base[1], color[1], alpha)
        png.data[outputIndex + 2] = blend(base[2], color[2], alpha)
        png.data[outputIndex + 3] = 255
      } else {
        png.data[outputIndex] = color[0]
        png.data[outputIndex + 1] = color[1]
        png.data[outputIndex + 2] = color[2]
        png.data[outputIndex + 3] = alpha
      }
    }
  }

  if (roofPixelCount === 0) {
    return { ok: false, detail: 'Facet evidence contains no assigned roof pixels.' }
  }

  const sorted = [...stats.entries()].sort(([left], [right]) => left - right)
  const markers: FacetEvidenceMarker[] = sorted.map(([planeIndex, stat], index) => ({
    planeIndex,
    number: index + 1,
    x: stat.sumX / stat.pixels,
    y: stat.sumY / stat.pixels,
    xPct: ((stat.sumX / stat.pixels + 0.5) / width) * 100,
    yPct: ((stat.sumY / stat.pixels + 0.5) / height) * 100,
    pixels: stat.pixels,
    color: paletteStrings[planeIndex % paletteStrings.length],
  }))

  return {
    ok: true,
    evidence: {
      png: new Uint8Array(PNG.sync.write(png)),
      width,
      height,
      markers,
      roofPixelCount,
      boundaryPixelCount,
      fillAlpha,
      boundaryAlpha,
    },
  }
}

export const __test_only__ = {
  DEFAULT_FILL_ALPHA,
  DEFAULT_BOUNDARY_ALPHA,
  MAX_PIXELS,
  parseHexColor,
}
