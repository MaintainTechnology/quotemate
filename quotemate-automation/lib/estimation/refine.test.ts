import { describe, it, expect } from 'vitest'
import { planTiles, parseTileCounts, toPagePoints, dedupePoints, buildTilePrompt } from './refine'

describe('planTiles', () => {
  it('covers the whole page with a single tile when the page is small', () => {
    expect(planTiles(1000, 800)).toEqual([{ x: 0, y: 0, w: 1000, h: 800 }])
  })

  it('splits a large page into a grid of overlapping tiles', () => {
    const tiles = planTiles(4200, 3000, 1500, 12)
    // round(4200/1500)=3 cols, round(3000/1500)=2 rows
    expect(tiles).toHaveLength(6)
    // every pixel is covered: first tile starts at 0, last tile ends at page edge
    expect(tiles[0]).toMatchObject({ x: 0, y: 0 })
    const last = tiles[tiles.length - 1]
    expect(last.x + last.w).toBe(4200)
    expect(last.y + last.h).toBe(3000)
    // interior tiles bleed into their neighbours (overlap)
    const t1 = tiles[1] // second column, first row
    expect(t1.x).toBeLessThan(1400) // 1400 = tile width without overlap
  })

  it('clamps tiles to the page bounds', () => {
    for (const t of planTiles(3100, 2100, 1500, 20)) {
      expect(t.x).toBeGreaterThanOrEqual(0)
      expect(t.y).toBeGreaterThanOrEqual(0)
      expect(t.x + t.w).toBeLessThanOrEqual(3100)
      expect(t.y + t.h).toBeLessThanOrEqual(2100)
    }
  })
})

describe('parseTileCounts', () => {
  it('parses items with positions, clamping out-of-range values', () => {
    const text = 'Counts:\n{"items":[{"type":"Single GPO","positions":[{"x":10,"y":20},{"x":150,"y":-4}]},{"type":"EDB","positions":[]}]}'
    expect(parseTileCounts(text)).toEqual([
      { type: 'Single GPO', positions: [{ x: 10, y: 20 }, { x: 100, y: 0 }] },
      { type: 'EDB', positions: [] },
    ])
  })
  it('returns [] for unparseable replies', () => {
    expect(parseTileCounts('no json here')).toEqual([])
    expect(parseTileCounts('{"items": "nope"}')).toEqual([])
  })
})

describe('toPagePoints', () => {
  it('maps tile-local percentages into page percentages', () => {
    // tile occupies the right half of a 2000×1000 page
    const pts = toPagePoints([{ x: 50, y: 50 }], { x: 1000, y: 0, w: 1000, h: 1000 }, 2000, 1000)
    expect(pts).toEqual([{ x: 75, y: 50 }])
  })
})

describe('dedupePoints', () => {
  it('merges points closer than the radius (same symbol from overlapping tiles)', () => {
    const pts = dedupePoints([
      { x: 10, y: 10 },
      { x: 10.5, y: 10.4 }, // duplicate of the first (within 1.2)
      { x: 50, y: 50 },
    ])
    expect(pts).toHaveLength(2)
  })
  it('keeps distinct points', () => {
    expect(dedupePoints([{ x: 10, y: 10 }, { x: 13, y: 10 }])).toHaveLength(2)
  })
})

describe('buildTilePrompt', () => {
  it('lists every target with symbol and hint', () => {
    const p = buildTilePrompt([
      { type: 'Feature Recessed LED Downlight 12W', symbol: 'circle', hint: 'labelled 12W' },
      { type: 'Single GPO', symbol: 'GPO' },
    ])
    expect(p).toContain('"Feature Recessed LED Downlight 12W" — symbol: circle — labelled 12W')
    expect(p).toContain('"Single GPO" — symbol: GPO')
    expect(p).toContain('STRICT JSON')
  })
})
