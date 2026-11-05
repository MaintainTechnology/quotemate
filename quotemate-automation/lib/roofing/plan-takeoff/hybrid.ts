// Hybrid jobs (TKO-21, App Flow F6, DEC-025): the roofs the tradie names as
// existing are measured from aerial data and merged into the plan takeoff.
//
// The reader's labels ("Existing house (re-roof)") are free text, not a
// contract, so the tradie names the existing roofs. Each takes an aerial
// building, the largest first: the first roof named takes the largest one.
// Its planes share the building's footprint, by their drawn areas when every
// plane has one, else equally; a pitch the drawings give stays, else the
// aerial one when Solar measured it. New roofs and exclusions stay as drawn.
// The merge saves as a correction, so C1 to C10 run again (DEC-019).

import type { SupabaseClient } from '@supabase/supabase-js'
import { GeoscapeProvider } from '@/lib/roofing/providers/geoscape'
import { enrichMetricsWithSolar, resolveSolarOpts } from '@/lib/roofing/solar-api'
import type { RoofAddressInput, RoofMeasuredBuilding, RoofingMultiMeasurementResult, RoofUserInputs } from '@/lib/roofing/types'
import { correctTakeoff, type CorrectOutcome } from './runs'
import { postcodeAndState, runWithTakeoff } from './save'
import type { RoofPlanTakeoff } from './schema'

type Structure = RoofPlanTakeoff['structures'][number]
type Plane = Structure['planes'][number]

const round2 = (n: number) => Math.round(n * 100) / 100
const sloped = (plan: number, pitch: number | null) => (pitch === null ? null : round2(plan / Math.cos((pitch * Math.PI) / 180)))

export type MergeOutcome =
  | { ok: true; takeoff: RoofPlanTakeoff }
  | { ok: false; error: 'unknown_structures'; ids: string[] }
  | { ok: false; error: 'aerial_unmatched'; ids: string[] }

/** The takeoff with each named existing roof measured from its building. */
export function mergeAerial(takeoff: RoofPlanTakeoff, existing: string[], buildings: RoofMeasuredBuilding[]): MergeOutcome {
  // A roof named twice is taken once, at its first place in the order.
  const named = [...new Set(existing)]
  const unknown = named.filter((id) => !takeoff.structures.some((s) => s.id === id))
  if (unknown.length) return { ok: false, error: 'unknown_structures', ids: unknown }
  const bySize = [...buildings].sort((a, b) => b.metrics.footprint_m2 - a.metrics.footprint_m2)
  if (named.length > bySize.length) return { ok: false, error: 'aerial_unmatched', ids: named.slice(bySize.length) }
  const paired = new Map(named.map((id, i) => [id, bySize[i]]))
  return {
    ok: true,
    takeoff: { ...takeoff, structures: takeoff.structures.map((s) => (paired.has(s.id) ? fromAerial(s, paired.get(s.id)!) : s)) },
  }
}

function fromAerial(s: Structure, b: RoofMeasuredBuilding): Structure {
  const footprint = b.metrics.footprint_m2
  const aerialPitch = b.metrics.pitch_degrees ?? null
  const sized = s.planes.length > 0 && s.planes.every((p) => (p.plan_area_m2 ?? 0) > 0)
  const drawn = sized ? round2(s.planes.reduce((total, p) => total + p.plan_area_m2!, 0)) : null
  // A roof read without planes gets one, sized by its building.
  const planes: Plane[] = s.planes.length ? s.planes : [{
    id: `${s.id}-A1`, plan_dims_mm: null, polygon_mm: null, plan_area_m2: null, pitch_deg: null, pitch_source: null,
    fall: null, profile: null, finish_tag: null, sloped_area_m2: null, confidence: 'medium', evidence: [],
  }]
  return {
    ...s,
    source: 'hybrid',
    planes: planes.map((p) => {
      const plan = round2(footprint * (drawn ? p.plan_area_m2! / drawn : 1 / planes.length))
      const pitch = p.pitch_deg ?? aerialPitch
      const pitchSource = p.pitch_deg !== null ? p.pitch_source : aerialPitch !== null ? 'aerial' : null
      return { ...p, plan_area_m2: plan, pitch_deg: pitch, pitch_source: pitchSource, sloped_area_m2: sloped(plan, pitch) }
    }),
    aerial: { building_id: b.buildingId, footprint_m2: footprint, drawn_plan_m2: drawn, polygon: b.metrics.polygon_geojson },
  }
}

/** Measures every building at an address: Geoscape, with Solar's pitch when
 *  it is set up. The service gives the real one; tests give their own. */
export type AerialMeasure = (address: RoofAddressInput) => Promise<RoofingMultiMeasurementResult>

// Solar wants a roof's inputs, but only the pitch it measures is kept here.
const PITCH_ONLY: RoofUserInputs = { material: 'unknown', pitch: 'standard', intent: 'full_reroof', building_year_built: null }

/** The service's measure: Geoscape's buildings at the address, each with the
 *  pitch Solar measured when GOOGLE_SOLAR_API_KEY is set. A pitch Solar only
 *  declared is dropped, so the drawings' pitch, or none, stands. */
export function geoscapeMeasure(env: Record<string, string | undefined> = process.env): AerialMeasure {
  return async (address) => {
    if (!env.GEOSCAPE_API_KEY) throw new Error('GEOSCAPE_API_KEY is not set')
    const found = await new GeoscapeProvider({ apiKey: env.GEOSCAPE_API_KEY }).measureAll(address)
    if (!found.ok || !env.GOOGLE_SOLAR_API_KEY) return found
    const solar = resolveSolarOpts({ enabled: true, apiKey: env.GOOGLE_SOLAR_API_KEY })
    const buildings = await Promise.all(found.buildings.map(async (b) => {
      const enriched = await enrichMetricsWithSolar(b.metrics, PITCH_ONLY, solar)
      return enriched.applied ? { ...b, metrics: { ...b.metrics, pitch_degrees: enriched.metrics.pitch_degrees } } : b
    }))
    return { ...found, buildings }
  }
}

export type HybridOutcome =
  | CorrectOutcome
  | { ok: false; error: 'unknown_structures'; ids: string[] }
  | { ok: false; error: 'aerial_unavailable'; detail: string }

/** Measures the run's site from aerial data, merges the named existing roofs,
 *  and saves the merge as a correction, so the checks run again. */
export async function measureAndMerge(db: SupabaseClient, input: {
  tenantId: string
  runId: string
  existing: string[]
  measure: AerialMeasure
  timeoutMs?: number
  now?: Date
}): Promise<HybridOutcome> {
  const found = await runWithTakeoff(db, input.tenantId, input.runId)
  if (!found) return { ok: false, error: 'not_found' }
  const { run, takeoff } = found
  if (!takeoff) return { ok: false, error: 'conflict_status', status: run.status }
  // The named roofs first, so a typo costs no Geoscape call.
  const unknown = input.existing.filter((id) => !takeoff.structures.some((s) => s.id === id))
  if (unknown.length) return { ok: false, error: 'unknown_structures', ids: unknown }
  const { postcode, state } = postcodeAndState(run)
  if (!postcode || !state) return { ok: false, error: 'aerial_unavailable', detail: 'The site address has no state and postcode to look up.' }
  const measured = await withinLimit(() => input.measure({ address: run.site_address, postcode, state }), input.timeoutMs ?? 60_000)
  if (!measured.ok) return { ok: false, error: 'aerial_unavailable', detail: measured.detail }
  const merged = mergeAerial(takeoff, input.existing, measured.buildings)
  if (!merged.ok && merged.error === 'aerial_unmatched') {
    const n = measured.buildings.length
    return { ok: false, error: 'aerial_unavailable', detail: `Aerial data found ${n} building${n === 1 ? '' : 's'} at the address, so ${merged.ids.join(', ')} has none to take.` }
  }
  if (!merged.ok) return merged
  return correctTakeoff(db, { tenantId: input.tenantId, runId: input.runId, takeoff: merged.takeoff, now: input.now })
}

/** The measurement, or why there is none: a failure, a throw, or the limit. */
async function withinLimit(measure: () => Promise<RoofingMultiMeasurementResult>, ms: number): Promise<RoofingMultiMeasurementResult | { ok: false; detail: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<{ ok: false; detail: string }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, detail: `Aerial data took longer than ${Math.round(ms / 1000)} seconds.` }), ms)
  })
  try {
    return await Promise.race([
      measure().catch((error: unknown) => ({ ok: false as const, detail: `Aerial data failed: ${String(error).slice(0, 200)}` })),
      late,
    ])
  } finally {
    clearTimeout(timer)
  }
}
