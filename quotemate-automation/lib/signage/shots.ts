// ════════════════════════════════════════════════════════════════════
// Signage Compliance — guided photo shots (brand-agnostic).
//
// PURE. Shot lists are per-brand DATA now (brands.shots), not F45
// constants. These helpers operate on a brand's ShotDef[] / slot strings.
// ════════════════════════════════════════════════════════════════════

import type { ShotDef, ShotSlot, SignageRule } from './types'

/** Coerce an arbitrary value (a request body or a DB text[]) to a clean,
 *  de-duplicated ShotSlot[]. If `valid` is given (a brand's slot list),
 *  unknown slots are dropped. */
export function coerceShots(v: unknown, valid?: readonly ShotSlot[]): ShotSlot[] {
  if (!Array.isArray(v)) return []
  const allow = valid ? new Set(valid) : null
  const seen = new Set<ShotSlot>()
  const out: ShotSlot[] = []
  for (const x of v) {
    if (typeof x !== 'string' || x === '') continue
    if (allow && !allow.has(x)) continue
    if (seen.has(x)) continue
    seen.add(x)
    out.push(x)
  }
  return out
}

/** Just the slot ids from a brand's shot defs. */
export function shotSlots(shots: ShotDef[]): ShotSlot[] {
  return shots.map((s) => s.slot)
}

/** A shot's human label, looked up in the brand's shot defs. */
export function shotLabel(slot: ShotSlot, shots: ShotDef[]): string {
  return shots.find((s) => s.slot === slot)?.label ?? slot
}

/** The rules the AI actually scores for a given shot — those it may at
 *  least FLAG (verdict_mode pass_fail or detect_only) whose `required_shots`
 *  include this slot. needs_reference + review rules are never sent to the
 *  model; the backstop materialises them as review. */
export function autoRulesForShot(rules: SignageRule[], slot: ShotSlot): SignageRule[] {
  return rules.filter(
    (r) =>
      (r.verdict_mode === 'pass_fail' || r.verdict_mode === 'detect_only') &&
      r.required_shots.includes(slot),
  )
}
