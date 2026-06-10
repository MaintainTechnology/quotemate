// QuoteMate · seed a sandbox 'carpentry' trade into the STAGING database.
//
// The admin bulk loader rejects any trade not in the `trades` table. This
// stands in for the Phase 2 "create new trade" UI step — registering the
// trade + a starter category set so the loader can be tested with a
// non-pilot trade. Idempotent (on-conflict-do-nothing).
//
// SAFETY: refuses to run against the production project. Always run with
//   --env-file=.env.staging.local
//
// Usage: node --env-file=.env.staging.local scripts/seed-staging-carpentry.mjs

import pg from 'pg'

const PROD_REF = 'bobvihqwhtcbxneelfns'

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL — run with --env-file=.env.staging.local')
  process.exit(1)
}
if (dbUrl.includes(PROD_REF)) {
  console.error(
    '\n  ✗ REFUSING TO RUN — SUPABASE_DB_URL points at PRODUCTION.\n' +
      '    This sandbox seed only runs against staging.\n',
  )
  process.exit(1)
}

// Carpentry is an install/job-based trade (§2.1) — it quotes discrete
// Good/Better/Best jobs (decking, framing, door hangs), so is_job_based=true.
const CATEGORIES = [
  'decking',
  'framing',
  'door_window',
  'flooring',
  'cabinetry',
  'general',
]

const c = new pg.Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
})

try {
  await c.connect()

  await c.query(
    `insert into trades (name, display_name, is_job_based, active)
     values ('carpentry', 'Carpentry', true, true)
     on conflict (name) do nothing`,
  )
  const { rows } = await c.query(`select id from trades where name = 'carpentry'`)
  const tradeId = rows[0].id

  for (const name of CATEGORIES) {
    await c.query(
      `insert into categories (trade_id, name, grounding_tag)
       values ($1, $2, $2)
       on conflict (trade_id, name) do nothing`,
      [tradeId, name],
    )
  }

  const { rows: catCount } = await c.query(
    `select count(*)::int n from categories where trade_id = $1`,
    [tradeId],
  )
  console.log(`OK — 'carpentry' trade seeded on staging (${catCount[0].n} categories).`)
  console.log(`Categories: ${CATEGORIES.join(', ')}`)
} catch (err) {
  console.error('Seed failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
