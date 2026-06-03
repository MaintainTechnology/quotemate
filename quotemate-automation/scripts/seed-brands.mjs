// QuoteMate · seed brand configs (+ a 2nd demo brand to prove the engine
// is brand-agnostic). Upserts into `brands`; seeds a handful of demo rules
// for the 2nd brand so multi-brand isolation is visible.
//
// Usage: node --env-file=.env.local scripts/seed-brands.mjs

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const sb = createClient(url, key, { auth: { persistSession: false } })

const F45 = {
  slug: 'f45',
  name: 'F45 Training',
  location_noun: 'studio',
  location_noun_plural: 'studios',
  hq_name: 'F45 HQ',
  vision_persona: 'F45 fitness studios',
  shots: [
    { slot: 'storefront', label: 'Storefront', instruction: 'Stand back across the footpath and capture the WHOLE shopfront in one frame — all windows, the entrance door, and any external signage.' },
    { slot: 'logo_wall', label: 'Logo wall', instruction: 'Face the main interior wall with the F45 logo. Get the entire wall, floor to ceiling, square-on.' },
    { slot: 'v_design_close', label: 'V-design', instruction: 'A closer, straight-on shot of the painted V behind the logo so the two grey tones are clearly visible.' },
    { slot: 'reception', label: 'Reception / desk', instruction: 'The reception desk and the wall directly behind it.' },
    { slot: 'workout_walls', label: 'Workout walls', instruction: 'The training-floor walls — capture the colour bands (dark grey, red stripe, light grey) and any wall decals.' },
    { slot: 'retail', label: 'Retail area', instruction: 'The retail racks and the slogan above them.' },
  ],
}

// 2nd brand — a gelato franchise. Different location noun ("store"),
// different persona, an entirely different shot list. Proves the engine
// reads brand config rather than F45 constants.
const GELATISSIMO = {
  slug: 'gelatissimo',
  name: 'Gelatissimo',
  location_noun: 'store',
  location_noun_plural: 'stores',
  hq_name: 'Gelatissimo HQ',
  vision_persona: 'Gelatissimo gelato stores',
  shots: [
    { slot: 'shopfront', label: 'Shopfront', instruction: 'Capture the whole shopfront — fascia sign, windows and entrance in one frame.' },
    { slot: 'gelato_display', label: 'Gelato display', instruction: 'A straight-on shot of the gelato display cabinet showing the tubs.' },
    { slot: 'menu_board', label: 'Menu board', instruction: 'The menu / price board behind the counter, readable.' },
    { slot: 'seating_area', label: 'Seating area', instruction: 'The customer seating area.' },
    { slot: 'staff_area', label: 'Counter / staff', instruction: 'The service counter with staff visible.' },
  ],
}

const GELATISSIMO_RULES = [
  { rule_key: 'shopfront-logo-present', rule_group: 'storefront', verdict_mode: 'pass_fail', required_shots: ['shopfront'], confidence: 'high', rule_text: 'The approved Gelatissimo fascia logo must be displayed on the shopfront.', check_hint: 'Detect the Gelatissimo wordmark/logo on the shopfront fascia.' },
  { rule_key: 'menu-board-approved-template', rule_group: 'menu', verdict_mode: 'detect_only', required_shots: ['menu_board'], confidence: 'medium', rule_text: 'The menu board must use the approved Gelatissimo template and branding.', check_hint: 'Flag a menu board that is clearly off-brand (wrong colours/layout); a compliant-looking board still needs HQ template confirmation.' },
  { rule_key: 'gelato-display-full-presentable', rule_group: 'product', verdict_mode: 'detect_only', required_shots: ['gelato_display'], confidence: 'medium', rule_text: 'Gelato display tubs must be kept full and presentable during trading hours.', check_hint: 'Flag visibly empty/half-empty or messy tubs as a violation.' },
  { rule_key: 'staff-branded-uniform', rule_group: 'staff', verdict_mode: 'detect_only', required_shots: ['staff_area'], confidence: 'medium', rule_text: 'Staff must wear the branded Gelatissimo uniform.', check_hint: 'Flag staff clearly not in branded uniform; cannot certify exact uniform spec from a photo.' },
  { rule_key: 'seating-area-clean', rule_group: 'cleanliness', verdict_mode: 'pass_fail', required_shots: ['seating_area'], confidence: 'medium', rule_text: 'The customer seating area must be clean and uncluttered.', check_hint: 'Assess whether tables/floor are clean and free of clutter.' },
  { rule_key: 'price-board-visible', rule_group: 'menu', verdict_mode: 'pass_fail', required_shots: ['menu_board'], confidence: 'high', rule_text: 'Prices must be clearly displayed on the menu board.', check_hint: 'Confirm price text is present and legible on the board.' },
]

async function upsertBrand(b) {
  const { error } = await sb.from('brands').upsert(b, { onConflict: 'slug' })
  if (error) throw new Error(`brand ${b.slug}: ${error.message}`)
  console.log(`  brand ${b.slug} (${b.shots.length} shots) upserted`)
}

try {
  console.log('Seeding brands…')
  await upsertBrand(F45)
  await upsertBrand(GELATISSIMO)

  const rows = GELATISSIMO_RULES.map((r) => ({
    brand_slug: 'gelatissimo',
    rule_set_version: 1,
    rule_key: r.rule_key,
    rule_text: r.rule_text,
    rule_group: r.rule_group,
    modality: 'must',
    applicability: r.verdict_mode === 'pass_fail' ? 'auto_vision' : 'needs_metadata_or_context',
    confidence: r.confidence,
    mvp_tier: r.verdict_mode === 'pass_fail' ? 'mvp_core' : 'human_queue',
    verdict_mode: r.verdict_mode,
    required_shots: r.required_shots,
    check_hint: r.check_hint,
    source_citation: 'Demo brand',
    active: true,
  }))
  const { error } = await sb
    .from('signage_rules')
    .upsert(rows, { onConflict: 'brand_slug,rule_set_version,rule_key' })
  if (error) throw new Error(`gelatissimo rules: ${error.message}`)
  console.log(`  seeded ${rows.length} Gelatissimo demo rules`)
  console.log('\nDone. Two brands now live: f45 (173 rules) + gelatissimo (demo).')
} catch (e) {
  console.error('SEED FAILED:', e.message)
  process.exit(1)
}
