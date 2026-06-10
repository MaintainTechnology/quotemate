// QuoteMate · run the DB→KB sync once from the CLI (backfill / reconcile).
// Loops until no dirty tables remain (each pass is bounded by maxTables).
// Run: node --env-file=.env.local --import tsx scripts/kb-sync-once.mts
//   --all   first mark every table dirty (full re-sync)

import pg from 'pg'
import { loadKbConfigFromEnv } from '../lib/admin-loader/mt-filestore-kb'
import { syncDirtyTables } from '../lib/kb-sync/sync'

const dbUrl = process.env.SUPABASE_DB_URL
const storeId = process.env.KB_PRICING_STORE_ID
if (!dbUrl || !storeId) {
  console.error('Missing SUPABASE_DB_URL or KB_PRICING_STORE_ID in .env.local')
  process.exit(1)
}
const kb = loadKbConfigFromEnv()
const maxTables = Number(process.env.KB_SYNC_MAX_TABLES_PER_RUN ?? '8') || 8
const markAll = process.argv.includes('--all')

const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
try {
  await c.connect()
  if (markAll) {
    await c.query('update kb_sync_state set dirty = true, bumped_at = now()')
    console.log('Marked all tables dirty.')
  }
  let pass = 0
  for (;;) {
    pass++
    const s = await syncDirtyTables({ db: c, kb, storeId, maxTables })
    console.log(`pass ${pass}:`, s)
    if (s.attempted === 0) break
    if (s.uploaded === 0 && s.failed === s.attempted) {
      console.error('All remaining tables are failing — stopping to avoid a loop.')
      break
    }
  }
  console.log('Backfill complete.')
} catch (err) {
  console.error('kb-sync-once failed:', (err as Error).message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
