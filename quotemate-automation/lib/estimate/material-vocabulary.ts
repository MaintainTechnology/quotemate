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
// The Recipes BOM editor was wired to it by mistake. But the defect was
// NARROWER than it first looked. Migration 130's comment says material_category
// "MUST equal a shared_materials.category string" — true of the SHARED price
// fallback, and only 4 of CATEGORIES' 27 values satisfy it. It is NOT the whole
// rule: chooseMaterial resolves the TENANT leg on category match alone
// (catalogue.ts:170-173), so a tradie's own product prices any category at all.
//
// So most of CATEGORIES was fine — unstocked centrally, but stockable. Only
// five values were actually wrong: three synonyms a tradie would reasonably
// trust, and two that needed splitting.
//
//   tradie picks  real value      consequence
//   fan           ceiling_fan     line matches no product → unpriceable
//   rcbo          safety_switch   unpriceable
//   sundry        sundries        unpriceable — the exact singular/plural split
//                                 migration 130 fixed in the DB while leaving
//                                 the dropdown still offering the singular
//   hot_water     hws_electric | hws_gas | hws_heat_pump   too coarse to price
//   tap           tapware_basin | _kitchen | _laundry | _outdoor  too coarse
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
// Adding a category = one line here. A shared_materials row is OPTIONAL: with
// one the category prices for every tenant; without one it prices only for a
// tradie who stocks it. Marking which is which in-line keeps that visible.
//
// Pure data — no DB, no Next. Safe to import into the dashboard client
// component.

export interface MaterialCategoryOption {
  value: string
  label: string
}

/** Every material category a recipe line or a catalogue product may name.
 *
 *  Only electrical and plumbing appear: they are the only trades with a
 *  material vocabulary at all. Every roofing shared_materials row has
 *  `category` NULL, and roofing/solar/painting price through their own
 *  deterministic engines rather than a BOM. */
export const MATERIAL_VOCABULARY: Record<string, readonly MaterialCategoryOption[]> = {
  // Values marked (shared) have a shared_materials row, so they price even for a
  // tradie with an empty catalogue. The rest are STOCKABLE: no central fallback,
  // but chooseMaterial resolves the tenant leg on category match alone
  // (catalogue.ts:170-173), so a tradie's own product prices them.
  //
  // Both kinds belong here. An earlier cut of this list held only the (shared)
  // values, which silently removed a tradie's ability to stock an EV charger or
  // a security camera at all — see vocabulary-regression.test.ts.
  electrical: [
    { value: 'ceiling_fan', label: 'Ceiling fans' }, // shared
    { value: 'doorbell_intercom', label: 'Doorbell / intercom' },
    { value: 'downlight', label: 'Downlights' }, // shared
    { value: 'ev_charger', label: 'EV charger' },
    { value: 'fault_find', label: 'Fault finding / diagnostics' },
    { value: 'gpo', label: 'GPO / power points' }, // shared
    { value: 'outdoor_light', label: 'Outdoor / flood lighting' }, // shared
    { value: 'oven_cooktop', label: 'Oven / cooktop' },
    { value: 'safety_switch', label: 'Safety switches / RCBO' }, // shared
    { value: 'security_camera', label: 'Security cameras' },
    { value: 'smoke_alarm', label: 'Smoke alarms' }, // shared
    { value: 'strip_light', label: 'LED strip lighting' },
    { value: 'sundries', label: 'Sundries / consumables' }, // shared
    { value: 'switchboard', label: 'Switchboard' },
    { value: 'general', label: 'General (no specific category)' },
  ],
  plumbing: [
    { value: 'cctv', label: 'Drain camera (CCTV)' },
    { value: 'dishwasher', label: 'Dishwasher connection' },
    { value: 'drain', label: 'Blocked drains' },
    { value: 'gas', label: 'Gas fitting / gas leak' },
    { value: 'hws_electric', label: 'Hot water — electric' }, // shared
    { value: 'hws_gas', label: 'Hot water — gas' }, // shared
    { value: 'hws_heat_pump', label: 'Hot water — heat pump' }, // shared
    { value: 'leak_detection', label: 'Leak detection' },
    { value: 'prv', label: 'Pressure reduction valve' },
    { value: 'rainwater_tank', label: 'Rainwater tank' },
    { value: 'shower', label: 'Shower head' },
    { value: 'sundries', label: 'Sundries / consumables' }, // shared
    { value: 'tapware_basin', label: 'Tapware — basin' }, // shared
    { value: 'tapware_kitchen', label: 'Tapware — kitchen' }, // shared
    { value: 'tapware_laundry', label: 'Tapware — laundry' }, // shared
    { value: 'tapware_outdoor', label: 'Tapware — outdoor' }, // shared
    { value: 'toilet', label: 'Toilets / cisterns' }, // shared
    { value: 'toilet_repair', label: 'Toilet repair parts' }, // shared
    { value: 'water_filter', label: 'Water filter / filtration' },
    { value: 'general', label: 'General (no specific category)' },
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
