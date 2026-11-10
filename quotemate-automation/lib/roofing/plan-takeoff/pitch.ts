// Pitches measured off the elevations' roof lines (TKO-30, DEC-044). In an
// elevation, a roof's slopes are straight strokes at its pitch: a hip's end
// face, or a face seen end on, rises at the pitch of its roof. Roof lines come
// in mirrored pairs across a sheet's opposite elevations, rising one way and
// falling the other, where stairs, hatching and lettering lean one way. So a
// pitch is a family of long strokes within a degree of each other, with a
// fifth or more of its length leaning each way.

import type { Segment } from './calibrate'
import type { RoofPlanTakeoff } from './schema'

type Takeoff = RoofPlanTakeoff
type Plane = Takeoff['structures'][number]['planes'][number]

/** A roof pitch the elevation draws, and the length of stroke behind it, in points. */
export type ElevationPitch = { deg: number; support: number }

const MIN_PITCH = 1.5 // flatter is a ground or floor line drawn out of true
const MAX_PITCH = 60
const WINDOW = 1 // degrees from a family's first stroke to its last
const MIN_SHARE = 0.2 // of a family's length, leaning each way
const MIN_FAMILY = 0.25 // of the best supported family's length, to count as a roof

/** The roof pitches a sheet's strokes draw, the best supported first. Strokes
 *  shorter than `minLength` points, such as lettering's, are passed over. */
export function elevationPitches(segments: Segment[], minLength = 20): ElevationPitch[] {
  const strokes = segments.flatMap(([x1, y1, x2, y2]) => {
    const [dx, dy] = [x2 - x1, y2 - y1]
    const length = Math.hypot(dx, dy)
    const deg = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI
    // The page's y grows downwards, so a stroke rising to the right has dx and dy of opposite signs.
    return length >= minLength && deg >= MIN_PITCH && deg <= MAX_PITCH ? [{ deg, length, rising: dx * dy < 0 }] : []
  }).sort((a, b) => a.deg - b.deg)

  const families: (typeof strokes)[] = []
  for (const s of strokes) {
    const last = families.at(-1)
    if (last && s.deg - last[0].deg <= WINDOW) last.push(s)
    else families.push([s])
  }
  return families.flatMap((family) => {
    const support = family.reduce((sum, s) => sum + s.length, 0)
    const rising = family.reduce((sum, s) => sum + (s.rising ? s.length : 0), 0)
    if (support < 3 * minLength || Math.min(rising, support - rising) < MIN_SHARE * support) return []
    const mean = family.reduce((sum, s) => sum + s.deg * s.length, 0) / support
    return [{ deg: Math.round(mean * 2) / 2, support: Math.round(support) }]
  }).sort((a, b) => b.support - a.support)
}

const CONFIDENCE = { low: 0, medium: 1, high: 2 } as const

/** Gives each plane the reading left without a pitch one of the elevation's.
 *  A roof of several planes, a hip or a gable, takes the steepest; a roof of
 *  one plane, a skillion, the shallowest. A pitch the reading has stays, and
 *  a plane pitched this way is no more than `medium` confidence. */
export function pitchFromElevations(takeoff: Takeoff, found: ElevationPitch[], sheet: { file: string; page: number }): { takeoff: Takeoff; pitched: number } {
  const best = Math.max(0, ...found.map((f) => f.support))
  const roofs = found.filter((f) => f.support >= MIN_FAMILY * best).map((f) => f.deg)
  if (!roofs.length) return { takeoff, pitched: 0 }
  const steep = Math.max(...roofs)
  const shallow = Math.min(...roofs)

  let pitched = 0
  const structures = takeoff.structures.map((s) => {
    const several = s.planes.length > 1
    const deg = several ? steep : shallow
    const why = steep === shallow ? 'the roof lines on the elevation'
      : several ? 'the steepest roof lines on the elevation, for a roof of several planes'
        : 'the shallowest roof lines on the elevation, for a roof of one plane'
    const planes = s.planes.map((p): Plane => {
      if (p.pitch_deg !== null) return p
      pitched++
      const evidence = { ...sheet, text: `Pitch ${deg}°: ${why}`, bbox: null }
      return {
        ...p,
        pitch_deg: deg,
        pitch_source: 'elevation',
        sloped_area_m2: p.plan_area_m2 === null ? null : Math.round((p.plan_area_m2 / Math.cos((deg * Math.PI) / 180)) * 100) / 100,
        confidence: CONFIDENCE[p.confidence] > CONFIDENCE.medium ? 'medium' : p.confidence,
        // The schema holds at most 50 evidence entries a plane.
        evidence: p.evidence.length < 50 ? [...p.evidence, evidence] : p.evidence,
      }
    })
    return { ...s, planes }
  })
  return pitched ? { takeoff: { ...takeoff, structures }, pitched } : { takeoff, pitched: 0 }
}
