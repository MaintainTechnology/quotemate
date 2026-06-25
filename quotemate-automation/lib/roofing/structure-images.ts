// ════════════════════════════════════════════════════════════════════
// Roofing — per-structure aerial image refs (spec
// specs/roofing-pdf-multi-structure-images.md).
//
// A roofing quote can cover several structures (house + shed + …). Each
// structure that is actually shown on a quote should get its OWN aerial
// image, centred on that building via the static-map `?b=<index>` param —
// not just the first structure. The `?b=` index is 1-based into the FULL
// detected quote (`roofing_measurements.quote`), because that is the quote
// the static-map endpoint indexes.
//
// `structureImageRefs` maps the structures actually rendered on a quote
// (the narrowed, included set — which may be a subset / re-ordered copy
// loaded from a different DB read, so NOT reference-equal to the full
// quote) back to their 1-based index in the full quote, keyed by the
// stable `buildingId` (falling back to `label`). Excluded structures are
// simply absent from the rendered set, so they get no image;
// inspection-but-included structures are present and DO.
//
// PURE — no I/O. Unit-tested.
// ════════════════════════════════════════════════════════════════════

import type { RoofStructurePrice } from './types'

/** One structure that should get its own centred aerial image on a quote. */
export type RoofStructureImageRef = {
  /** 1-based index into the FULL detected quote — drives static-map `?b=`. */
  index1Based: number
  /** Structure label, used as the figure caption. */
  label: string
}

/** Relative static-map path centred on a structure (1-based). Pure. */
export function structureStaticMapPath(token: string, index1Based: number): string {
  return `/api/roofing/q/${token}/static-map?b=${index1Based}`
}

/**
 * Map each rendered structure back to its 1-based index in the full detected
 * quote, so each can request its own centred aerial image. Matches by the
 * stable `buildingId` first, then by `label`; a rendered structure with no
 * match is dropped (no wrong-building image). The result is de-duplicated
 * (one full-quote structure is never claimed twice) and sorted by full-quote
 * index so images follow detection order.
 */
export function structureImageRefs(
  fullStructures: readonly RoofStructurePrice[] | null | undefined,
  renderedStructures: readonly RoofStructurePrice[] | null | undefined,
): RoofStructureImageRef[] {
  const full = Array.isArray(fullStructures) ? fullStructures : []
  const rendered = Array.isArray(renderedStructures) ? renderedStructures : []
  if (full.length === 0 || rendered.length === 0) return []

  const used = new Set<number>()
  const refs: RoofStructureImageRef[] = []
  for (const r of rendered) {
    let fi = -1
    if (r.buildingId != null) {
      fi = full.findIndex((s, i) => !used.has(i) && s.buildingId != null && s.buildingId === r.buildingId)
    }
    if (fi < 0 && r.label) {
      fi = full.findIndex((s, i) => !used.has(i) && s.label === r.label)
    }
    if (fi < 0) continue
    used.add(fi)
    refs.push({ index1Based: fi + 1, label: full[fi].label })
  }
  return refs.sort((a, b) => a.index1Based - b.index1Based)
}
