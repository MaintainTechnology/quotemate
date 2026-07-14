// QuoteMate · run migration 171 (register the roofing trade)
// Usage: node --env-file=.env.local scripts/run-migration-171.mjs
//   (or --env-file=.env.development.local to apply to the dev DB)
//
// Fixes: "insert or update on table tenants violates foreign key constraint
// tenants_trade_fk" — the /onboard wizard offers roofing but roofing had no
// row in the `trades` registry that tenants.trade points at.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '171_register_roofing_trade.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 171_register_roofing_trade.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)

  const { rows } = await c.query(
    `select t.name,
            t.active,
            t.is_job_based,
            exists(select 1 from trade_pricing_defaults d where d.trade_id = t.id) as has_defaults
       from trades t
      where t.name = 'roofing'`,
  )
  const r = rows[0]
  const ok = r && r.active && r.is_job_based && r.has_defaults
  console.log(
    `  ${ok ? '✓' : '✗'} roofing: active=${r?.active ?? '—'} job_based=${r?.is_job_based ?? '—'} has_defaults=${r?.has_defaults ?? '—'}`,
  )
  if (!ok) process.exit(1)

  // The actual bug: prove tenants.trade = 'roofing' now satisfies
  // tenants_trade_fk. Rolled back — this must not leave a tenant behind.
  await c.query('begin')
  try {
    await c.query(
      `insert into tenants (business_name, owner_first_name, owner_email, owner_mobile,
                            trade, trades, state, status)
       values ('__fk_probe__', 'Probe', '__fk_probe__@example.invalid', '+61400000000',
               'roofing', array['roofing']::text[], 'NSW', 'onboarding')`,
    )
    console.log('  ✓ tenants_trade_fk accepts trade = roofing')
  } catch (e) {
    console.error(`  ✗ tenants insert with trade=roofing STILL fails: ${e.message}`)
    await c.query('rollback')
    process.exit(1)
  }
  await c.query('rollback')

  // Every trade the onboarding wizard can offer must be registered, or the
  // next tradie to pick it hits this same FK. Guard the whole set, not just roofing.
  const ONBOARDING_TRADES = ['electrical', 'plumbing', 'painting', 'roofing']
  const { rows: missing } = await c.query(
    `select x.name from unnest($1::text[]) as x(name)
      left join trades t on t.name = x.name and t.active
     where t.name is null`,
    [ONBOARDING_TRADES],
  )
  if (missing.length) {
    console.error(`  ✗ ONBOARDING_TRADES still unregistered: ${missing.map((m) => m.name).join(', ')}`)
    process.exit(1)
  }
  console.log(`  ✓ all ONBOARDING_TRADES registered: ${ONBOARDING_TRADES.join(', ')}`)

  console.log('\nOK — migration 171 verified (roofing onboardable).')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
