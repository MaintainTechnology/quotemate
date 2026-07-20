// QuoteMate · run migration 177 (public tenant-videos storage bucket)
// Usage: node --env-file=.env.local scripts/run-migration-177.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '177_tenant_videos_bucket.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log('─── executing migration 177 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const { rows } = await c.query(
    `select id, public, file_size_limit, allowed_mime_types
       from storage.buckets where id = 'tenant-videos'`,
  )
  if (!rows.length || !rows[0].public) {
    console.error('\nABORTING: expected a public tenant-videos bucket after migration.')
    process.exit(2)
  }
  console.log(`  after · tenant-videos public=${rows[0].public} cap=${rows[0].file_size_limit}B mimes=${rows[0].allowed_mime_types}`)
  console.log('\nMigration 177 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
