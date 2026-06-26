// QuoteMate · run migration 149 (register the painting trade in the registry)
// Usage: node --env-file=.env.local scripts/run-migration-149.mjs
//   (or --env-file=.env.development.local to apply to the dev DB)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '149_register_painting_trade.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log('→ Applying 149_register_painting_trade.sql ...')
  await c.query(sql)

  // Verify the registry row + pricing defaults exist (both required for
  // onboarding FKs and the dashboard activate path).
  const { rows: tradeRows } = await c.query(
    `select name, display_name, is_job_based, active from public.trades where name = 'painting'`,
  )
  const { rows: defaultRows } = await c.query(
    `select 1 from public.trade_pricing_defaults tpd
       join public.trades t on t.id = tpd.trade_id
      where t.name = 'painting'`,
  )
  const tradeOk = tradeRows.length === 1 && tradeRows[0].active === true && tradeRows[0].is_job_based === true
  const defaultsOk = defaultRows.length === 1
  console.log(`  ${tradeOk ? '✓' : '✗'} trades row for painting present + active (${tradeRows.length} found)`)
  console.log(`  ${defaultsOk ? '✓' : '✗'} trade_pricing_defaults row for painting present (${defaultRows.length} found)`)
  if (!tradeOk || !defaultsOk) process.exit(1)
  console.log('\nOK — migration 149 applied. Painting is registered; tenants.trade=painting now validates and the trade can be activated.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
