// SINGLE SOURCE OF TRUTH for the MATERIAL vocabulary — the strings a recipe
// line (shared_assembly_bom / tenant_assembly_bom .material_category) and a
// tradie's catalogue product (tenant_material_catalogue.category) may use.
//
// ── Why this is NOT lib/estimate/categories.ts ──────────────────────────
// CATEGORIES is the coarse GROUNDING vocabulary: it feeds validate.ts
// categorise(), CustomServiceSchema.category, and the dashboard "Category"
// select. Those three are its only intended consumers, and its own header says
// so.
//
// The Recipes BOM editor was wired to it by mistake. Migration 130's column
// comment states the actual rule: material_category "MUST equal a
// shared_materials.category string (exact trim+lowercase match by
// chooseMaterial())". Only 4 of CATEGORIES' 27 values satisfy that, and three
// of the misses are synonyms a tradie would reasonably trust:
//
//   tradie picks  real value      consequence
//   fan           ceiling_fan     line matches no product → unpriceable
//   rcbo          safety_switch   unpriceable
//   sundry        sundries        unpriceable — the exact singular/plural split
//                                 migration 130 fixed in the DB while leaving
//                                 the dropdown still offering the singular
//
// So: a SECOND, separate list. CATEGORIES stays exactly as it is — it gates
// every quote through validate.ts, and merging the two would be a far larger
// and riskier change than adding this one.
//
// ── Keeping this honest ─────────────────────────────────────────────────
// Values below were read out of the live database (2026-07-30). Two tests hold
// them in place: material-vocabulary.test.ts pins the lists, and
// live-material-vocabulary.test.ts (LIVE_DB) re-checks them against
// shared_materials so the code and the data cannot drift apart.
//
// Adding a material category = add a shared_materials row AND one line here.
//
// Pure data — no DB, no Next. Safe to import into the dashboard client
// component.

export interface MaterialCategoryOption {
  value: string
  label: string
}

/** Real `shared_materials.category` values, per trade.
 *
 *  Only electrical and plumbing appear: they are the only trades with a
 *  material vocabulary at all. Every roofing shared_materials row has
 *  `category` NULL, and roofing/solar/painting price through their own
 *  deterministic engines rather than a BOM. */
export const MATERIAL_VOCABULARY: Record<string, readonly MaterialCategoryOption[]> = {
  electrical: [
    { value: 'ceiling_fan', label: 'Ceiling fans' },
    { value: 'downlight', label: 'Downlights' },
    { value: 'gpo', label: 'GPO / power points' },
    { value: 'outdoor_light', label: 'Outdoor / flood lighting' },
    { value: 'safety_switch', label: 'Safety switches / RCBO' },
    { value: 'smoke_alarm', label: 'Smoke alarms' },
    { value: 'sundries', label: 'Sundries / consumables' },
  ],
  plumbing: [
    { value: 'hws_electric', label: 'Hot water — electric' },
    { value: 'hws_gas', label: 'Hot water — gas' },
    { value: 'hws_heat_pump', label: 'Hot water — heat pump' },
    { value: 'sundries', label: 'Sundries / consumables' },
    { value: 'tapware_basin', label: 'Tapware — basin' },
    { value: 'tapware_kitchen', label: 'Tapware — kitchen' },
    { value: 'tapware_laundry', label: 'Tapware — laundry' },
    { value: 'tapware_outdoor', label: 'Tapware — outdoor' },
    { value: 'toilet', label: 'Toilets / cisterns' },
    { value: 'toilet_repair', label: 'Toilet repair parts' },
  ],
} as const

/**
 * The material categories a select should offer for `trade`.
 *
 * No trade (the legacy cross-trade Recipes deep-link) returns every trade's
 * values, de-duplicated — `sundries` is shared by both. A trade with no
 * material vocabulary returns `[]`: offering invented values would be worse
 * than offering none, which is the whole bug this module exists to fix.
 */
export function materialCategoriesFor(
  trade?: string | null,
): readonly MaterialCategoryOption[] {
  const key = (trade ?? '').trim().toLowerCase()
  if (key) return MATERIAL_VOCABULARY[key] ?? []

  const seen = new Set<string>()
  const all: MaterialCategoryOption[] = []
  for (const opts of Object.values(MATERIAL_VOCABULARY)) {
    for (const o of opts) {
      if (seen.has(o.value)) continue
      seen.add(o.value)
      all.push(o)
    }
  }
  return all.sort((a, b) => a.label.localeCompare(b.label))
}

/** Is `category` a real material category for `trade`? Trade omitted checks
 *  against every trade's vocabulary — still rejects `fan`, `rcbo`, `sundry`.
 *  Compares in the canonical trim+lowercase form chooseMaterial() uses. */
export function isMaterialCategory(category: string, trade?: string | null): boolean {
  const c = (category ?? '').trim().toLowerCase()
  if (!c) return false
  return materialCategoriesFor(trade).some((o) => o.value === c)
}
