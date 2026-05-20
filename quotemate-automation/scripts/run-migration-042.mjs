// QuoteMate · run migration 042 (v7 Phase 2a — supplier_catalogue_id
// link on tenant_material_catalogue).
// Usage:  node --env-file=.env.local scripts/run-migration-042.mjs
//
// Purely additive: adds the FK column + an index. None of the
// estimator path or grounding validator reads supplier_catalogue_id,
// so this cannot regress a live quote. Apply AFTER 041 (this migration
// references supplier_catalogue(id)).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(
  here,
  '..',
  'sql',
  'migrations',
  '042_tenant_material_catalogue_supplier_link.sql',
)

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await client.connect()
  console.log(`→ Running 042_tenant_material_catalogue_supplier_link.sql (${sql.length.toLocaleString()} chars)...`)
  await client.query(sql)
  console.log('OK migration applied')

  // Verify the column exists with the right shape.
  const { rows } = await client.query(
    `select data_type, is_nullable
       from information_schema.columns
      where table_name = 'tenant_material_catalogue'
        and column_name = 'supplier_catalogue_id'`,
  )
  if (rows.length === 0) {
    console.error('  ✗ supplier_catalogue_id column missing')
    process.exit(1)
  }
  console.log(`  ✓ supplier_catalogue_id (${rows[0].data_type}, nullable=${rows[0].is_nullable})`)

  // Verify the FK constraint points at supplier_catalogue with ON DELETE SET NULL.
  const { rows: fk } = await client.query(
    `select pg_get_constraintdef(con.oid) as def
       from pg_constraint con
       join pg_class cl on cl.oid = con.conrelid
      where cl.relname = 'tenant_material_catalogue'
        and con.contype = 'f'
        and pg_get_constraintdef(con.oid) ilike '%supplier_catalogue%'`,
  )
  if (fk.length === 0) {
    console.error('  ✗ FK to supplier_catalogue missing')
    process.exit(1)
  }
  const hasSetNull = fk.some((r) => /on delete set null/i.test(r.def))
  if (!hasSetNull) {
    console.error(`  ✗ FK present but not ON DELETE SET NULL: ${fk[0].def}`)
    process.exit(1)
  }
  console.log(`  ✓ FK with ON DELETE SET NULL: ${fk[0].def}`)

  // Verify the partial index exists.
  const { rows: idx } = await client.query(
    `select indexname from pg_indexes where tablename = 'tenant_material_catalogue' and indexname = 'tenant_material_catalogue_supplier_idx'`,
  )
  if (idx.length === 0) {
    console.error('  ✗ tenant_material_catalogue_supplier_idx missing')
    process.exit(1)
  }
  console.log('  ✓ tenant_material_catalogue_supplier_idx present')

  console.log('\nOK — migration 042 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await client.end()
}
