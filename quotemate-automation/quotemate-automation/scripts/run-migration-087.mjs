// Apply migration 087 (GPO amperage backfill + cleanups) to the configured DB.
// Run: node --env-file=.env.local scripts/run-migration-087.mjs
// Idempotent: re-running re-stamps the same amperage values (jsonb merge) and
// the self-guarded dedupe is a no-op once applied.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(here, '..', 'sql', 'migrations', '087_gpo_amperage_backfill.sql'), 'utf8')

const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await c.connect()
await c.query(sql)
console.log('[087] GPO amperage backfill applied.')
await c.end()
