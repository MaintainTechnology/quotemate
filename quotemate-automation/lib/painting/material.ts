// ════════════════════════════════════════════════════════════════════
// Painting — exterior WALL MATERIAL detection from the Street View photo.
//
// The substrate (render / weatherboard / brick / fibro / metal) is the
// single biggest driver of exterior-paint labour and prep, and the
// roof-down satellite view can't see it — but the Street View frontage
// can. We classify it with Gemini vision (same doctrine as the roofing
// solar/material detection): vision CLASSIFIES, deterministic code maps to
// cost guidance, and a pre-1990 fibro reading routes to inspection
// (asbestos risk), mirroring the roofing cement-sheet gate.
//
// PURE — no I/O. Fully unit-testable.
// ════════════════════════════════════════════════════════════════════

export type WallMaterial =
  | 'render' // rendered/painted masonry — roller-friendly, absorbent → sealer
  | 'weatherboard' // timber/Hardie boards — profiled, brush-heavy, highest labour
  | 'brick_face' // unpainted face brick — porous, heavy first coat
  | 'brick_painted' // previously painted brick — standard repaint
  | 'fibro' // fibre-cement sheet — pre-1990 = asbestos risk → inspection
  | 'metal' // Colorbond / metal cladding — smooth, fast
  | 'unknown'

export type MaterialConfidence = 'high' | 'medium' | 'low'

/** Vision output for the exterior wall substrate. */
export type MaterialDetection = {
  material: WallMaterial
  /** Storeys visible from the street (cross-checks the Solar footprint path). */
  storeys: number | null
  /** Coarse condition read: sound / weathered / peeling / bare. */
  condition_hint: 'sound' | 'weathered' | 'peeling' | 'bare' | 'unknown'
  confidence: MaterialConfidence
  notes: string
}

/** Cost/prep guidance derived from a detected material. */
export type MaterialGuidance = {
  label: string
  /** One-line note on how this substrate affects the exterior paint cost. */
  cost_note: string
  /** Suggested PaintUserInputs.condition, when the material implies one. */
  suggested_condition: 'sound' | 'minor' | 'bare' | 'poor' | null
  /** Relative exterior-labour difficulty, for a future material-aware rate. */
  labour_factor: number
  /** True when the material should force the $99 inspection route. */
  inspection: boolean
  /** Why inspection (when inspection is true). */
  inspection_reason: string | null
}

/**
 * PURE — the vision prompt for classifying the frontage's wall material.
 *
 * Decides from SURFACE GEOMETRY (texture, joints, shadow lines), never from
 * paint colour. Every label has positive confirming cues, not just "not the
 * others", to stop any single label over-triggering — the failure that read a
 * freshly-painted white weatherboard as "render". The weatherboard↔fibro line
 * carries an asymmetric safety bias because a fibro miss skips the asbestos
 * inspection gate (materialGuidance routes pre-1990 / non-low-confidence fibro
 * to inspection). Output contract is unchanged so parseMaterialDetection and
 * the quote UI consume it as-is.
 */
export function buildMaterialDetectPrompt(): string {
  return `You are analysing a single street-level photo of the FRONT of an Australian house for an exterior painting quote. Identify the PRIMARY (area-dominant) EXTERIOR WALL material of the MAIN house, its storeys, and a coarse paint-condition read. Output strict JSON only.

SCOPE
- Judge ONLY the main house's external WALLS. Ignore the roof, gutters, fascia, eaves, fence, garage door, driveway, paths, garden, vehicles, and any neighbouring house.
- Judge the REPEATED main wall plane. Discount small feature elements that are visually prominent but cover little wall: a single rendered entry blade, porch infill, a chimney, or a parapet cap. A striking foreground panel is NOT automatically the dominant material.
- If the facade is MIXED (e.g. brick base with cladding above, or render downstairs and weatherboard upstairs), pick the SINGLE material covering the LARGEST VISIBLE WALL AREA — by AREA, not by what is closest to the camera. If two materials are genuinely near-equal and you cannot tell which dominates, return "unknown".

READ THE SURFACE, NOT THE COLOUR
- Decide from SURFACE GEOMETRY: texture, joint/seam pattern, and shadow lines. Paint colour NEVER determines material — a white wall can be render, weatherboard, fibro, painted brick, or metal.

POSITIVE CUES (use to actively CONFIRM a label):
- render: ONE continuous flat or lightly trowel-textured masonry skin with NO repeating courses, NO board edges, NO brick grid. Window/door openings have RENDERED REVEALS (the wall wraps into the opening). Hairline or control joints may appear, but there is no periodic per-course/per-brick pattern. Only call render when the wall is genuinely featureless/continuous — not merely because it looks smooth from far away.
- weatherboard: a repeating series of HORIZONTAL boards that OVERLAP, each course casting a small horizontal STEP/SHADOW LINE along its bottom edge. Cues that survive thick fresh paint: the stepped/overlapping 3D profile (a raking edge, not a printed line), board BUTT JOINTS within a course, a clear bottom drip edge, board ends stopping into a corner trim (NOT wrapping into the opening as a render reveal), and faint evenly-spaced tonal banding. Confirm weatherboard ONLY when you can see the OVERLAPPING/STEPPED profile (or its shadowing) — never from a single trim line, one shadow, or because the wall is white and smooth.
- brick_face: bare unpainted brick — rectangular bricks in a bond pattern with recessed mortar joints; natural clay colour with brick-to-brick variation. BOTH horizontal AND vertical joints form a grid.
- brick_painted: the same rectangular brick GRID and recessed mortar joints, but coated in one uniform paint colour. The tell is the persistent grid and dimpled mortar lines showing through paint. If the grid is no longer resolvable, do NOT default to render — drop confidence or use "unknown".
- fibro: large FLAT fibre-cement SHEETS with little texture, separated by THIN STRAIGHT FLUSH joints or thin cover battens forming a SPARSE grid. Sheet faces are dead flat with NO overlapping step. Common pre-1990. Note: fibre-cement is also sold as imitation "weatherboard" PLANK and SCORED sheet whose lines are FLUSH/printed-flat, without the true overlapping 3D step of timber weatherboard.
- metal: smooth Colorbond / profiled metal — dead-flat panels or crisp regular ribs, slight sheen, clean factory edges, visible fastener or capping lines. Machine-uniform and metallic.

DISAMBIGUATION GUARDRAILS (do NOT over-trigger any one label, especially weatherboard):
- render vs weatherboard: weatherboard REQUIRES an actual repeating overlapping/stepped profile. Smooth + flat + featureless = render.
- weatherboard vs fibro (HIGH STAKES — asbestos): you frequently CANNOT separate timber weatherboard from fibre-cement plank in one photo. Misreading fibro as weatherboard skips an asbestos check, so apply an ASYMMETRIC bias: if the horizontal lines look FLUSH/scored (no clear overlapping step) OR the home looks older/sheet-clad, do NOT return high-confidence weatherboard — prefer "fibro" or cap confidence at "low"/"medium". Never return high confidence for weatherboard unless the overlapping stepped profile is unmistakable.
- brick_painted vs render: residual rectangular brick grid + dimpled mortar → brick_painted; truly seamless skin → render. Unresolvable grid at distance → "unknown", not render.
- brick_painted vs brick_face: uniform single paint colour over all bricks → painted; natural varied clay colour with bare mortar → face.

CONFIDENCE (set "confidence" honestly):
- high: the deciding joint/texture cue is unambiguous and clearly resolved. Do NOT use high when the wall is freshly painted/smoothed, mid-to-far distance, partly shadowed, or only partly visible.
- medium: material is probable but partly masked (freshly painted, mid-distance, partial shadow, partial view).
- low: distant, blurry, obstructed, two materials plausible, or you are guessing the dominant one.
- If the deciding cue is NOT resolvable in the image, return material "unknown" rather than a confident guess.

OTHER FIELDS
- storeys: storeys of the main house visible from the street as an integer (1, 2 or 3); use null if you cannot tell.
- condition_hint: sound (even, no peel/flake/chalk/bare), weathered (fading, chalking, hairline cracks, isolated wear), peeling (visible peeling/flaking/blistering), bare (large exposed/unpainted substrate), or unknown (too distant/shadowed/obstructed to judge).
- notes: one short plain-English sentence describing the wall and the cues you used.

Choose ONE material from EXACTLY: render, weatherboard, brick_face, brick_painted, fibro, metal, unknown.

Respond ONLY with strict JSON, no prose, no code fences: {"material": string, "storeys": number|null, "condition_hint": "sound"|"weathered"|"peeling"|"bare"|"unknown", "confidence": "high"|"medium"|"low", "notes": string}`
}

/** Gemini structured-output schema mirroring the JSON the prompt requests —
 *  passed as responseSchema so the model can only emit these keys/enums.
 *  parseMaterialDetection remains the defensive fallback. */
export const MATERIAL_DETECTION_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    material: {
      type: 'STRING',
      enum: ['render', 'weatherboard', 'brick_face', 'brick_painted', 'fibro', 'metal', 'unknown'],
    },
    storeys: { type: 'INTEGER', nullable: true },
    condition_hint: {
      type: 'STRING',
      enum: ['sound', 'weathered', 'peeling', 'bare', 'unknown'],
    },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    notes: { type: 'STRING' },
  },
  required: ['material', 'condition_hint', 'confidence', 'notes'],
}

const MATERIALS: ReadonlyArray<WallMaterial> = [
  'render',
  'weatherboard',
  'brick_face',
  'brick_painted',
  'fibro',
  'metal',
  'unknown',
]

/** PURE — parse the vision model's JSON into a MaterialDetection (or null). */
export function parseMaterialDetection(text: string): MaterialDetection | null {
  if (typeof text !== 'string' || text.trim() === '') return null
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim()
  let raw: unknown
  try {
    raw = JSON.parse(cleaned)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const material = MATERIALS.includes(o.material as WallMaterial)
    ? (o.material as WallMaterial)
    : 'unknown'
  const storeys =
    typeof o.storeys === 'number' && Number.isFinite(o.storeys) && o.storeys > 0
      ? Math.round(o.storeys)
      : null
  const condition_hint = (['sound', 'weathered', 'peeling', 'bare', 'unknown'] as const).includes(
    o.condition_hint as never,
  )
    ? (o.condition_hint as MaterialDetection['condition_hint'])
    : 'unknown'
  const confidence: MaterialConfidence =
    o.confidence === 'high' || o.confidence === 'medium' || o.confidence === 'low'
      ? o.confidence
      : 'low'
  return {
    material,
    storeys,
    condition_hint,
    confidence,
    notes: typeof o.notes === 'string' ? o.notes.slice(0, 500) : '',
  }
}

/**
 * PURE — map a detected material (+ optional build year) to cost/prep
 * guidance. Pre-1990 fibro routes to inspection (asbestos), mirroring the
 * roofing cement-sheet gate.
 */
export function materialGuidance(
  material: WallMaterial,
  opts: { yearBuilt?: number | null; confidence?: MaterialConfidence } = {},
): MaterialGuidance {
  const lowConfidence = opts.confidence === 'low'
  switch (material) {
    case 'weatherboard':
      return {
        label: 'Weatherboard',
        cost_note: 'Profiled boards + gaps = the most brush-heavy exterior — the highest labour rate.',
        suggested_condition: 'minor',
        labour_factor: 1.3,
        inspection: false,
        inspection_reason: null,
      }
    case 'render':
      return {
        label: 'Rendered masonry',
        cost_note: 'Smooth and roller-friendly, but absorbent — needs a sealer coat first.',
        suggested_condition: 'minor',
        labour_factor: 1.0,
        inspection: false,
        inspection_reason: null,
      }
    case 'brick_face':
      return {
        label: 'Bare face brick',
        cost_note: 'Unpainted brick is porous — a heavy, thirsty first coat (extra paint + a primer).',
        suggested_condition: 'bare',
        labour_factor: 1.15,
        inspection: false,
        inspection_reason: null,
      }
    case 'brick_painted':
      return {
        label: 'Painted brick',
        cost_note: 'Previously-painted brick repaints at a standard exterior rate.',
        suggested_condition: 'sound',
        labour_factor: 1.0,
        inspection: false,
        inspection_reason: null,
      }
    case 'fibro': {
      const oldFibro = typeof opts.yearBuilt === 'number' && opts.yearBuilt < 1990
      return {
        label: 'Fibre-cement (fibro)',
        cost_note: 'Fibro sheeting on a pre-1990 home may contain asbestos — must be assessed on site.',
        suggested_condition: null,
        labour_factor: 1.1,
        inspection: oldFibro || !lowConfidence,
        inspection_reason:
          'Fibro/fibre-cement sheeting can contain asbestos and must be inspected before any sanding or prep.',
      }
    }
    case 'metal':
      return {
        label: 'Metal / Colorbond cladding',
        cost_note: 'Smooth metal cladding is fast to coat — the lowest exterior labour.',
        suggested_condition: 'sound',
        labour_factor: 0.9,
        inspection: false,
        inspection_reason: null,
      }
    default:
      return {
        label: 'Unknown',
        cost_note: 'Wall material could not be read — confirm the substrate on site.',
        suggested_condition: null,
        labour_factor: 1.0,
        inspection: false,
        inspection_reason: null,
      }
  }
}
