// Safe-by-default runner for migration 225. No DB connection without --apply.
//   node --env-file=.env.local scripts/run-migration-225.mjs            dry run
//   node --env-file=.env.local scripts/run-migration-225.mjs --apply    apply and verify
//   node --env-file=.env.local scripts/run-migration-225.mjs --apply --rollback
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const rollback = process.argv.includes('--rollback')
const apply = process.argv.includes('--apply')
const file = rollback ? '225_plan_pdfs_zip_down.sql' : '225_plan_pdfs_zip.sql'
const sql = readFileSync(join(here, '..', 'sql', 'migrations', file), 'utf8')

if (!apply) {
  console.log(`DRY RUN — ${file} NOT applied. Re-run with --apply after review.\n`)
  console.log(sql)
  process.exit(0)
}

const url = process.env.SUPABASE_DB_URL
if (!url) throw new Error('SUPABASE_DB_URL missing')

// The bucket's allowlist, read back inside the same transaction.
const STATE_SQL = "select allowed_mime_types as types from storage.buckets where id = 'plan-pdfs'"
// The types the bucket held before 225, which neither direction may drop.
const KEPT = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
})
await client.connect()
try {
  await client.query('begin')
  const before = (await client.query(STATE_SQL)).rows[0]?.types ?? null
  console.log('Before', before)
  await client.query(sql)
  const after = (await client.query(STATE_SQL)).rows[0]?.types ?? null
  const zip = after?.includes('application/zip') ?? false
  const missing = KEPT.filter((type) => before?.includes(type) && !after?.includes(type))
  if (before === null || zip === rollback || missing.length) {
    throw new Error(`Migration 225 ${rollback ? 'rollback ' : ''}verification failed: ${JSON.stringify({ before, after, missing })}`)
  }
  console.log('Verified', after)
  await client.query('commit')
  console.log(`Applied and verified ${file}`)
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  await client.end()
}
