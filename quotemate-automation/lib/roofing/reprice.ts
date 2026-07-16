// Pure re-price for the /m tradie edge-override flow: apply confirmed
// hip/valley/box-gutter counts, accessory quantities (gutter / downpipe /
// fascia / soffit) and measurement corrections (pitch / area / form /
// storeys) onto a persisted MultiRoofQuote's structures and re-run pricing
// with the tenant rate card. Extracted so the measurement route stays thin
// and this stays unit-testable without Supabase.
//
// Interconnected-recompute rules (post-inspection "simple adjustment"):
//   • pitch_degrees → declares the measured-on-site pitch, re-buckets
//     inputs.pitch, and re-derives sloped_area_m2 from the footprint —
//     UNLESS the same override also declares sloped_area_m2 (explicit
//     area beats recompute). The new pitch also flows into per-edge hip/
//     valley lengths via deriveEdgeWorks inside pricing.
//   • sloped_area_m2 → used verbatim (the tradie measured it).
//   • form 'complex' / very-steep pitch → inspection routing fires
//     automatically inside calculateRoofingPrice; nothing special here.
//   • Every overridden measurement stamps field_sources = 'declared' so a
//     tradie edit never masquerades as a measured value.

import type { MultiRoofQuote, RoofFieldSources, RoofForm, RoofingRateCard } from './types'
import { pitchBucketFromDegrees, priceMultiRoof, slopedAreaFromFootprint } from './pricing'

/** One structure's tradie-confirmed overrides, keyed by 1-based index.
 *  Undefined fields keep the stored value; null clears where meaningful. */
export type EdgeOverride = {
  index: number
  hips?: number | null
  valleys?: number | null
  box_gutter_lm?: number | null
  // Accessory quantities — same trust model as box_gutter_lm (explicit
  // tradie input only; null = remove the accessory line).
  gutter_lm?: number | null
  downpipe_count?: number | null
  fascia_lm?: number | null
  soffit_lm?: number | null
  // Measurement corrections. Only positive numbers apply (null is a no-op:
  // clearing a measurement would silently force inspection routing, so we
  // require an explicit value instead).
  pitch_degrees?: number | null
  sloped_area_m2?: number | null
  form?: RoofForm | null
  storeys?: number | null
}

/** PURE — apply overrides (1-based index) to a stored quote's structures
 *  and re-price. Preserves the job-level solar addon + property context,
 *  which pricing doesn't reproduce. */
export function repriceWithEdgeOverrides(
  quote: MultiRoofQuote,
  edges: EdgeOverride[],
  rateCard?: RoofingRateCard,
): MultiRoofQuote {
  const byIndex = new Map(edges.map((e) => [e.index, e]))
  const structures = quote.structures.map((s, i) => {
    const o = byIndex.get(i + 1)
    if (!o) {
      return { buildingId: s.buildingId, role: s.role, metrics: s.metrics, inputs: s.inputs }
    }
    const m = { ...s.metrics }
    let inputs = s.inputs
    const declare = (field: keyof RoofFieldSources) => {
      m.field_sources = { ...m.field_sources, [field]: 'declared' }
    }

    // Counts + accessory quantities — undefined keeps the stored value.
    if (o.hips !== undefined) m.hips = o.hips
    if (o.valleys !== undefined) m.valleys = o.valleys
    if (o.box_gutter_lm !== undefined) m.box_gutter_lm = o.box_gutter_lm
    if (o.gutter_lm !== undefined) m.gutter_lm = o.gutter_lm
    if (o.downpipe_count !== undefined) m.downpipe_count = o.downpipe_count
    if (o.fascia_lm !== undefined) m.fascia_lm = o.fascia_lm
    if (o.soffit_lm !== undefined) m.soffit_lm = o.soffit_lm

    // Measurement corrections — declared provenance, interconnected.
    if (o.form !== undefined && o.form !== null) {
      m.form = o.form
      declare('form')
    }
    if (typeof o.storeys === 'number' && Number.isFinite(o.storeys)) {
      m.storeys = o.storeys
      declare('storeys')
    }
    if (typeof o.pitch_degrees === 'number' && Number.isFinite(o.pitch_degrees)) {
      m.pitch_degrees = o.pitch_degrees
      m.pitch_source = 'declared'
      declare('pitch')
      const bucket = pitchBucketFromDegrees(o.pitch_degrees)
      inputs = { ...inputs, pitch: bucket }
      if (typeof o.sloped_area_m2 !== 'number') {
        // Re-derive the pricing area from the new pitch (explicit area in
        // the same call wins below). very_steep/unknown buckets derive
        // null, which correctly routes the structure to inspection.
        m.sloped_area_m2 = slopedAreaFromFootprint(m.footprint_m2, bucket)
        m.area_source = 'derived'
        m.field_sources = { ...m.field_sources, sloped_area: 'derived' }
      }
    }
    if (typeof o.sloped_area_m2 === 'number' && Number.isFinite(o.sloped_area_m2)) {
      m.sloped_area_m2 = o.sloped_area_m2
      // Neither DSM-'measured' nor pitch-'derived' — a declared area.
      delete m.area_source
      declare('sloped_area')
    }

    return { buildingId: s.buildingId, role: s.role, metrics: m, inputs }
  })
  const repriced = priceMultiRoof({ structures, rateCard })
  // priceMultiRoof rebuilds structures/combined/routing but not the job-level
  // solar addon or property context — carry them across so a re-price doesn't
  // drop the customer-facing solar line or the property chips.
  return { ...repriced, solar: quote.solar, property_context: quote.property_context }
}
