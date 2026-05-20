// QuoteMate · run migration 041 (v7 Phase 2a — supplier_catalogue table).
// Usage:  node --env-file=.env.local scripts/run-migration-041.mjs
//
// Creates the new global vendor SKU library. Money-path-adjacent (the
// grounding validator never reads it; tenant_material_catalogue rows
// linked via migration 042 still go through the existing validator
// path). Idempotent — re-runs are safe.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '041_supplier_catalogue.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

// Expected columns + types on supplier_catalogue after this migration.
const EXPECTED_COLS = [
  ['id', 'uuid'],
  ['trade', 'text'],
  ['category', 'text'],
  ['brand', 'text'],
  ['range_series', 'text'],
  ['name', 'text'],
  ['supplier_label', 'text'],
  ['default_unit', 'text'],
  ['default_unit_price_ex_gst', 'numeric'],
  ['tier_hint', 'text'],
  ['image_url', 'text'],
  ['description', 'text'],
  ['properties', 'jsonb'],
  ['supplier_revision', 'integer'],
  ['retired_at', 'timestamp with time zone'],
  ['created_at', 'timestamp with time zone'],
  ['updated_at', 'timestamp with time zone'],
]

const sql = readFileSync(sqlPath, 'utf8')
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await client.connect()
  console.log(`→ Running 041_supplier_catalogue.sql (${sql.length.toLocaleString()} chars)...`)
  await client.query(sql)
  console.log('OK migration applied')

  let bad = 0
  for (const [col, type] of EXPECTED_COLS) {
    const { rows } = await client.query(
      `select data_type from information_schema.columns
       where table_name = 'supplier_catalogue' and column_name = $1`,
      [col],
    )
    if (rows.length === 0) {
      console.error(`  ✗ MISSING COLUMN: ${col}`)
      bad++
    } else if (!String(rows[0].data_type).startsWith(type.split(' ')[0])) {
      console.error(`  ✗ ${col} type=${rows[0].data_type} expected ${type}`)
      bad++
    } else {
      console.log(`  ✓ ${col} (${rows[0].data_type})`)
    }
  }

  // The trade CHECK constraint must restrict to electrical/plumbing —
  // an unconstrained `trade` column would let typos through.
  const { rows: chk } = await client.query(
    `select pg_get_constraintdef(oid) as def
       from pg_constraint
      where conrelid = 'supplier_catalogue'::regclass
        and contype = 'c'`,
  )
  if (!chk.some((r) => /electrical/.test(r.def) && /plumbing/.test(r.def))) {
    console.error('  ✗ trade CHECK constraint missing electrical/plumbing')
    bad++
  } else {
    console.log('  ✓ trade CHECK constraint present')
  }

  const { rows: idx } = await client.query(
    `select indexname from pg_indexes where tablename = 'supplier_catalogue'`,
  )
  const idxNames = new Set(idx.map((r) => r.indexname))
  for (const want of [
    'supplier_catalogue_pkey',
    'supplier_catalogue_unique_active_name',
    'supplier_catalogue_lookup_idx',
    'supplier_catalogue_brand_idx',
  ]) {
    if (idxNames.has(want)) console.log(`  ✓ index ${want}`)
    else {
      console.error(`  ✗ MISSING index: ${want}`)
      bad++
    }
  }

  const { rows: rowCount } = await client.query('select count(*)::int as n from supplier_catalogue')
  console.log(`\nsupplier_catalogue row count: ${rowCount[0].n}`)

  if (bad > 0) {
    console.error(`\nFAIL — ${bad} problem(s).`)
    process.exit(1)
  }
  console.log('\nOK — migration 041 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await client.end()
}
