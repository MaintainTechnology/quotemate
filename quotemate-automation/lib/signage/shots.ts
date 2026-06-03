// ════════════════════════════════════════════════════════════════════
// Signage Compliance — guided photo shots.
//
// PURE. Defines the fixed shot list a studio submits and the camera
// guidance for each. Each shot is the evidence-carrier for a set of
// rules; a rule declares its `required_shots`, and at assessment time a
// rule is only scored against photos whose slot it lists.
// ════════════════════════════════════════════════════════════════════

import type { ShotSlot, SignageRule } from './types'

export type ShotDef = {
  slot: ShotSlot
  label: string
  /** Franchisee-facing camera guidance shown on the upload page. */
  instruction: string
}

export const SHOT_DEFS: readonly ShotDef[] = [
  {
    slot: 'storefront',
    label: 'Storefront',
    instruction:
      'Stand back across the footpath and capture the WHOLE shopfront in one frame — all windows, the entrance door, and any external signage.',
  },
  {
    slot: 'logo_wall',
    label: 'Logo wall',
    instruction:
      'Face the main interior wall with the F45 logo. Get the entire wall, floor to ceiling, square-on.',
  },
  {
    slot: 'v_design_close',
    label: 'V-design',
    instruction:
      'A closer, straight-on shot of the painted V behind the logo so the two grey tones are clearly visible.',
  },
  {
    slot: 'reception',
    label: 'Reception / desk',
    instruction: 'The reception desk and the wall directly behind it.',
  },
  {
    slot: 'workout_walls',
    label: 'Workout walls',
    instruction:
      'The training-floor walls — capture the colour bands (dark grey, red stripe, light grey) and any wall decals.',
  },
  {
    slot: 'retail',
    label: 'Retail area',
    instruction: 'The retail racks and the slogan above them.',
  },
] as const

const SLOT_SET: ReadonlySet<ShotSlot> = new Set(SHOT_DEFS.map((s) => s.slot))

/** The shots a sweep asks for by default — the four that unlock the MVP
 *  rule slice (storefront, logo wall, workout walls, reception). */
export const DEFAULT_SWEEP_SHOTS: readonly ShotSlot[] = [
  'storefront',
  'logo_wall',
  'workout_walls',
  'reception',
] as const

export function isShotSlot(v: unknown): v is ShotSlot {
  return typeof v === 'string' && SLOT_SET.has(v as ShotSlot)
}

/** Coerce an arbitrary array (e.g. from a request body or DB text[]) to a
 *  clean, de-duplicated, in-order ShotSlot[]. Unknown values dropped. */
export function coerceShots(v: unknown): ShotSlot[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<ShotSlot>()
  for (const x of v) if (isShotSlot(x)) seen.add(x)
  // Preserve canonical SHOT_DEFS order.
  return SHOT_DEFS.map((s) => s.slot).filter((s) => seen.has(s))
}

export function shotLabel(slot: ShotSlot): string {
  return SHOT_DEFS.find((s) => s.slot === slot)?.label ?? slot
}

/** The auto_vision rules a given shot can score — i.e. the rules whose
 *  `required_shots` include this slot. Used to build the per-photo prompt
 *  and to size the assessment. */
export function autoRulesForShot(rules: SignageRule[], slot: ShotSlot): SignageRule[] {
  return rules.filter(
    (r) => r.applicability === 'auto_vision' && r.required_shots.includes(slot),
  )
}
