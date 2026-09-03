// Safe-by-default runner for migration 195. No DB connection without --apply.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const rollback = process.argv.includes('--rollback')
const apply = process.argv.includes('--apply')
const file = rollback ? '195_down.sql' : '195_quotes_estimate_number.sql'
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
    const gone = await client.query(`
      select
        (select count(*)::int from information_schema.columns
          where table_schema = 'public' and table_name = 'quotes'
            and column_name = 'estimate_number') as col,
        (select count(*)::int from pg_class
          where relkind = 'S' and relname = 'quote_estimate_number_seq') as seq,
        (select count(*)::int from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'next_quote_estimate_number') as fn
    `)
    const row = gone.rows[0]
    if (row?.col !== 0 || row?.seq !== 0 || row?.fn !== 0) {
      throw new Error(
        `Migration 195 rollback verification failed: column=${row?.col} sequence=${row?.seq} function=${row?.fn} (all must be 0)`,
      )
    }
    console.log('Verified estimate number schema removed', row)
  } else {
    const verified = await client.query(`
      select
        (select data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'quotes'
            and column_name = 'estimate_number') as data_type,
        (select is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'quotes'
            and column_name = 'estimate_number') as is_nullable,
        (select count(*)::int from pg_class
          where relkind = 'S' and relname = 'quote_estimate_number_seq') as seq,
        (select count(*)::int from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'next_quote_estimate_number') as fn,
        -- The function is SECURITY DEFINER, so a PUBLIC execute grant would be an
        -- unauthenticated write against quotes that bypasses RLS. Assert it is shut.
        has_function_privilege('anon', 'public.next_quote_estimate_number(uuid)', 'EXECUTE') as anon_can_execute,
        has_function_privilege('authenticated', 'public.next_quote_estimate_number(uuid)', 'EXECUTE') as authenticated_can_execute,
        has_function_privilege('service_role', 'public.next_quote_estimate_number(uuid)', 'EXECUTE') as service_role_can_execute
    `)
    const row = verified.rows[0]
    if (
      row?.data_type !== 'bigint' ||
      row?.is_nullable !== 'YES' ||
      row?.seq !== 1 ||
      row?.fn !== 1
    ) {
      throw new Error(
        `Migration 195 verification failed: estimate_number must be a nullable bigint with its sequence and assignment function present (got ${JSON.stringify(row)})`,
      )
    }
    if (row.anon_can_execute || row.authenticated_can_execute) {
      throw new Error(
        `Migration 195 verification failed: next_quote_estimate_number is SECURITY DEFINER and still executable by anon/authenticated — that is an unauthenticated write against quotes (got ${JSON.stringify(row)})`,
      )
    }
    if (!row.service_role_can_execute) {
      throw new Error(
        'Migration 195 verification failed: service_role cannot execute next_quote_estimate_number — the server could not assign an estimate number',
      )
    }
    console.log('Verified estimate number schema', row)
  }
  await client.query('commit')
  console.log(`Applied and verified ${file}`)
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  await client.end()
}
