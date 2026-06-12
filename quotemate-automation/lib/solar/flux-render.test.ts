import { describe, it, expect } from 'vitest'
import { PNG } from 'pngjs'
import { fluxColor, renderFluxHeatmapPng, __test_only__ } from './flux-render'
import type { RasterBand } from './raster-analysis'

const { RAMP, ROOF_ALPHA } = __test_only__

function band(width: number, height: number, fill: (x: number, y: number) => number): RasterBand {
  const data = new Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data[y * width + x] = fill(x, y)
  }
  return { data, width, height }
}

describe('fluxColor', () => {
  it('returns the ramp endpoints at t=0 and t=1', () => {
    expect(fluxColor(0)).toEqual(RAMP[0])
    expect(fluxColor(1)).toEqual(RAMP[RAMP.length - 1])
  })

  it('clamps out-of-range t', () => {
    expect(fluxColor(-5)).toEqual(RAMP[0])
    expect(fluxColor(7)).toEqual(RAMP[RAMP.length - 1])
  })

  it('interpolates between stops', () => {
    const mid = fluxColor(0.5)
    expect(mid).toEqual(RAMP[2]) // exact middle stop of 5
  })
})

describe('renderFluxHeatmapPng', () => {
  it('renders roof pixels opaque and off-roof pixels transparent', () => {
    const flux = band(4, 4, (x) => x * 500) // gradient left→right
    const mask = band(4, 4, (x) => (x < 2 ? 1 : 0)) // left half roof
    const res = renderFluxHeatmapPng(flux, mask)
    expect(res).not.toBeNull()
    const png = PNG.sync.read(Buffer.from(res!.png))
    expect(png.width).toBe(4)
    // (0,0) on-roof → alpha 230; (3,0) off-roof → alpha 0.
    expect(png.data[3]).toBe(ROOF_ALPHA)
    expect(png.data[(3 * 4 + 3)]).toBe(0)
    expect(res!.roof_pixels).toBe(8)
  })

  it('normalises between masked percentiles', () => {
    const flux = band(10, 10, (x, y) => 1000 + (y * 10 + x)) // 1000..1099
    const res = renderFluxHeatmapPng(flux, null)
    expect(res).not.toBeNull()
    expect(res!.min_flux).toBeGreaterThanOrEqual(1000)
    expect(res!.max_flux).toBeLessThanOrEqual(1099)
    expect(res!.max_flux).toBeGreaterThan(res!.min_flux)
  })

  it('treats nodata and negative values as transparent', () => {
    const flux = band(4, 1, (x) => (x === 0 ? -9999 : x === 1 ? -1 : 800))
    const res = renderFluxHeatmapPng(flux, null, -9999)
    expect(res).not.toBeNull()
    const png = PNG.sync.read(Buffer.from(res!.png))
    expect(png.data[3]).toBe(0) // nodata
    expect(png.data[7]).toBe(0) // negative sentinel
    expect(png.data[11]).toBe(ROOF_ALPHA)
  })

  it('returns null when no usable pixel exists', () => {
    const flux = band(2, 2, () => -1)
    expect(renderFluxHeatmapPng(flux, null)).toBeNull()
    const mask = band(2, 2, () => 0)
    expect(renderFluxHeatmapPng(band(2, 2, () => 500), mask)).toBeNull()
  })

  it('composites over the aerial RGB when provided (fully opaque output)', () => {
    const flux = band(2, 2, (x) => (x === 0 ? 1000 : -1)) // left column roof flux
    const grey = (v: number) => band(2, 2, () => v)
    const rgb = { r: grey(100), g: grey(120), b: grey(140) }
    const res = renderFluxHeatmapPng(flux, null, null, rgb)
    expect(res).not.toBeNull()
    const png = PNG.sync.read(Buffer.from(res!.png))
    // Roof pixel: opaque blended colour (not the raw base grey).
    expect(png.data[3]).toBe(255)
    expect(png.data[0]).not.toBe(100)
    // Off-roof pixel: the aerial photo verbatim, opaque.
    expect(png.data[7]).toBe(255)
    expect(png.data[4]).toBe(100)
    expect(png.data[5]).toBe(120)
    expect(png.data[6]).toBe(140)
  })

  it('falls back to overlay mode when the RGB grid mismatches', () => {
    const flux = band(2, 2, () => 900)
    const grey = (v: number) => band(4, 4, () => v) // wrong dimensions
    const rgb = { r: grey(10), g: grey(20), b: grey(30) }
    const res = renderFluxHeatmapPng(flux, null, null, rgb)
    const png = PNG.sync.read(Buffer.from(res!.png))
    expect(png.data[3]).toBe(__test_only__.ROOF_ALPHA) // overlay alpha, not 255
  })
})
