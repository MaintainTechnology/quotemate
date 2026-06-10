// QuoteMate · run migration 043 (v7 Phase 3 — tenant_tier_ladder).
// Usage:  node --env-file=.env.local scripts/run-migration-043.mjs
//
// Money-path-adjacent: chooseMaterial() in lib/estimate/catalogue.ts
// reads this table (after the Phase 3b wiring lands). Empty table = no
// change to existing behaviour; the explicit-ladder branch only fires
// when a tenant inserts a row. Re-run the parity harness +
// catalogue tests after applying.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '043_tenant_tier_ladder.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const EXPECTED_COLS = [
  ['tenant_id', 'uuid'],
  ['category', 'text'],
  ['tier', 'text'],
  ['catalogue_id', 'uuid'],
  ['created_at', 'timestamp with time zone'],
  ['updated_at', 'timestamp with time zone'],
]

const sql = readFileSync(sqlPath, 'utf8')
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await client.connect()
  console.log(`→ Running 043_tenant_tier_ladder.sql (${sql.length.toLocaleString()} chars)...`)
  await client.query(sql)
  console.log('OK migration applied')

  let bad = 0
  for (const [col, type] of EXPECTED_COLS) {
    const { rows } = await client.query(
      `select data_type from information_schema.columns
         where table_name = 'tenant_tier_ladder' and column_name = $1`,
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

  // tier CHECK must restrict to good/better/best.
  const { rows: chk } = await client.query(
    `select pg_get_constraintdef(oid) as def
       from pg_constraint
      where conrelid = 'tenant_tier_ladder'::regclass and contype = 'c'`,
  )
  if (!chk.some((r) => /good/.test(r.def) && /better/.test(r.def) && /best/.test(r.def))) {
    console.error('  ✗ tier CHECK constraint missing good/better/best')
    bad++
  } else {
    console.log('  ✓ tier CHECK constraint present')
  }

  // Two FKs must exist and both be ON DELETE CASCADE — see the migration
  // comment for why (deleting a catalogue row or a tenant orphans the
  // ladder rows; we want them gone, not dangling).
  const { rows: fks } = await client.query(
    `select pg_get_constraintdef(con.oid) as def
       from pg_constraint con
       join pg_class cl on cl.oid = con.conrelid
      where cl.relname = 'tenant_tier_ladder' and con.contype = 'f'`,
  )
  const cascadeCount = fks.filter((r) => /on delete cascade/i.test(r.def)).length
  if (cascadeCount < 2) {
    console.error(`  ✗ expected 2 ON DELETE CASCADE FKs, found ${cascadeCount}`)
    bad++
  } else {
    console.log(`  ✓ ${cascadeCount} ON DELETE CASCADE FKs`)
  }

  // PK + the two lookup indexes.
  const { rows: idx } = await client.query(
    `select indexname from pg_indexes where tablename = 'tenant_tier_ladder'`,
  )
  const idxNames = new Set(idx.map((r) => r.indexname))
  for (const want of [
    'tenant_tier_ladder_pkey',
    'tenant_tier_ladder_lookup_idx',
    'tenant_tier_ladder_catalogue_idx',
  ]) {
    if (idxNames.has(want)) console.log(`  ✓ index ${want}`)
    else {
      console.error(`  ✗ MISSING index: ${want}`)
      bad++
    }
  }

  const { rows: rc } = await client.query('select count(*)::int as n from tenant_tier_ladder')
  console.log(`\ntenant_tier_ladder row count: ${rc[0].n}`)

  if (bad > 0) {
    console.error(`\nFAIL — ${bad} problem(s).`)
    process.exit(1)
  }
  console.log('\nOK — migration 043 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await client.end()
}
