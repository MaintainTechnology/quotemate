// The pack's quantities as CSV (TKO-18, DEC-036, DEC-037): a row for each
// plane, edge and exclusion, a total for each roof and the job, and a total
// for each edge type, so a supplier's spreadsheet or Roof Wizard's import
// takes it as it is. RFC 4180 with a byte-order mark, so Excel reads it as
// UTF-8. A value the drawings don't give is an empty cell, never 0.
//
// A cell a spreadsheet would run as a formula (one starting =, +, -, @, a tab
// or a carriage return) gets a leading apostrophe: its text came from a model
// reading a builder's drawings.

import { EDGE_TYPES } from '../schema'
import type { PackGeometry } from './geometry'
import type { PackStructure } from './privacy'

export const CSV_COLUMNS = [
  'record', 'structure_id', 'structure', 'role', 'source', 'item', 'type',
  'profile', 'finish_tag', 'pitch_deg', 'pitch_source', 'fall',
  'plan_length_mm', 'plan_width_mm', 'plan_area_m2', 'roof_area_m2',
  'length_m', 'length_source', 'confidence', 'drawn', 'sheets', 'note',
] as const
type Column = (typeof CSV_COLUMNS)[number]
type Row = Partial<Record<Column, string | number | null>>

const round = (n: number | null, places: number) => (n === null ? null : Number(n.toFixed(places)))

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const line = (row: Row) => CSV_COLUMNS.map((column) => cell(row[column])).join(',')
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The planes' areas summed, and how many planes have none. */
function areas(structures: PackStructure[]) {
  const planes = structures.flatMap((s) => s.planes)
  const sum = (pick: (p: (typeof planes)[number]) => number | null) =>
    round(planes.reduce((total, p) => total + (pick(p) ?? 0), 0), 2)
  const missing = planes.filter((p) => p.plan_area_m2 === null).length
  return {
    plan_area_m2: sum((p) => p.plan_area_m2),
    roof_area_m2: sum((p) => p.sloped_area_m2),
    note: missing ? `${plural(missing, 'plane has', 'planes have')} no area` : '',
  }
}

/** The pack's CSV. `geometry` says which planes and edges the DXF draws. */
export function toCsv(structures: PackStructure[], geometry: PackGeometry): string {
  const lines: string[] = [CSV_COLUMNS.join(',')]
  structures.forEach((s, i) => {
    const drawn = geometry.structures[i]
    const base: Row = { structure_id: s.id, structure: s.label, role: s.role, source: s.source }
    s.planes.forEach((p, j) => {
      lines.push(line({
        ...base,
        record: 'plane',
        item: p.id,
        profile: p.profile,
        finish_tag: p.finish_tag,
        pitch_deg: p.pitch_deg,
        pitch_source: p.pitch_source,
        fall: p.fall,
        plan_length_mm: round(p.plan_dims_mm?.[0] ?? null, 1),
        plan_width_mm: round(p.plan_dims_mm?.[1] ?? null, 1),
        plan_area_m2: round(p.plan_area_m2, 2),
        roof_area_m2: round(p.sloped_area_m2, 2),
        confidence: p.confidence,
        drawn: drawn?.planes[j]?.from ?? 'no',
        sheets: p.sheets.join('; '),
      }))
    })
    const onLayers = new Set(drawn?.edges.map((e) => e.index) ?? [])
    s.edges.forEach((e, j) => {
      lines.push(line({
        ...base,
        record: 'edge',
        item: `E${j + 1}`,
        type: e.type,
        length_m: round(e.length_m, 3),
        length_source: e.source,
        confidence: e.confidence,
        drawn: onLayers.has(j) ? 'yes' : 'no',
      }))
    })
    for (const x of s.exclusions) lines.push(line({ ...base, record: 'exclusion', item: x.label, plan_area_m2: round(x.area_m2, 2), note: x.reason }))
    lines.push(line({ ...base, record: 'total', ...areas([s]) }))
  })
  lines.push(line({ record: 'total', structure_id: 'all', structure: 'All roofs', ...areas(structures) }))
  const edges = structures.flatMap((s) => s.edges)
  for (const type of EDGE_TYPES) {
    const ofType = edges.filter((e) => e.type === type)
    if (!ofType.length) continue
    const missing = ofType.filter((e) => e.length_m === null).length
    lines.push(line({
      record: 'edge_total',
      structure_id: 'all',
      type,
      length_m: round(ofType.reduce((sum, e) => sum + (e.length_m ?? 0), 0), 3),
      note: missing ? `${plural(missing, 'edge has', 'edges have')} no length` : '',
    }))
  }
  return `﻿${lines.join('\r\n')}\r\n`
}
