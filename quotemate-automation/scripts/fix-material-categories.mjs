// Phase 2 R8 — repoint tenant rows whose category names no real material.
//
// Dry-run by default. Nothing is written without --apply.
//   node --env-file=.env.local scripts/fix-material-categories.mjs
//   node --env-file=.env.local scripts/fix-material-categories.mjs --apply
//
// Touches two columns:
//   tenant_material_catalogue.category
//   tenant_assembly_bom.material_category
//
// Deliberately NOT run as part of the build. Renaming a tradie's product
// category changes which jobs it prices, so it is a reviewable step of its own.
//
// ── Three outcomes, and why the third is not a failure ──────────────────
// SAFE      an unambiguous one-to-one rename (fan → ceiling_fan)
// AMBIGUOUS the old value maps to several real ones. `tap` could be any of four
//           tapware_* values; `hot_water` any of three hws_*. Guessing would put
//           a kitchen mixer price on a basin job. Reported for a human.
// ORPHAN    no shared_materials row exists at all (oven_cooktop,
//           security_camera, cctv). These need a material seeded first — a
//           rename cannot help.
//
// Idempotent: re-running after --apply finds nothing to do, because every row it
// touched now holds a real value.

import pg from 'pg'
import { MATERIAL_VOCABULARY } from '../lib/estimate/material-vocabulary.ts'

const APPLY = process.argv.includes('--apply')

/** Unambiguous renames only. Key is `trade·oldValue`. */
const SAFE = {
  'electrical·fan': 'ceiling_fan',
  'electrical·rcbo': 'safety_switch',
  'electrical·sundry': 'sundries',
  'plumbing·sundry': 'sundries',
}

/** Old value → the candidates it could mean. A human picks per row. */
const AMBIGUOUS = {
  'plumbing·tap': ['tapware_basin', 'tapware_kitchen', 'tapware_laundry', 'tapware_outdoor'],
  'plumbing·hot_water': ['hws_electric', 'hws_gas', 'hws_heat_pump'],
  'plumbing·toilet_repair': ['toilet', 'toilet_repair'],
}

const real = new Set(
  Object.entries(MATERIAL_VOCABULARY).flatMap(([t, opts]) => opts.map((o) => `${t}·${o.value}`)),
)

const TARGETS = [
  { table: 'tenant_material_catalogue', col: 'category', label: 'catalogue products' },
  { table: 'tenant_assembly_bom', col: 'material_category', label: 'recipe lines' },
]

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('SUPABASE_DB_URL missing — run with: node --env-file=.env.local scripts/...')
  process.exit(1)
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
await client.connect()

let safeTotal = 0
const ambiguousFound = []
const orphansFound = []

try {
  for (const { table, col, label } of TARGETS) {
    const { rows } = await client.query(
      `select id, tenant_id, trade, ${col} as cat from ${table}
        where trade in ('electrical','plumbing') and ${col} is not null
        order by trade, ${col}`,
    )
    const bad = rows.filter((r) => !real.has(`${r.trade}·${String(r.cat).trim().toLowerCase()}`))

    console.log(`\n── ${label} (${table}.${col}) ─────────────────────────`)
    console.log(`   ${rows.length} rows, ${bad.length} naming no real material`)
    if (bad.length === 0) continue

    // Group so the report reads per distinct value, not per row.
    const byValue = new Map()
    for (const r of bad) {
      const key = `${r.trade}·${String(r.cat).trim().toLowerCase()}`
      if (!byValue.has(key)) byValue.set(key, [])
      byValue.get(key).push(r)
    }

    for (const [key, group] of [...byValue.entries()].sort()) {
      const [trade, oldVal] = key.split('·')
      const target = SAFE[key]
      if (target) {
        console.log(`   SAFE      ${trade}·${oldVal} → ${target}  (${group.length} row${group.length === 1 ? '' : 's'})`)
        safeTotal += group.length
        if (APPLY) {
          const { rowCount } = await client.query(
            `update ${table} set ${col} = $1 where id = any($2::uuid[])`,
            [target, group.map((r) => r.id)],
          )
          console.log(`             applied to ${rowCount} row${rowCount === 1 ? '' : 's'}`)
        }
        continue
      }
      if (AMBIGUOUS[key]) {
        console.log(`   AMBIGUOUS ${trade}·${oldVal} → one of ${AMBIGUOUS[key].join(' | ')}  (${group.length} row${group.length === 1 ? '' : 's'}) — NOT changed`)
        ambiguousFound.push({ table, key, rows: group.length, options: AMBIGUOUS[key] })
        continue
      }
      console.log(`   ORPHAN    ${trade}·${oldVal} — no shared_materials row exists  (${group.length} row${group.length === 1 ? '' : 's'}) — NOT changed`)
      orphansFound.push({ table, key, rows: group.length })
    }
  }

  console.log('\n══ summary ════════════════════════════════════════════')
  console.log(`   safe renames:     ${safeTotal} row(s)${APPLY ? ' — APPLIED' : ' — dry run, nothing written'}`)
  console.log(`   ambiguous:        ${ambiguousFound.reduce((n, a) => n + a.rows, 0)} row(s) across ${ambiguousFound.length} value(s)`)
  console.log(`   orphans:          ${orphansFound.reduce((n, a) => n + a.rows, 0)} row(s) across ${orphansFound.length} value(s)`)

  if (ambiguousFound.length > 0) {
    console.log('\n   AMBIGUOUS need a human decision per row — the old value maps to')
    console.log('   several real ones and the wrong pick puts the wrong price on a job:')
    for (const a of ambiguousFound) console.log(`     ${a.key} (${a.table}) → ${a.options.join(' | ')}`)
  }
  if (orphansFound.length > 0) {
    console.log('\n   ORPHANS need a shared_materials row seeded before any rename can')
    console.log('   help. Until then these lines price generically:')
    for (const o of orphansFound) console.log(`     ${o.key} (${o.table})`)
  }
  if (!APPLY) console.log('\n   Re-run with --apply to write the SAFE renames only.')
} catch (err) {
  console.error('\nFAILED:', err.message ?? err)
  process.exitCode = 1
} finally {
  await client.end()
}
