// QuoteMate · seed the signage_rules registry from the generated CSV/JSON.
//
// Source of truth: docs/deliverables/signage_rules.json (174 rules,
// deduped + tiered from the F45 Global Signage Guidelines extraction).
// Upserts on (brand_slug, rule_set_version, rule_key) so re-running is
// safe and picks up edits to the registry file.
//
// Usage: node --env-file=.env.local scripts/seed-signage-rules.mjs
//        node --env-file=.env.local scripts/seed-signage-rules.mjs --version 1

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const here = dirname(fileURLToPath(import.meta.url))
const jsonPath = join(here, '..', '..', 'docs', 'deliverables', 'signage_rules.json')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const versionArgIdx = process.argv.indexOf('--version')
const ruleSetVersion = versionArgIdx >= 0 ? Number(process.argv[versionArgIdx + 1]) : 1

const VALID_SHOTS = new Set([
  'storefront',
  'logo_wall',
  'v_design_close',
  'reception',
  'workout_walls',
  'retail',
])

function toShots(s) {
  if (!s || typeof s !== 'string') return []
  return s
    .split(';')
    .map((x) => x.trim())
    .filter((x) => VALID_SHOTS.has(x))
}

function toCitation(page) {
  if (!page) return null
  const p = String(page).trim()
  if (!p) return null
  return /page/i.test(p) ? p : `Page ${p}`
}

const rows = JSON.parse(readFileSync(jsonPath, 'utf8'))
const supabase = createClient(url, key, { auth: { persistSession: false } })

const records = rows.map((r) => ({
  brand_slug: 'f45',
  rule_set_version: ruleSetVersion,
  rule_key: r.rule_key,
  rule_text: r.rule_text ?? '',
  rule_group: r.rule_group ?? 'other',
  modality: r.modality ?? 'must',
  applicability: r.applicability ?? 'human_review_only',
  confidence: r.confidence ?? 'low',
  mvp_tier: r.mvp_tier ?? 'human_queue',
  verdict_mode: r.verdict_mode ?? 'review',
  required_shots: toShots(r.required_shots),
  check_hint: r.check_method ?? null,
  source_citation: toCitation(r.page),
  active: true,
}))

// Dedupe by rule_key (the registry may carry a couple of collisions; keep
// the first — the JSON is already deduped, this is belt-and-braces so the
// upsert's ON CONFLICT key never sees a same-batch duplicate).
const seen = new Set()
const deduped = records.filter((r) => {
  if (seen.has(r.rule_key)) return false
  seen.add(r.rule_key)
  return true
})

console.log(`Seeding ${deduped.length} signage rules (version ${ruleSetVersion})…`)

const { error } = await supabase
  .from('signage_rules')
  .upsert(deduped, { onConflict: 'brand_slug,rule_set_version,rule_key' })

if (error) {
  console.error('SEED FAILED:', error.message)
  process.exit(1)
}

const byTier = {}
for (const r of deduped) byTier[r.mvp_tier] = (byTier[r.mvp_tier] ?? 0) + 1
console.log('  done. mvp_tier breakdown:', byTier)
const core = deduped.filter((r) => r.mvp_tier === 'mvp_core').length
console.log(`  ${core} rules are mvp_core (the slice the AI scores in MVP).`)
