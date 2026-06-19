// ═══════════════════════════════════════════════════════════════════
// QuoteMate · catalogue-integrity auditor (R11, read-only)
//
// The structural-integrity companion to migration 130. Reports — and never
// writes — the four R11 integrity signals so they can be reconciled BEFORE
// AU price calibration (R12/R13) runs on the catalogue:
//
//   1. shared_assembly_bom rows still on the SINGULAR 'sundry'
//      (must be 'sundries' — the value chooseMaterial() resolves against
//      shared_materials.category). FAILS the audit if any remain — this is
//      the recurrence guard migration 130 documents instead of a hard CHECK.
//   2. shared_materials rows with brand IS NULL / '' (flagged for owner
//      input — flag-not-fabricate; never auto-filled).
//   3. duplicate (trade, lower(category), lower(name)) groups — the
//      migration-130 unique index forbids these; CREATE UNIQUE INDEX fails
//      until they are de-duped by hand (FLAGGED for owner, never auto-deleted).
//   4. allowlisted job types whose primary material category lacks a complete
//      Good/Better/Best 3-tier spread (>= 3 distinct products).
//
// EXIT CODE: 0 only when there are 0 'sundry' rows AND 0 duplicate groups.
// brand NULLs and incomplete tier spreads are REPORTED but do NOT fail the
// run on their own (they are owner-input / calibration work, not a structural
// bug the migration must block on) — they are surfaced loudly so they are not
// forgotten.
//
// Usage:
//   node --env-file=.env.local scripts/audit-catalogue-integrity.mjs
// ═══════════════════════════════════════════════════════════════════

import pg from 'pg'

const { Client } = pg
const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

// Allowlisted (top-5) job types -> the PRIMARY shared_materials.category that
// supplies their Good/Better/Best product tiers. Mapping provenance:
// sql/migrations/118_shared_assembly_bom_seed.sql (the seeded recipe lines)
// + sql/migrations/126_job_type_bounds.sql (the allowlist surface).
//   • hot_water has THREE fuel-type categories; the customer's fuel choice
//     selects one, so each is checked independently for a 3-tier spread.
//   • blocked_drain is labour/service-dominated — it has NO stocked product
//     category (only 'sundries' consumables), so a product tier-spread does
//     NOT apply. It is listed as N/A, never flagged as a gap.
const ALLOWLIST_TIER_CATEGORIES = [
  { trade: 'electrical', jobType: 'downlights', category: 'downlight' },
  { trade: 'electrical', jobType: 'power_points', category: 'gpo' },
  { trade: 'electrical', jobType: 'ceiling_fans', category: 'ceiling_fan' },
  { trade: 'plumbing', jobType: 'hot_water', category: 'hws_electric' },
  { trade: 'plumbing', jobType: 'hot_water', category: 'hws_gas' },
  { trade: 'plumbing', jobType: 'hot_water', category: 'hws_heat_pump' },
  // blocked_drain: labour-dominated, no product tier — see note above.
  { trade: 'plumbing', jobType: 'blocked_drain', category: null },
]

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
await client.connect()

let failed = false

console.log('═'.repeat(72))
console.log('CATALOGUE INTEGRITY AUDIT (R11, read-only)')
console.log('═'.repeat(72))

// ── 1. singular 'sundry' in shared_assembly_bom.material_category ────────
const { rows: sundryRows } = await client.query(`
  select b.id, b.trade, b.material_category, b.description, a.name as assembly_name
    from shared_assembly_bom b
    left join shared_assemblies a on a.id = b.assembly_id
   where lower(b.material_category) = 'sundry'
   order by b.trade, a.name`)
console.log(`\n[1] shared_assembly_bom rows on singular 'sundry': ${sundryRows.length}`)
for (const r of sundryRows) {
  console.log(`    [${r.trade}] "${r.assembly_name ?? '(unknown assembly)'}" — ${r.material_category} / ${r.description ?? ''}`)
}
if (sundryRows.length > 0) {
  console.log("    -> FAIL: normalise to 'sundries' (migration 130). The convention is broken.")
  failed = true
} else {
  console.log("    -> OK: 0 'sundry' rows (convention holds).")
}

// ── 2. brand=NULL shared_materials rows (flagged for owner) ──────────────
const { rows: nullBrand } = await client.query(`
  select trade, name, category, default_unit_price_ex_gst
    from shared_materials
   where brand is null or brand = ''
   order by trade, category, name`)
console.log(`\n[2] shared_materials rows with NULL/empty brand (FLAGGED — owner input): ${nullBrand.length}`)
for (const r of nullBrand) {
  console.log(`    [${r.trade}] ${r.category ?? '(no category)'} / "${r.name}"  $${r.default_unit_price_ex_gst}`)
}
if (nullBrand.length > 0) {
  console.log('    -> FLAG (not fail): assign a verified AU brand by hand; never fabricate one.')
} else {
  console.log('    -> OK: every shared_materials row has a brand.')
}

// ── 3. duplicate (trade, lower(category), lower(name)) groups ────────────
const { rows: dups } = await client.query(`
  select trade, lower(category) as category, lower(name) as name, count(*) as dupes
    from shared_materials
   group by trade, lower(category), lower(name)
  having count(*) > 1
   order by dupes desc, trade, category, name`)
console.log(`\n[3] duplicate (trade, category, name) groups: ${dups.length}`)
for (const d of dups) {
  console.log(`    [${d.trade}] ${d.category} / "${d.name}": ${d.dupes} rows`)
}
if (dups.length > 0) {
  console.log('    -> FAIL: the migration-130 unique index cannot be created until these are de-duped.')
  console.log('       FLAGGED for owner de-dup (decide which row survives) — never auto-deleted here.')
  failed = true
} else {
  console.log('    -> OK: no duplicate products.')
}

// ── 4. allowlisted job types missing a complete 3-tier product spread ────
console.log('\n[4] allowlisted job-type Good/Better/Best product-spread completeness:')
const { rows: catCounts } = await client.query(`
  select trade, lower(category) as category, count(distinct lower(name)) as distinct_products
    from shared_materials
   where category is not null
   group by trade, lower(category)`)
const countFor = (trade, category) =>
  catCounts.find((c) => c.trade === trade && c.category === String(category).toLowerCase())?.distinct_products ?? 0

let spreadGaps = 0
for (const a of ALLOWLIST_TIER_CATEGORIES) {
  if (a.category === null) {
    console.log(`    [${a.trade}] ${a.jobType.padEnd(14)} -> N/A (labour-dominated, no product tier)`)
    continue
  }
  const n = Number(countFor(a.trade, a.category))
  const ok = n >= 3
  if (!ok) spreadGaps++
  console.log(
    `    [${a.trade}] ${a.jobType.padEnd(14)} ${a.category.padEnd(14)} ${String(n).padStart(2)} distinct products  ${ok ? '✓ complete' : '✗ INCOMPLETE (needs >= 3)'}`,
  )
}
if (spreadGaps > 0) {
  console.log(`    -> FLAG (not fail): ${spreadGaps} category(ies) lack a 3-tier spread.`)
  console.log('       Adding a real 3rd product needs a verified AU SKU/price (owner/calibration work).')
} else {
  console.log('    -> OK: every allowlisted product category has a >= 3-tier spread.')
}

// ── summary / exit ──────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(72))
console.log(
  `SUMMARY  sundry=${sundryRows.length}  nullBrand=${nullBrand.length}  dupGroups=${dups.length}  spreadGaps=${spreadGaps}`,
)
console.log(
  failed
    ? 'RESULT: FAIL — structural bug present (sundry rows and/or duplicate products). Fix before calibration / before applying migration 130.'
    : 'RESULT: PASS — no blocking structural bug. (Brand NULLs / tier-spread gaps, if any, are flagged for owner input.)',
)
console.log('─'.repeat(72))

await client.end()
process.exit(failed ? 1 : 0)
