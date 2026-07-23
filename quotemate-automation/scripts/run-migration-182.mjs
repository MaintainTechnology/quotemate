// QuoteMate · run migration 182 (measure_token default + backfill)
// Usage: node --env-file=.env.local scripts/run-migration-182.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '182_measure_token_default.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()

  const before = await c.query(
    `select count(*) filter (where measure_token is null)::int as null_tokens,
            count(*)::int as total
       from public.roofing_measurements`,
  )
  console.log(
    `  before · measure_token NULL on ${before.rows[0].null_tokens}/${before.rows[0].total} rows`,
  )

  console.log('─── executing migration 182 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const after = await c.query(
    `select count(*) filter (where measure_token is null)::int as null_tokens,
            count(*)::int as total,
            count(distinct measure_token)::int as distinct_tokens
       from public.roofing_measurements`,
  )
  const { null_tokens, total, distinct_tokens } = after.rows[0]
  console.log(`  after  · measure_token NULL on ${null_tokens}/${total} rows`)
  console.log(`  after  · distinct tokens: ${distinct_tokens} (must equal ${total})`)

  const def = await c.query(
    `select column_default from information_schema.columns
      where table_schema='public' and table_name='roofing_measurements'
        and column_name='measure_token'`,
  )
  console.log(`  after  · column default: ${def.rows[0]?.column_default ?? '(none)'}`)

  if (null_tokens !== 0) throw new Error(`backfill incomplete — ${null_tokens} rows still NULL`)
  if (distinct_tokens !== total) throw new Error('token collision — distinct != total')
  if (!def.rows[0]?.column_default) throw new Error('column default not set')
  console.log('  verified.')
} finally {
  await c.end()
}
