// Safe-by-default runner for migration 194. No DB connection without --apply.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const rollback = process.argv.includes('--rollback')
const apply = process.argv.includes('--apply')
const file = rollback ? '194_down.sql' : '194_quote_chain.sql'
const sql = readFileSync(join(here, '..', 'sql', 'migrations', file), 'utf8')

if (!apply) {
  console.log(`DRY RUN — ${file} NOT applied. Re-run with --apply after review.\n`)
  console.log(sql)
  process.exit(0)
}

const url = process.env.SUPABASE_DB_URL
if (!url) throw new Error('SUPABASE_DB_URL missing')

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
})
await client.connect()
try {
  await client.query('begin')
  await client.query(sql)
  if (rollback) {
    const remaining = await client.query(`
      select
        (select count(*)::int from information_schema.columns
          where table_schema = 'public' and table_name = 'quotes'
            and column_name in ('parent_quote_id', 'quote_kind')) as chain_columns,
        (select count(*)::int from pg_indexes
          where schemaname = 'public' and indexname = 'quotes_open_child_uniq') as open_child_index,
        (select count(*)::int from pg_constraint
          where conname = 'quotes_quote_kind_check') as kind_check
    `)
    const row = remaining.rows[0]
    if (row?.chain_columns !== 0 || row?.open_child_index !== 0 || row?.kind_check !== 0) {
      throw new Error(
        `Migration 194 rollback verification failed: ${JSON.stringify(row)} (all must be 0)`,
      )
    }
    console.log('Verified quotes chain schema removed', row)
  } else {
    const verified = await client.query(`
      select
        (select count(*)::int from information_schema.columns
          where table_schema = 'public' and table_name = 'quotes'
            and column_name in ('parent_quote_id', 'quote_kind')) as chain_columns,
        (select count(*)::int from pg_indexes
          where schemaname = 'public' and indexname = 'quotes_open_child_uniq') as open_child_index,
        (select count(*)::int from pg_constraint
          where conname = 'quotes_quote_kind_check') as kind_check,
        (select column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'quotes'
            and column_name = 'quote_kind') as kind_default
    `)
    const row = verified.rows[0]
    if (
      row?.chain_columns !== 2 ||
      row?.open_child_index !== 1 ||
      row?.kind_check !== 1 ||
      !String(row?.kind_default ?? '').includes('initial')
    ) {
      throw new Error(
        `Migration 194 verification failed: quote chain schema incomplete (got ${JSON.stringify(row)})`,
      )
    }
    console.log('Verified quotes chain schema', row)
  }
  await client.query('commit')
  console.log(`Applied and verified ${file}`)
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  await client.end()
}
