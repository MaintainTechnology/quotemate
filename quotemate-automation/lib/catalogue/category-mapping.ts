// v7 Phase 2b — bridge between the two category vocabularies in the
// codebase.
//
// CONTEXT (the dual-vocab problem documented in v7's Phase 6 entry):
//
//   shared_materials.category, shared_assembly_bom.material_category,
//   supplier_catalogue.category  → MATERIAL vocab (granular).
//   E.g. "tapware_basin", "tapware_kitchen", "hws_gas", "hws_electric",
//        "hws_heat_pump", "ceiling_fan", "safety_switch".
//   This is the vocab the BOM resolver + chooseMaterial() use to match
//   line items to specific product rows.
//
//   lib/estimate/categories.ts CATEGORIES → GROUNDING vocab (coarse).
//   E.g. "tap", "hot_water", "fan", "rcbo".
//   This is the vocab the grounding validator + the Catalogue-tab
//   dropdown use.
//
// tenant_material_catalogue.category historically uses GROUNDING vocab
// (the dropdown writes those values). For Phase 2b's "Add to my catalogue"
// flow, when we copy a supplier_catalogue row (granular vocab) into
// tenant_material_catalogue (grounding vocab) we need to translate.
//
// PURE + dependency-free so it's testable without DB/HTTP. Unit-tested
// in category-mapping.test.ts.

import type { Category } from '@/lib/estimate/categories'
import { CATEGORY_VALUES } from '@/lib/estimate/categories'

/** Mapping from material/supplier vocab → grounding (CATEGORIES) vocab.
 *  Only entries where the granular and grounding names DIFFER. Keys not
 *  in this map are assumed to be already-grounding (e.g. "downlight",
 *  "gpo", "smoke_alarm" — same name in both vocabularies). */
const GRANULAR_TO_GROUNDING: Readonly<Record<string, Category>> = {
  // Tapware sub-categories all collapse to `tap`.
  tapware_basin: 'tap',
  tapware_kitchen: 'tap',
  tapware_laundry: 'tap',
  tapware_outdoor: 'tap',
  // HWS fuel-type sub-categories all collapse to `hot_water`.
  hws_gas: 'hot_water',
  hws_electric: 'hot_water',
  hws_heat_pump: 'hot_water',
  // Single-name renames.
  ceiling_fan: 'fan',
  safety_switch: 'rcbo',
  // Plural variants seen in the wild (the shared_materials backfill in
  // migration 022 uses "sundries" but CATEGORIES has "sundry").
  sundries: 'sundry',
  // Sub-categories that fold to their parent.
  toilet_repair: 'toilet',
}

/**
 * Translate a material/granular category to its grounding category.
 * Returns null when the input is empty or doesn't map to a known
 * grounding value (caller decides whether to drop the row or use 'general').
 *
 * Idempotent: passing a grounding category already in CATEGORIES returns
 * it unchanged — so callers can apply this defensively even if they're
 * not sure which vocab they hold.
 */
export function granularToGroundingCategory(
  input: string | null | undefined,
): Category | null {
  if (!input) return null
  const key = String(input).trim().toLowerCase()
  if (!key) return null
  // Explicit mapping wins.
  if (key in GRANULAR_TO_GROUNDING) return GRANULAR_TO_GROUNDING[key]
  // Already a known grounding category — pass through.
  if ((CATEGORY_VALUES as ReadonlySet<string>).has(key)) {
    return key as Category
  }
  // Unknown — caller decides what to do (fallback to 'general', flag for
  // deprecated badge, etc.).
  return null
}
