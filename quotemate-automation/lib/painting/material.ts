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

/** PURE — the vision prompt for classifying the frontage's wall material. */
export function buildMaterialDetectPrompt(): string {
  return (
    'You are analysing a street-level photo of the FRONT of an Australian house for an exterior ' +
    'painting quote. Identify the primary EXTERIOR WALL material of the main house (ignore the ' +
    'roof, fence, garden and neighbouring houses). ' +
    'To differentiate materials: ' +
    'render is flat, featureless masonry (uniform surface, no visible board edges); ' +
    'weatherboard has VISIBLE HORIZONTAL BOARD EDGES, JOINTS between boards, or subtle grooves/profile even when painted; ' +
    'brick_face is bare, unpainted brick texture; ' +
    'brick_painted is previously painted brick; ' +
    'fibro is flat sheeting with visible horizontal battens; ' +
    'metal is smooth, shiny Colorbond or metal sheeting. ' +
    'CRITICAL: If you see ANY horizontal board edges, joints, or grooves → weatherboard, NOT render. ' +
    'Choose ONE: render, weatherboard, brick_face, brick_painted, fibro, metal, or unknown. ' +
    'Also read the number of storeys and the coarse paint condition. ' +
    'Respond ONLY with strict JSON, no prose, no code fences: ' +
    '{"material": string, "storeys": number|null, "condition_hint": "sound"|"weathered"|"peeling"|"bare"|"unknown", ' +
    '"confidence": "high"|"medium"|"low", "notes": string}'
  )
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
