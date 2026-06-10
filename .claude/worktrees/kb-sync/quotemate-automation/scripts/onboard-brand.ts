// QuoteMate · self-serve brand onboarding.
//
// Turn ANY brand's standards document into a live brand on the compliance
// platform: a guided shot list + a verdict_mode-tagged rule registry.
// Productises the F45 onboarding so a new brand = "drop in their doc".
//
// Usage (dry-run prints what it WOULD create):
//   node --import tsx --env-file=.env.local scripts/onboard-brand.ts \
//     --slug mcdonalds --name "McDonald's" --location-noun restaurant \
//     --hq-name "McDonald's Corporate" --persona "McDonald's restaurants" \
//     --doc ./mcdonalds-standards.txt
//   ...add --apply to write the brand + rules to the DB.
//
// `--doc` is a TEXT file (extract a PDF to text first, e.g. with pypdf).

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { extractBrand } from '../lib/signage/extract-brand'
import type { VerdictMode } from '../lib/signage/types'

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const has = (flag: string) => process.argv.includes(flag)

const slug = arg('--slug')
const name = arg('--name')
const docPath = arg('--doc')
const locationNoun = arg('--location-noun', 'location')!
const hqName = arg('--hq-name', `${name ?? 'Brand'} HQ`)!
const persona = arg('--persona', `${name ?? 'the brand'} locations`)!
const apply = has('--apply')

if (!slug || !name || !docPath) {
  console.error('Required: --slug <slug> --name "<Name>" --doc <text-file> [--location-noun --hq-name --persona] [--apply]')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const MODE_TO_LEGACY: Record<VerdictMode, { applicability: string; mvp_tier: string }> = {
  pass_fail: { applicability: 'auto_vision', mvp_tier: 'mvp_core' },
  detect_only: { applicability: 'needs_metadata_or_context', mvp_tier: 'human_queue_metadata' },
  needs_reference: { applicability: 'needs_scale_reference', mvp_tier: 'phase2_measure' },
  review: { applicability: 'human_review_only', mvp_tier: 'human_queue' },
}

async function main() {
  const docText = readFileSync(docPath!, 'utf8')
  console.log(`Onboarding "${name}" (${slug}) from ${docPath} — ${docText.length} chars…`)
  console.log('Extracting shots + rules with Claude (this can take a minute)…')

  const { shots, rules } = await extractBrand({ brandName: name!, locationNoun, docText })
  if (rules.length === 0) {
    console.error('No rules extracted (no API key, or the model returned nothing). Aborting.')
    process.exit(1)
  }

  const tiers: Record<string, number> = {}
  for (const r of rules) tiers[r.verdict_mode] = (tiers[r.verdict_mode] ?? 0) + 1
  const scored = rules.filter((r) => r.verdict_mode === 'pass_fail' || r.verdict_mode === 'detect_only').length

  console.log(`\nProposed shots (${shots.length}): ${shots.map((s) => s.slot).join(', ')}`)
  console.log(`Extracted rules: ${rules.length}  | tiers: ${JSON.stringify(tiers)}`)
  console.log(`AI would score ${scored} of ${rules.length} (pass_fail + detect_only).`)

  if (!apply) {
    console.log('\nDRY RUN — re-run with --apply to write the brand + rules to the DB.')
    console.log('Sample rules:')
    for (const r of rules.slice(0, 8)) console.log(`  ${r.verdict_mode.padEnd(15)} [${r.shot}] ${r.rule_key}`)
    return
  }

  const sb = createClient(url!, key!, { auth: { persistSession: false } })

  const { error: brandErr } = await sb.from('brands').upsert(
    {
      slug,
      name,
      location_noun: locationNoun,
      location_noun_plural: `${locationNoun}s`,
      hq_name: hqName,
      vision_persona: persona,
      shots,
      active: true,
    },
    { onConflict: 'slug' },
  )
  if (brandErr) {
    console.error('brand upsert failed:', brandErr.message)
    process.exit(1)
  }

  const rows = rules.map((r) => ({
    brand_slug: slug,
    rule_set_version: 1,
    rule_key: r.rule_key,
    rule_text: r.rule_text,
    rule_group: r.rule_group,
    modality: r.modality,
    applicability: MODE_TO_LEGACY[r.verdict_mode].applicability,
    confidence: r.confidence,
    mvp_tier: MODE_TO_LEGACY[r.verdict_mode].mvp_tier,
    verdict_mode: r.verdict_mode,
    required_shots: r.shot === 'na' ? [] : [r.shot],
    check_hint: r.check_hint,
    source_citation: r.source_citation,
    active: true,
  }))
  const { error: rulesErr } = await sb
    .from('signage_rules')
    .upsert(rows, { onConflict: 'brand_slug,rule_set_version,rule_key' })
  if (rulesErr) {
    console.error('rules upsert failed:', rulesErr.message)
    process.exit(1)
  }

  console.log(`\n✓ Brand "${name}" onboarded: ${shots.length} shots + ${rows.length} rules live.`)
  console.log(`  Point an org at it with orgs.brand_slug = '${slug}', then run a sweep.`)
}

main().catch((e) => {
  console.error('onboard failed:', e)
  process.exit(1)
})
