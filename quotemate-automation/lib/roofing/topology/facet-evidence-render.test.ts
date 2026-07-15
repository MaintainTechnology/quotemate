import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { reconstructRoofFacets } from './facet-reconstruction'
import { renderFacetEvidencePng } from './facet-evidence-render'

function pixel(png: PNG, x: number, y: number): [number, number, number, number] {
  const index = (y * png.width + x) * 4
  return [
    png.data[index],
    png.data[index + 1],
    png.data[index + 2],
    png.data[index + 3],
  ]
}

describe('renderFacetEvidencePng', () => {
  it('renders quiet transparent plane fills with a single-pixel subtle contact', () => {
    const result = renderFacetEvidencePng({
      width: 5,
      height: 3,
      labels: Int16Array.from([
        -1, -1, -1, -1, -1,
        -1, 0, 0, 1, -1,
        -1, -1, -1, -1, -1,
      ]),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const png = PNG.sync.read(Buffer.from(result.evidence.png))
    expect(pixel(png, 0, 0)[3]).toBe(0)
    // Both cells touching the plane contact form the only one-pixel raster border.
    expect(pixel(png, 2, 1)[3]).toBe(result.evidence.boundaryAlpha)
    expect(pixel(png, 3, 1)[3]).toBe(result.evidence.boundaryAlpha)
    expect(result.evidence.boundaryPixelCount).toBe(2)
    expect(result.evidence.boundaryAlpha).toBeLessThan(128)
    expect(result.evidence.markers.map((marker) => marker.planeIndex)).toEqual([0, 1])
  })

  it('keeps the aligned aerial opaque and lightly blends only roof pixels', () => {
    const base = Uint8Array.from([100, 100, 100, 100])
    const result = renderFacetEvidencePng({
      width: 2,
      height: 2,
      labels: Int16Array.from([-1, 0, 0, 0]),
      rgb: { r: base, g: base, b: base },
      fillAlpha: 64,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const png = PNG.sync.read(Buffer.from(result.evidence.png))
    expect(pixel(png, 0, 0)).toEqual([100, 100, 100, 255])
    expect(pixel(png, 1, 0)[3]).toBe(255)
    expect(pixel(png, 1, 0).slice(0, 3)).not.toEqual([100, 100, 100])
    expect(result.evidence.markers[0]).toMatchObject({
      planeIndex: 0,
      number: 1,
      pixels: 3,
    })
  })

  it('orders markers by plane id and reports stable centroids', () => {
    const result = renderFacetEvidencePng({
      width: 4,
      height: 2,
      labels: Int16Array.from([5, 5, 2, 2, 5, -1, 2, -1]),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.evidence.markers.map(({ planeIndex, number, pixels }) => ({
      planeIndex,
      number,
      pixels,
    }))).toEqual([
      { planeIndex: 2, number: 1, pixels: 3 },
      { planeIndex: 5, number: 2, pixels: 3 },
    ])
    expect(result.evidence.markers[0].x).toBeCloseTo(7 / 3)
    expect(result.evidence.markers[0].y).toBeCloseTo(1 / 3)
  })

  it('rejects malformed grids and invalid palettes without throwing', () => {
    expect(renderFacetEvidencePng({ width: 0, height: 2, labels: [] })).toMatchObject({
      ok: false,
    })
    expect(renderFacetEvidencePng({ width: 2, height: 2, labels: [0] })).toMatchObject({
      ok: false,
    })
    expect(renderFacetEvidencePng({
      width: 1,
      height: 1,
      labels: [0],
      palette: ['red'],
    })).toMatchObject({ ok: false })
    expect(renderFacetEvidencePng({
      width: 1,
      height: 1,
      labels: [0],
      rgb: { r: [1], g: [], b: [1] },
    })).toMatchObject({ ok: false })
  })

  it('rejects an empty assignment instead of producing a misleading image', () => {
    expect(renderFacetEvidencePng({
      width: 2,
      height: 2,
      labels: Int16Array.from([-1, -1, -1, -1]),
    })).toEqual({
      ok: false,
      detail: 'Facet evidence contains no assigned roof pixels.',
    })
  })

  it('renders the labels produced by the reusable DSM plane reconstruction', () => {
    const reconstruction = reconstructRoofFacets({
      width: 4,
      height: 1,
      pixelSizeM: 0.25,
      dsm: Float32Array.from([10, 10, 12, 12]),
      mask: Uint8Array.from([1, 1, 1, 1]),
      planes: [
        {
          id: 'low-plane',
          index: 0,
          pitchDegrees: 0,
          azimuthDegrees: 0,
          planeHeightAtCenterMeters: 10,
          centerPixel: [0.5, 0],
        },
        {
          id: 'high-plane',
          index: 1,
          pitchDegrees: 0,
          azimuthDegrees: 180,
          planeHeightAtCenterMeters: 12,
          centerPixel: [2.5, 0],
        },
      ],
    })
    expect(reconstruction.ok).toBe(true)
    if (!reconstruction.ok) return

    const rendered = renderFacetEvidencePng(reconstruction.reconstruction)
    expect(rendered.ok).toBe(true)
    if (!rendered.ok) return
    expect(rendered.evidence.markers.map(({ planeIndex, pixels }) => ({
      planeIndex,
      pixels,
    }))).toEqual([
      { planeIndex: 0, pixels: 2 },
      { planeIndex: 1, pixels: 2 },
    ])
    expect(rendered.evidence.boundaryPixelCount).toBe(2)
  })
})
