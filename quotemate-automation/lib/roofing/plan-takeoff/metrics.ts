// A checked takeoff mapped onto the roofing pricer's input (TKO-16), so a plan
// takeoff prices on the same rate card as an aerial measurement (P3 Outputs
// and UI §5). Pure. The pricer takes one material a roof and counts of hips
// and valleys; a roof whose size, pitch or profile the drawings didn't give is
// never guessed at: it is unpriceable, with the reason, rather than priced at
// $0 as the pricer's `unknown` material would be.

import { pitchBucketFromDegrees, type RoofStructureInput } from '@/lib/roofing/pricing'
import type { RoofForm, RoofMaterial } from '@/lib/roofing/types'
import type { RoofPlanTakeoff } from './schema'

type Structure = RoofPlanTakeoff['structures'][number]

/** What a plan takeoff is priced as until D-03 brings a new-roof intent, so
 *  the tiers are an existing roof's (DEC-022). */
export const TAKEOFF_INTENT = 'full_reroof' as const

export type PriceOptions = {
  /** The structures to price, by id; every one when absent. */
  included?: string[]
  /** Storeys by structure id, 1 when absent: the takeoff doesn't record them. */
  storeys?: Record<string, number>
}

/** A roof the pricer can't price, and why. */
export type Unpriced = { structure_id: string; reason: string }

// A profile as drawings name it, against the pricer's materials. First match
// wins. Plain searches only: `concrete[^]*tile` backtracked quadratically on a
// long profile (TKO-28).
const MATERIALS: Array<[(profile: string) => boolean, RoofMaterial]> = [
  [(p) => /custom\s*orb|corrugat/i.test(p), 'colorbond_corrugated'],
  [(p) => /trim[\s-]*dek/i.test(p), 'colorbond_trimdek'],
  [(p) => /span[\s-]*dek/i.test(p), 'colorbond_spandek'],
  [(p) => /klip[\s-]*lok/i.test(p), 'colorbond_kliplok'],
  [(p) => /terra[\s-]*cotta/i.test(p), 'terracotta_tile'],
  [(p) => /concrete/i.test(p) && /tile/i.test(p), 'concrete_tile'],
]

/** The pricer's material for a profile, or null when none matches. */
export const materialOf = (profile: string | null): RoofMaterial | null =>
  MATERIALS.find(([matches]) => matches(profile ?? ''))?.[1] ?? null

const round = (n: number) => Math.round(n * 100) / 100
const sum = (values: number[]) => values.reduce((total, n) => total + n, 0)

/** The pricer's form: complex, which it sends to inspection, when the planes
 *  are none of a skillion, a gable or a hip. */
function formOf(s: Structure): RoofForm {
  if (s.planes.length === 1) return 'skillion'
  if (s.edges.some((e) => e.type === 'hip')) return 'hip'
  if (s.planes.length === 2 && s.edges.some((e) => e.type === 'ridge')) return 'gable'
  return 'complex'
}

/** Why the pricer can't price a roof, or null when it can. */
function unpriceable(s: Structure): string | null {
  const unsized = s.planes.filter((p) => p.plan_area_m2 === null).map((p) => p.id)
  if (unsized.length) return `No area for ${unsized.join(', ')}`
  if (!(sum(s.planes.map((p) => p.plan_area_m2!)) > 0)) return 'Its planes have no area'
  const unpitched = s.planes.filter((p) => p.pitch_deg === null).map((p) => p.id)
  if (unpitched.length) return `No pitch for ${unpitched.join(', ')}`
  const unmatched = [...new Set(s.planes.filter((p) => !materialOf(p.profile)).map((p) => p.profile ?? 'none given'))]
  if (unmatched.length) return `No rate for the profile ${unmatched.map((profile) => `"${profile}"`).join(', ')}`
  if (new Set(s.planes.map((p) => materialOf(p.profile))).size > 1) return 'Its planes are in more than one profile'
  return null
}

/** The takeoff's roofs as the pricer's structures, the roofs it can't price,
 *  and any `included` id the takeoff doesn't have. */
export function toRoofStructures(takeoff: RoofPlanTakeoff, options: PriceOptions = {}) {
  const included = options.included
  const unknown = (included ?? []).filter((id) => !takeoff.structures.some((s) => s.id === id))
  const structures: RoofStructureInput[] = []
  const unpriced: Unpriced[] = []
  for (const s of takeoff.structures.filter((x) => !included || included.includes(x.id))) {
    const reason = unpriceable(s)
    if (reason) {
      unpriced.push({ structure_id: s.id, reason })
      continue
    }
    const footprint = sum(s.planes.map((p) => p.plan_area_m2!))
    // The planes' pitch, weighted by their area on plan.
    const pitch = sum(s.planes.map((p) => p.pitch_deg! * p.plan_area_m2!)) / footprint
    const sloped = sum(s.planes.map((p) => p.sloped_area_m2 ?? p.plan_area_m2! / Math.cos((p.pitch_deg! * Math.PI) / 180)))
    const count = (type: string) => s.edges.filter((e) => e.type === type).length
    const ridges = s.edges.filter((e) => e.type === 'ridge' || e.type === 'hip')
    structures.push({
      buildingId: s.id,
      role: s.role,
      label: s.label,
      metrics: {
        footprint_m2: round(footprint),
        sloped_area_m2: round(sloped),
        // Own keys only: a roof called "constructor" isn't Object's.
        storeys: options.storeys && Object.hasOwn(options.storeys, s.id) ? options.storeys[s.id] : 1,
        form: formOf(s),
        hips: count('hip'),
        valleys: count('valley'),
        ridge_lm: ridges.length && ridges.every((e) => e.length_m !== null) ? round(sum(ridges.map((e) => e.length_m!))) : null,
        // Plans aren't georeferenced, and carry no capture date; a roof
        // merged from aerial data keeps its building's outline (TKO-21).
        polygon_geojson: s.aerial?.polygon ?? null,
        capture_date: null,
        pitch_degrees: round(pitch),
        pitch_source: 'measured',
        area_source: 'measured',
      },
      inputs: {
        material: materialOf(s.planes[0].profile)!,
        pitch: pitchBucketFromDegrees(pitch),
        intent: TAKEOFF_INTENT,
        building_year_built: null,
      },
    })
  }
  return { structures, unpriced, unknown }
}
