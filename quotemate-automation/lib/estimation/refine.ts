// Tiled high-DPI recount ("Approach-1") for dense plan areas.
//
// The single-pass whole-PDF take-off is reliable for sparse symbols but
// unstable on dense grids (downlight fields, GPO clusters) because the PDF is
// rendered to the model at low resolution. This module fixes that:
//
//   1. rasterise ONE sheet (page) of the PDF at high DPI via mupdf (WASM)
//   2. split it into overlapping tiles sized for Claude vision (~1500 px)
//   3. recount the requested items per tile, with per-symbol positions
//   4. map tile-local positions back to page coordinates and DEDUPE the
//      overlap zone so nothing is double-counted
//
// Pure core + thin IO (mirrors lib/estimation/extract.ts):
//   • planTiles / toPagePoints / dedupePoints / parseTileCounts — pure, tested
//   • rasterizePage (mupdf) + refineCounts (Claude per tile)    — thin IO

import { anthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import { DEFAULT_ESTIMATION_MODEL, modelAcceptsTemperature, type ItemLocation } from './extract'

// ── Types ─────────────────────────────────────────────────────────────

/** An item the caller wants recounted (from the original take-off). */
export type RefineTarget = {
  type: string
  symbol: string
  /** Anything that helps identify the symbol on the drawing, e.g. "labelled 12W". */
  hint?: string
}

/** A tile of the rasterised page, in pixels. */
export type TileRect = { x: number; y: number; w: number; h: number }

/** A point in page-percent space (0–100 of page width/height). */
export type PagePoint = { x: number; y: number }

export type RefinedItem = {
  type: string
  count: number
  locations: ItemLocation[]
}

export type RefineResult = {
  page: number
  model: string
  tiles: number
  runtimeSeconds: number
  items: RefinedItem[]
}

// ── Pure: tile planning ───────────────────────────────────────────────

/** Split a wPx×hPx image into a grid of overlapping tiles. Tiles are sized
 *  close to `targetPx` (Claude vision sweet spot ≈ 1500 px) and neighbouring
 *  tiles overlap by `overlapPct` of the tile size so symbols cut by one tile
 *  edge are whole in the neighbour. */
export function planTiles(wPx: number, hPx: number, targetPx = 1500, overlapPct = 12): TileRect[] {
  const overlap = Math.min(40, Math.max(0, overlapPct)) / 100
  const cols = Math.max(1, Math.round(wPx / targetPx))
  const rows = Math.max(1, Math.round(hPx / targetPx))
  const tileW = Math.ceil(wPx / cols)
  const tileH = Math.ceil(hPx / rows)
  const padX = Math.round(tileW * overlap)
  const padY = Math.round(tileH * overlap)
  const tiles: TileRect[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.max(0, c * tileW - padX)
      const y = Math.max(0, r * tileH - padY)
      const x2 = Math.min(wPx, (c + 1) * tileW + padX)
      const y2 = Math.min(hPx, (r + 1) * tileH + padY)
      tiles.push({ x, y, w: x2 - x, h: y2 - y })
    }
  }
  return tiles
}

// ── Pure: tile reply parsing ──────────────────────────────────────────

/** Parse one tile reply: { items: [{ type, positions: [{x,y}] }] }.
 *  x/y are percentages WITHIN the tile image. Tolerant like parseExtraction. */
export function parseTileCounts(text: string): { type: string; positions: { x: number; y: number }[] }[] {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return []
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    return []
  }
  if (!Array.isArray(obj.items)) return []
  const out: { type: string; positions: { x: number; y: number }[] }[] = []
  for (const raw of obj.items) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const type = String(r.type ?? '').trim()
    if (!type) continue
    const positions = Array.isArray(r.positions)
      ? (r.positions as unknown[])
          .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
          .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
          .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
          .map((p) => ({ x: Math.min(100, Math.max(0, p.x)), y: Math.min(100, Math.max(0, p.y)) }))
      : []
    out.push({ type, positions })
  }
  return out
}

// ── Pure: coordinate mapping + dedupe ─────────────────────────────────

/** Map tile-local percent positions to page-percent positions. */
export function toPagePoints(
  positions: { x: number; y: number }[],
  tile: TileRect,
  pageW: number,
  pageH: number,
): PagePoint[] {
  return positions.map((p) => ({
    x: Math.round(((tile.x + (p.x / 100) * tile.w) / pageW) * 1000) / 10,
    y: Math.round(((tile.y + (p.y / 100) * tile.h) / pageH) * 1000) / 10,
  }))
}

/** Greedy cluster-dedupe: points within `radiusPct` (of page width, in percent
 *  space) of an accepted point are treated as the SAME symbol seen from two
 *  overlapping tiles. Returns the deduped cluster centres. */
export function dedupePoints(points: PagePoint[], radiusPct = 1.2): PagePoint[] {
  const kept: PagePoint[] = []
  const r2 = radiusPct * radiusPct
  for (const p of points) {
    const dup = kept.some((k) => {
      const dx = k.x - p.x
      const dy = k.y - p.y
      return dx * dx + dy * dy <= r2
    })
    if (!dup) kept.push(p)
  }
  return kept
}

// ── Pure: tile prompt ─────────────────────────────────────────────────

export function buildTilePrompt(targets: RefineTarget[]): string {
  const list = targets
    .map((t, i) => `${i + 1}. "${t.type}" — symbol: ${t.symbol || '(see description)'}${t.hint ? ` — ${t.hint}` : ''}`)
    .join('\n')
  return `This image is ONE TILE of a high-resolution electrical construction drawing (it overlaps slightly with neighbouring tiles).

COUNT the following electrical symbols in this tile. Use any wattage/IP/code labels printed next to symbols (e.g. "12W", "9W", "IP65") to tell variants apart:
${list}

RULES:
- Mark the position of EVERY symbol you count: x = percent from the LEFT edge of THIS image (0-100), y = percent from the TOP edge (0-100).
- Only count a symbol if its CENTRE is inside this image. Symbols cut off at the edge with their centre outside are counted by the neighbouring tile — skip them.
- Do not count legend/key entries, title-block art, or dimension text — only symbols placed on the drawing.
- If none of an item is present in this tile, return it with an empty positions array.

Return STRICT JSON only:
{ "items": [{ "type": "<exactly as listed above>", "positions": [{ "x": <0-100>, "y": <0-100> }] }] }`
}

// ── IO: rasterise one PDF page via mupdf (WASM, no native deps) ───────

export type RasterPage = {
  widthPx: number
  heightPx: number
  /** RGBA pixel data, widthPx*heightPx*4 bytes. */
  rgba: Uint8Array
}

/** Render PDF page (1-based) to RGBA at a zoom that puts the long edge near
 *  `targetLongEdgePx`. Dynamic import keeps mupdf's WASM out of cold paths. */
export async function rasterizePage(
  pdf: Buffer | Uint8Array,
  page1: number,
  targetLongEdgePx = 4200,
): Promise<RasterPage> {
  const mupdf = await import('mupdf')
  const doc = mupdf.Document.openDocument(pdf, 'application/pdf')
  try {
    const pageCount = doc.countPages()
    if (page1 < 1 || page1 > pageCount) {
      throw new Error(`page ${page1} out of range (PDF has ${pageCount} pages)`)
    }
    const page = doc.loadPage(page1 - 1)
    const [x0, y0, x1, y1] = page.getBounds()
    const wPt = Math.max(1, x1 - x0)
    const hPt = Math.max(1, y1 - y0)
    const zoom = targetLongEdgePx / Math.max(wPt, hPt)
    const pixmap = page.toPixmap(mupdf.Matrix.scale(zoom, zoom), mupdf.ColorSpace.DeviceRGB, true, true)
    const widthPx = pixmap.getWidth()
    const heightPx = pixmap.getHeight()
    const rgba = new Uint8Array(pixmap.getPixels()) // copy out of WASM memory
    pixmap.destroy()
    page.destroy()
    return { widthPx, heightPx, rgba }
  } finally {
    doc.destroy()
  }
}

/** Crop one tile out of an RGBA raster and encode it as PNG (pngjs). */
export async function cropToPng(raster: RasterPage, tile: TileRect): Promise<Buffer> {
  const { PNG } = await import('pngjs')
  const png = new PNG({ width: tile.w, height: tile.h })
  for (let row = 0; row < tile.h; row++) {
    const srcStart = ((tile.y + row) * raster.widthPx + tile.x) * 4
    const dstStart = row * tile.w * 4
    png.data.set(raster.rgba.subarray(srcStart, srcStart + tile.w * 4), dstStart)
  }
  return PNG.sync.write(png)
}

// ── IO: the refine pass ───────────────────────────────────────────────

const TILE_CONCURRENCY = 3

export async function refineCounts({
  pdf,
  page,
  targets,
  model,
}: {
  pdf: Buffer | Uint8Array
  /** 1-based PDF page holding the dense sheet to recount. */
  page: number
  targets: RefineTarget[]
  model?: string
}): Promise<RefineResult> {
  const m = model ?? process.env.ESTIMATION_TILE_MODEL ?? process.env.ESTIMATION_MODEL ?? DEFAULT_ESTIMATION_MODEL
  const t0 = Date.now()

  const raster = await rasterizePage(pdf, page)
  const tiles = planTiles(raster.widthPx, raster.heightPx)
  const prompt = buildTilePrompt(targets)

  // Count each tile (small batches — keep memory + provider rate limits sane).
  const perTile: { tile: TileRect; counts: { type: string; positions: { x: number; y: number }[] }[] }[] = []
  for (let i = 0; i < tiles.length; i += TILE_CONCURRENCY) {
    const batch = tiles.slice(i, i + TILE_CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (tile) => {
        const png = await cropToPng(raster, tile)
        const { text } = await generateText({
          model: anthropic(m),
          ...(modelAcceptsTemperature(m) ? { temperature: 0 } : {}),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image', image: png, mediaType: 'image/png' },
              ],
            },
          ],
        })
        return { tile, counts: parseTileCounts(text) }
      }),
    )
    perTile.push(...results)
  }

  // Merge: map every tile-local point to page space, then dedupe the overlaps.
  const items: RefinedItem[] = targets.map((target) => {
    const all: PagePoint[] = []
    for (const { tile, counts } of perTile) {
      const found = counts.find((c) => c.type === target.type)
      if (found) all.push(...toPagePoints(found.positions, tile, raster.widthPx, raster.heightPx))
    }
    const deduped = dedupePoints(all)
    return {
      type: target.type,
      count: deduped.length,
      locations: deduped.map((p) => ({ page, x: p.x, y: p.y })),
    }
  })

  return {
    page,
    model: m,
    tiles: tiles.length,
    runtimeSeconds: Math.round(((Date.now() - t0) / 1000) * 10) / 10,
    items,
  }
}
