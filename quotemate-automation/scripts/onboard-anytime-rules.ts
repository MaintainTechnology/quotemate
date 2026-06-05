// QuoteMate · Anytime Fitness rule onboarding (signage compliance).
//
// Mirrors the F45 onboarding (extractBrand → signage_rules) but tailored for
// an EXISTING brand whose shots we are REGENERATING from its own documents:
//
//   1. pdftotext every standards PDF in the Docs dir.
//   2. ONE coherent shot list across the whole corpus (proposeBrandShots).
//   3. extractBrand per doc, mapping rules onto that fixed shot list, so
//      each doc's rule output can't truncate the others and keeps its source.
//   4. Dry-run prints the shots + rule tiers + samples. --apply writes:
//        • brands.shots  = the regenerated list (anytime-fitness only)
//        • signage_rules = upserted, brand_slug='anytime-fitness', v1
//      It does NOT touch the brand's name / kb_store_ids / identity.
//
// Usage (DRY RUN — prints what it WOULD do):
//   node --import tsx --env-file=.env.local scripts/onboard-anytime-rules.ts \
//     --docs "C:/Users/dalig/Downloads/QuoteMate/gym-franchise-rules-protocols/AnytimeFitness/Docs"
//   ...add --apply to write the shots + rules to the DB.

import { readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { proposeBrandShots, extractBrand, type ExtractedRule } from '../lib/signage/extract-brand'
import type { ShotDef, VerdictMode } from '../lib/signage/types'

const BRAND_SLUG = 'anytime-fitness'
const BRAND_NAME = 'Anytime Fitness'
const LOCATION_NOUN = 'club'
const RULE_SET_VERSION = 1

// Per-doc cap fed to the (small-output) shot-proposal pass — enough structure
// to design the shot list without an enormous prompt. Full text is used for
// the per-doc rule extraction.
const SHOT_PROPOSAL_CHARS_PER_DOC = 45000

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const has = (flag: string) => process.argv.includes(flag)

const docsDir = arg(
  '--docs',
  'C:/Users/dalig/Downloads/QuoteMate/gym-franchise-rules-protocols/AnytimeFitness/Docs',
)!
const apply = has('--apply')

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

/** Short tag (rule_key prefix) + human label per known doc; slug fallback. */
function docMeta(filename: string): { tag: string; label: string } {
  const stem = filename.replace(/\.pdf$/i, '')
  const l = stem.toLowerCase()
  if (l.includes('design manual')) return { tag: 'design', label: 'AF Design Manual v3.3' }
  if (l.includes('remodel')) return { tag: 'remodel', label: 'AF Remodel Manual v3.3' }
  if (l.includes('lighting')) return { tag: 'lighting', label: 'AF Lighting & Zoning v2.2025' }
  if (l.includes('bathroom')) return { tag: 'bathroom', label: 'AF Premium Bathroom Spec v2.2025' }
  if (l.includes('design element')) return { tag: 'elements', label: 'AF Design Element Update 2025' }
  const tag = l.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 2).join('-') || 'doc'
  return { tag, label: stem }
}

function pdfToText(path: string): string {
  try {
    return execFileSync('pdftotext', ['-q', path, '-'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
  } catch (e) {
    console.error(`  pdftotext failed for ${path}:`, e instanceof Error ? e.message : String(e))
    return ''
  }
}

async function main() {
  const files = readdirSync(docsDir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort()
  if (files.length === 0) {
    console.error(`No PDFs found in ${docsDir}`)
    process.exit(1)
  }

  console.log(`Reading ${files.length} PDF(s) from ${docsDir}…`)
  const docs = files.map((f) => {
    const text = pdfToText(join(docsDir, f)).replace(/\s+/g, ' ').trim()
    const meta = docMeta(f)
    console.log(`  ${meta.tag.padEnd(9)} ${String(text.length).padStart(7)} chars  ${f}`)
    return { file: f, ...meta, text }
  }).filter((d) => d.text.length >= 200)

  // 1. Propose ONE coherent shot list across the whole corpus.
  const corpus = docs
    .map((d) => `\n=== ${d.label} ===\n${d.text.slice(0, SHOT_PROPOSAL_CHARS_PER_DOC)}`)
    .join('\n')
  console.log(`\nProposing a shot list across ${docs.length} docs (${corpus.length} chars)…`)
  const shots: ShotDef[] = await proposeBrandShots({ brandName: BRAND_NAME, locationNoun: LOCATION_NOUN, docText: corpus })
  if (shots.length === 0) {
    console.error('No shots proposed (no API key, or the model returned nothing). Aborting.')
    process.exit(1)
  }
  console.log(`\nProposed shots (${shots.length}):`)
  for (const s of shots) console.log(`  - ${s.slot.padEnd(18)} ${s.label} — ${s.instruction}`)

  // 2. Extract rules per doc, mapped onto the fixed shot list.
  const allRules: Array<ExtractedRule & { source_doc: string }> = []
  for (const d of docs) {
    process.stdout.write(`\nExtracting rules from ${d.label}… `)
    const { rules } = await extractBrand({
      brandName: BRAND_NAME,
      locationNoun: LOCATION_NOUN,
      docText: d.text,
      targetShots: shots,
    })
    console.log(`${rules.length} rules`)
    for (const r of rules) {
      allRules.push({
        ...r,
        rule_key: `${d.tag}-${r.rule_key}`,
        source_citation: r.source_citation ? `${d.label} · ${r.source_citation}` : d.label,
        source_doc: d.label,
      })
    }
  }

  // 3. Dedupe: exact rule_key (cross-doc safe via prefix) + identical text.
  const byKey = new Map<string, (typeof allRules)[number]>()
  const seenText = new Set<string>()
  for (const r of allRules) {
    const norm = r.rule_text.toLowerCase().replace(/\s+/g, ' ').trim()
    if (byKey.has(r.rule_key) || seenText.has(norm)) continue
    seenText.add(norm)
    byKey.set(r.rule_key, r)
  }
  const rules = [...byKey.values()]

  const tiers: Record<string, number> = {}
  for (const r of rules) tiers[r.verdict_mode] = (tiers[r.verdict_mode] ?? 0) + 1
  const scored = rules.filter((r) => r.verdict_mode === 'pass_fail' || r.verdict_mode === 'detect_only').length
  const perShot: Record<string, number> = {}
  for (const r of rules) perShot[r.shot] = (perShot[r.shot] ?? 0) + 1

  console.log(`\n${'─'.repeat(64)}`)
  console.log(`TOTAL rules (deduped): ${rules.length}  | AI-scorable: ${scored}`)
  console.log(`verdict_mode tiers: ${JSON.stringify(tiers)}`)
  console.log(`rules per shot: ${JSON.stringify(perShot)}`)
  console.log('Sample rules:')
  for (const r of rules.slice(0, 12)) {
    console.log(`  ${r.verdict_mode.padEnd(14)} [${String(r.shot).padEnd(16)}] ${r.rule_text.slice(0, 80)}`)
  }

  if (!apply) {
    console.log('\nDRY RUN — re-run with --apply to write the shots + rules to the DB.')
    return
  }

  const sb = createClient(url!, key!, { auth: { persistSession: false } })

  // 4a. Regenerate the brand's shots (do NOT touch name/kb_store_ids/etc.).
  const { error: brandErr } = await sb.from('brands').update({ shots }).eq('slug', BRAND_SLUG)
  if (brandErr) {
    console.error('brand shots update failed:', brandErr.message)
    process.exit(1)
  }

  // 4b. Upsert the rules.
  const rows = rules.map((r) => ({
    brand_slug: BRAND_SLUG,
    rule_set_version: RULE_SET_VERSION,
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

  console.log(`\n✓ Anytime Fitness onboarded: ${shots.length} shots + ${rows.length} rules live.`)
  console.log('  Next: create a fresh sweep for the brand, then submit photos to see a real report.')
}

main().catch((e) => {
  console.error('onboard failed:', e)
  process.exit(1)
})
