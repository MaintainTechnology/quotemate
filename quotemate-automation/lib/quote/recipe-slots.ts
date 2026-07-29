// ════════════════════════════════════════════════════════════════════
// Form answers → price-recipe slots.
//
// The pair to job-fields.ts: that file defines the questions, this coerces the
// answers into the shapes applyPriceBands expects.
//
// WHY THIS EXISTS. Exactly one assembly in production carries a price_recipe —
// "Replace double GPO" (electrical/gpo) — and it asks two questions:
// `distance_to_existing_power` (numeric bands: ≤2m nothing, ≤5m +0.5h, ≤10m
// +1h + 10lm TPS, >10m +2h + 20lm) and `circuit_required` (select; 20A and
// three-phase each swap the base assembly via use_assembly_id).
//
// buildRecipeSlots (lib/estimate/merge-recipes.ts:394) collects slots from
// three sources in order: intake top-level, intake.scope.*, then
// conversation_state.slots. A dashboard-drafted quote has no sms_conversations
// row, so pass 3 is always empty and intake.scope is the ONLY channel these
// can travel down. Unstamped, the recipe applies its default_when_unanswered
// (2 metres, 10A) and a long run on a dedicated circuit quotes as a short run
// on a standard one.
//
// PURE — no imports, no I/O.
// ════════════════════════════════════════════════════════════════════

/** Field codes this module understands. Add to it when a new price_recipe ships. */
export const RECIPE_SLOT_CODES = ['distance_to_existing_power', 'circuit_required'] as const

/**
 * Coerce the recipe answers out of a form answer bag.
 *
 * A blank or unparseable answer is OMITTED rather than defaulted here — the
 * recipe's own `default_when_unanswered` is the correct fallback, and it can
 * only apply if the slot is absent.
 */
export function recipeSlotsFrom(
  answers: Record<string, string> | null | undefined,
): Record<string, number | string> {
  const out: Record<string, number | string> = {}
  if (!answers) return out

  // Guard on the trimmed STRING before Number(): Number('') is 0, which is
  // finite and >= 0, so an empty box would otherwise stamp a real "0 metres"
  // and lock the cheapest band instead of leaving the slot unanswered.
  const rawDistance = (answers.distance_to_existing_power ?? '').trim()
  if (rawDistance) {
    const distance = Number(rawDistance)
    if (Number.isFinite(distance) && distance >= 0) {
      out.distance_to_existing_power = distance
    }
  }

  // Passed through verbatim: applySelectBand (lib/estimate/price-bands.ts:230)
  // compares an exact lowercased string against the band values, so the form's
  // option strings must already BE the band values ('10A' / '20A' /
  // 'three-phase'). Normalising here would just hide a mismatch.
  const circuit = (answers.circuit_required ?? '').trim()
  if (circuit) out.circuit_required = circuit

  return out
}
