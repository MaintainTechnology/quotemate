// QuoteMate · run migration 136 (Files tab commenting — tenant_file_comments)
// Usage: node --env-file=.env.local scripts/run-migration-136.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '136_tenant_file_comments.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function scalar(client, q, params = []) {
  const { rows } = await client.query(q, params)
  return rows[0]?.n ?? 0
}

try {
  await c.connect()

  console.log('─── pre-flight ──')
  const beforeTbl = await scalar(
    c,
    `select count(*)::int as n from information_schema.tables where table_name='tenant_file_comments'`,
  )
  console.log(`  before · tenant_file_comments table   ${beforeTbl}`)

  console.log('\n─── executing migration 136 ──')
  await c.query(sql)
  console.log('  migration committed.')

  console.log('\n─── post-verify ──')
  const afterTbl = await scalar(
    c,
    `select count(*)::int as n from information_schema.tables where table_name='tenant_file_comments'`,
  )
  const resolvedCol = await scalar(
    c,
    `select count(*)::int as n from information_schema.columns where table_name='tenant_file_documents' and column_name='comments_resolved_at'`,
  )
  console.log(`  after  · tenant_file_comments table   ${afterTbl}`)
  console.log(`  after  · comments_resolved_at column  ${resolvedCol}`)

  if (afterTbl < 1 || resolvedCol < 1) {
    console.error('\nABORTING: expected schema not present after migration.')
    process.exit(2)
  }

  console.log('\nMigration 136 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
