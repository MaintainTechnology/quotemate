// ════════════════════════════════════════════════════════════════════
// Solar — PURE annual-flux heatmap rendering (full-exploitation build
// 2026-06-13). Takes a decoded annual-flux band (+ optional roof mask)
// and produces an RGBA PNG: the classic roof "solar potential" image —
// dark/cool where shaded, bright yellow where the roof bakes.
//
// Rendering rules:
//   • Pixels outside the roof mask are fully transparent — the PNG is an
//     OVERLAY layered on the satellite basemap by the quote page.
//   • Flux values are normalised between the masked p2 / p98 percentiles
//     so a couple of sensor outliers can't wash the ramp out.
//   • Nodata / negative values are transparent.
//
// PURE — pixel math only; pngjs encodes the bytes. No I/O.
// ════════════════════════════════════════════════════════════════════

import { PNG } from 'pngjs'
import { maskAt, type RasterBand } from './raster-analysis'

/** Colour ramp stops, cold → hot (RGB). */
const RAMP: Array<[number, number, number]> = [
  [11, 16, 38], // deep navy
  [69, 39, 160], // purple
  [198, 40, 40], // crimson
  [255, 152, 0], // orange
  [255, 245, 157], // pale yellow
]

/** Overlay opacity for roof pixels (0–255). */
const ROOF_ALPHA = 230

export type FluxHeatmapResult = {
  /** Encoded PNG bytes (RGBA, transparent off-roof). */
  png: Uint8Array
  width: number
  height: number
  /** Normalisation bounds used (masked p2/p98), kWh/kW/year. */
  min_flux: number
  max_flux: number
  /** Number of roof pixels rendered. */
  roof_pixels: number
}

/** PURE — ramp lookup for t ∈ [0,1] with linear interpolation. */
export function fluxColor(t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t))
  const pos = clamped * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(pos))
  const f = pos - i
  const a = RAMP[i]
  const b = RAMP[i + 1]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}

/** The aerial RGB layer (3 bands) for an opaque composite background. */
export type RgbBands = { r: RasterBand; g: RasterBand; b: RasterBand }

/** Blend factor of the flux colour over the aerial photo on roof pixels. */
const COMPOSITE_BLEND = 0.72

/**
 * PURE — render the annual flux band to a heatmap PNG. When the aligned
 * aerial RGB layer is provided the output is an opaque composite (photo
 * under, flux colours blended over the roof); without it, roof pixels
 * are near-opaque colour and everything else is transparent (an overlay).
 * Returns null when no roof pixel carries a usable flux value.
 */
export function renderFluxHeatmapPng(
  flux: RasterBand,
  mask: RasterBand | null,
  noDataValue: number | null = null,
  rgb: RgbBands | null = null,
): FluxHeatmapResult | null {
  const { width, height } = flux

  // First pass — collect masked values for percentile normalisation.
  const values: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = flux.data[y * width + x]
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue
      if (noDataValue !== null && v === noDataValue) continue
      if (!maskAt(mask, x, y, width, height)) continue
      values.push(v)
    }
  }
  if (values.length === 0) return null

  values.sort((a, b) => a - b)
  const min = values[Math.floor(values.length * 0.02)]
  const max = values[Math.min(values.length - 1, Math.floor(values.length * 0.98))]
  const range = max - min

  // RGB base must match the flux grid to composite safely.
  const rgbUsable =
    rgb !== null &&
    rgb.r.width === width &&
    rgb.r.height === height &&
    rgb.g.width === width &&
    rgb.b.width === width

  const png = new PNG({ width, height })
  let roofPixels = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const idx = i * 4
      const v = flux.data[i]
      const usable =
        typeof v === 'number' &&
        Number.isFinite(v) &&
        v >= 0 &&
        (noDataValue === null || v !== noDataValue) &&
        maskAt(mask, x, y, width, height)

      const base: [number, number, number] | null = rgbUsable
        ? [clamp255(rgb!.r.data[i]), clamp255(rgb!.g.data[i]), clamp255(rgb!.b.data[i])]
        : null

      if (!usable) {
        if (base) {
          // Composite mode: aerial photo carries the off-roof pixels.
          png.data[idx] = base[0]
          png.data[idx + 1] = base[1]
          png.data[idx + 2] = base[2]
          png.data[idx + 3] = 255
        } else {
          png.data[idx + 3] = 0 // overlay mode: transparent
        }
        continue
      }
      const t = range > 0 ? (v - min) / range : 0.5
      const [r, g, b] = fluxColor(t)
      if (base) {
        png.data[idx] = Math.round(base[0] * (1 - COMPOSITE_BLEND) + r * COMPOSITE_BLEND)
        png.data[idx + 1] = Math.round(base[1] * (1 - COMPOSITE_BLEND) + g * COMPOSITE_BLEND)
        png.data[idx + 2] = Math.round(base[2] * (1 - COMPOSITE_BLEND) + b * COMPOSITE_BLEND)
        png.data[idx + 3] = 255
      } else {
        png.data[idx] = r
        png.data[idx + 1] = g
        png.data[idx + 2] = b
        png.data[idx + 3] = ROOF_ALPHA
      }
      roofPixels++
    }
  }
  if (roofPixels === 0) return null

  return {
    png: new Uint8Array(PNG.sync.write(png)),
    width,
    height,
    min_flux: Math.round(min * 10) / 10,
    max_flux: Math.round(max * 10) / 10,
    roof_pixels: roofPixels,
  }
}

function clamp255(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(255, Math.round(v)))
}

export const __test_only__ = { RAMP, ROOF_ALPHA, COMPOSITE_BLEND }
