// Grandfather the founding/pilot cohort before billing enforcement goes
// live: mark every EXISTING tenant billing_exempt = true. Tenants created
// AFTER this runs are not exempt (tenants.billing_exempt defaults false), so
// enforcement (BILLING_ENFORCEMENT_ENABLED) applies only to new signups.
//
// Idempotent — re-running only touches rows not already exempt.
//   node --env-file=.env.local scripts/exempt-existing-tenants.mjs          (apply)
//   node --env-file=.env.local scripts/exempt-existing-tenants.mjs --list   (dry run)

import pg from 'pg'

const { Client } = pg
const listOnly = process.argv.includes('--list')

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error('SUPABASE_DB_URL not set')
  process.exit(1)
}

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const { rows: before } = await client.query(
    `select id, business_name, status, subscription_status, billing_exempt, created_at
       from public.tenants
      order by created_at`,
  )
  console.log(`Tenants found: ${before.length}\n`)
  for (const t of before) {
    console.log(
      `  ${(t.business_name ?? '(no name)').padEnd(28)} status=${t.status ?? '?'} · sub=${t.subscription_status ?? 'none'} · exempt=${t.billing_exempt}`,
    )
  }

  if (listOnly) {
    console.log('\n--list: dry run, no changes made.')
  } else {
    const { rowCount } = await client.query(
      `update public.tenants set billing_exempt = true where billing_exempt is distinct from true`,
    )
    const { rows } = await client.query(
      `select count(*)::int as exempt from public.tenants where billing_exempt = true`,
    )
    console.log(`\nMarked ${rowCount} tenant(s) newly exempt.`)
    console.log(`Now exempt: ${rows[0].exempt} / ${before.length}.`)
  }
} catch (e) {
  console.error('failed:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
