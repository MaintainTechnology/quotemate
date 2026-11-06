// The pack's roof outline as DXF (TKO-18, DEC-036, DEC-037): R12 (AC1009) in
// ASCII, the version every CAD reader takes, Roof Wizard's import among them.
// Millimetres at 1:1 with north up, as packGeometry draws it. Each roof's
// planes are on ROOF-<id> and its aerial footprint on FOOTPRINT-<id>; edges
// the takeoff fixes are on a layer for each type, and labels and fall arrows
// on LABELS. R12 has no units field, so the units are in a note on the
// drawing, the manifest and the brief.
//
// Every value is one line. Text the model wrote is reduced to printable ASCII
// before it is written, so no label can end a group and start an entity.

import { EDGE_TYPES } from '../schema'
import type { DrawnStructure, PackGeometry, Point } from './geometry'
import type { PackStructure } from './privacy'

export const EDGE_LAYERS = ['ridge', 'hip', 'valley', 'barge', 'eave', 'high_side', 'apron', 'box_gutter', 'parapet']
  .map((type) => `EDGE-${type.toUpperCase()}`)

// AutoCAD colour numbers: outlines white, footprints grey, labels yellow, and
// each edge type its own.
const EDGE_COLOURS: Record<string, number> = {
  'EDGE-RIDGE': 6, 'EDGE-HIP': 30, 'EDGE-VALLEY': 4, 'EDGE-BARGE': 1, 'EDGE-EAVE': 5,
  'EDGE-HIGH_SIDE': 3, 'EDGE-APRON': 40, 'EDGE-BOX_GUTTER': 140, 'EDGE-PARAPET': 9,
}
const LABEL_HEIGHT_MM = 300
const PLANE_LABEL_MM = 200
const NOTE_HEIGHT_MM = 250

/** One line of printable ASCII, at most `max` characters before escaping:
 *  breaks and other controls become spaces, accents go, and the degree and
 *  percent signs are written as DXF writes them (%%d, %%%). */
export function dxfText(text: string, max = 200): string {
  const plain = text
    .slice(0, max)
    .replace(/[\r\n\t\f\v]/g, ' ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
  return plain
    .split('°')
    .map((part) => part.replace(/[^\x20-\x7e]/g, ' ').replace(/%/g, '%%%'))
    .join('%%d')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/** A layer name CAD allows: capitals, digits, `$`, `-` and `_`, at most 31. */
const layerName = (prefix: string, id: string) => `${prefix}-${id.toUpperCase().replace(/[^A-Z0-9_$-]/g, '_')}`.slice(0, 31)

const real = (n: number) => (Math.abs(n) < 5e-4 ? 0 : n).toFixed(3)

class Writer {
  private readonly lines: string[] = []
  pair(code: number, value: string | number) {
    this.lines.push(String(code).padStart(3, ' '), typeof value === 'number' ? String(value) : value)
  }
  point(at: Point, base = 10) {
    this.pair(base, real(at[0]))
    this.pair(base + 10, real(at[1]))
    this.pair(base + 20, real(0))
  }
  toString() {
    return `${this.lines.join('\r\n')}\r\n`
  }
}

type Layers = { roof: Map<DrawnStructure, string>; footprint: Map<DrawnStructure, string>; all: string[] }

/** Each roof's layers, unique even when two ids read the same as layer names. */
function layersFor(geometry: PackGeometry, structures: PackStructure[]): Layers {
  const taken = new Set(['0', 'LABELS', ...EDGE_LAYERS])
  const unique = (name: string) => {
    let candidate = name
    for (let n = 2; taken.has(candidate); n++) candidate = `${name.slice(0, 31 - `-${n}`.length)}-${n}`
    taken.add(candidate)
    return candidate
  }
  const roof = new Map<DrawnStructure, string>()
  const footprint = new Map<DrawnStructure, string>()
  for (const s of geometry.structures) roof.set(s, unique(layerName('ROOF', s.id)))
  geometry.structures.forEach((s, i) => {
    if (structures[i]?.aerial) footprint.set(s, unique(layerName('FOOTPRINT', s.id)))
  })
  return { roof, footprint, all: [...roof.values(), ...footprint.values(), ...EDGE_LAYERS, 'LABELS'] }
}

function polyline(w: Writer, layer: string, points: Point[]) {
  w.pair(0, 'POLYLINE')
  w.pair(8, layer)
  w.pair(66, 1)
  w.point([0, 0])
  w.pair(70, 1) // closed
  for (const at of points) {
    w.pair(0, 'VERTEX')
    w.pair(8, layer)
    w.point(at)
  }
  w.pair(0, 'SEQEND')
  w.pair(8, layer)
}

function line(w: Writer, layer: string, from: Point, to: Point) {
  w.pair(0, 'LINE')
  w.pair(8, layer)
  w.point(from, 10)
  w.point(to, 11)
}

function text(w: Writer, at: Point, height: number, value: string) {
  const words = dxfText(value)
  if (!words) return
  w.pair(0, 'TEXT')
  w.pair(8, 'LABELS')
  w.point(at)
  w.pair(40, real(height))
  w.pair(1, words)
}

/** An arrow down a plane's fall: a shaft from its centre and two barbs. */
function fallArrow(w: Writer, centre: Point, fall: Point, outline: Point[]) {
  const xs = outline.map((p) => p[0])
  const ys = outline.map((p) => p[1])
  const size = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  const length = Math.min(Math.max(size * 0.3, 500), 2500)
  const tip: Point = [centre[0] + fall[0] * length, centre[1] + fall[1] * length]
  const barb = length * 0.25
  const turn = (angle: number): Point => {
    const [x, y] = [-fall[0], -fall[1]]
    return [tip[0] + barb * (x * Math.cos(angle) - y * Math.sin(angle)), tip[1] + barb * (x * Math.sin(angle) + y * Math.cos(angle))]
  }
  line(w, 'LABELS', centre, tip)
  line(w, 'LABELS', tip, turn(Math.PI / 7))
  line(w, 'LABELS', tip, turn(-Math.PI / 7))
}

/** The pack's DXF, and the layers it declares in the order it declares them. */
export function toDxf(geometry: PackGeometry, structures: PackStructure[]): { dxf: string; layers: string[] } {
  const layers = layersFor(geometry, structures)
  const [x1, y1, x2, y2] = geometry.extent
  const w = new Writer()

  w.pair(0, 'SECTION')
  w.pair(2, 'HEADER')
  w.pair(9, '$ACADVER')
  w.pair(1, 'AC1009')
  w.pair(9, '$INSBASE')
  w.point([0, 0])
  w.pair(9, '$EXTMIN')
  w.point([x1, y1 - 1500])
  w.pair(9, '$EXTMAX')
  w.point([x2, y2 + 1000])
  w.pair(0, 'ENDSEC')

  w.pair(0, 'SECTION')
  w.pair(2, 'TABLES')
  w.pair(0, 'TABLE')
  w.pair(2, 'LTYPE')
  w.pair(70, 1)
  w.pair(0, 'LTYPE')
  w.pair(2, 'CONTINUOUS')
  w.pair(70, 0)
  w.pair(3, 'Solid line')
  w.pair(72, 65)
  w.pair(73, 0)
  w.pair(40, real(0))
  w.pair(0, 'ENDTAB')
  w.pair(0, 'TABLE')
  w.pair(2, 'LAYER')
  w.pair(70, layers.all.length + 1)
  for (const name of ['0', ...layers.all]) {
    w.pair(0, 'LAYER')
    w.pair(2, name)
    w.pair(70, 0)
    w.pair(62, EDGE_COLOURS[name] ?? (name === 'LABELS' ? 2 : name.startsWith('FOOTPRINT-') ? 8 : 7))
    w.pair(6, 'CONTINUOUS')
  }
  w.pair(0, 'ENDTAB')
  w.pair(0, 'TABLE')
  w.pair(2, 'STYLE')
  w.pair(70, 1)
  w.pair(0, 'STYLE')
  w.pair(2, 'STANDARD')
  w.pair(70, 0)
  w.pair(40, real(0))
  w.pair(41, real(1))
  w.pair(50, real(0))
  w.pair(71, 0)
  w.pair(42, real(LABEL_HEIGHT_MM))
  w.pair(3, 'txt')
  w.pair(4, '')
  w.pair(0, 'ENDTAB')
  w.pair(0, 'ENDSEC')

  w.pair(0, 'SECTION')
  w.pair(2, 'ENTITIES')
  geometry.structures.forEach((s, i) => {
    if (!s.box) return
    const roof = layers.roof.get(s)!
    for (const plane of s.planes) if (plane.outline) polyline(w, roof, plane.outline)
    const footprint = layers.footprint.get(s)
    if (footprint && s.footprint) polyline(w, footprint, s.footprint)
    for (const edge of s.edges) line(w, `EDGE-${edge.type.toUpperCase()}`, edge.from, edge.to)
    text(w, [s.box[0], s.box[3] + 400], LABEL_HEIGHT_MM, `${s.id} ${s.label}`)
    s.planes.forEach((plane, j) => {
      if (!plane.outline || !plane.centre) return
      const pitch = structures[i]?.planes[j]?.pitch_deg ?? null
      text(w, [plane.centre[0] - 600, plane.centre[1] + 300], PLANE_LABEL_MM, pitch === null ? plane.id : `${plane.id} ${pitch}°`)
      if (plane.fall) fallArrow(w, plane.centre, plane.fall, plane.outline)
    })
  })
  text(w, [x1, y1 - 1200], NOTE_HEIGHT_MM, "Millimetres at 1:1, north up. Each roof has its own slot, so the slots don't show where the roofs sit on the site.")
  w.pair(0, 'ENDSEC')
  w.pair(0, 'EOF')
  // Edge types come from the schema; a new one needs its layer here first.
  if (EDGE_TYPES.length !== EDGE_LAYERS.length) throw new Error('Every edge type needs its DXF layer')
  return { dxf: w.toString(), layers: layers.all }
}
