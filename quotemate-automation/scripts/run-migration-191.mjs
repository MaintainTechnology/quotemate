// Safe-by-default runner for migration 191. No DB connection without --apply.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const rollback = process.argv.includes('--rollback')
const apply = process.argv.includes('--apply')
const file = rollback ? '191_push_tokens_down.sql' : '191_push_tokens.sql'
const sql = readFileSync(join(here, '..', 'sql', 'migrations', file), 'utf8')

if (!apply) {
  console.log(`DRY RUN — ${file} NOT applied. Re-run with --apply after review.\n`)
  console.log(sql)
  process.exit(0)
}

const url = process.env.SUPABASE_DB_URL
if (!url) throw new Error('SUPABASE_DB_URL missing')
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query(sql)
  console.log(`Applied ${file}`)
} finally {
  await client.end()
}
