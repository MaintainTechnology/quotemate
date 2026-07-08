// QuoteMate · re-link tenants.clerk_user_id to the CURRENT Clerk dev user id
// (matched by owner_email). The dev Clerk instance was re-seeded, so every
// tenant points at a stale clerk_user_id → /api/tenant/me 404s → /onboard.
//
// Dry-run by default. Pass --apply to write.
//   node --env-file=.env.local scripts/relink-tenants-clerk.mjs          # preview
//   node --env-file=.env.local scripts/relink-tenants-clerk.mjs --apply  # write

import pg from 'pg'
import { createClerkClient } from '@clerk/backend'

const { Client } = pg
const APPLY = process.argv.includes('--apply')
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })

async function currentClerkIdForEmail(email) {
  const res = await clerk.users.getUserList({ emailAddress: [email] })
  const users = Array.isArray(res) ? res : res?.data ?? []
  if (users.length !== 1) return { id: null, count: users.length }
  return { id: users[0].id, count: 1 }
}

await c.connect()
try {
  const { rows } = await c.query(
    `select id, owner_email, clerk_user_id, business_name from tenants
      where owner_email is not null order by created_at desc nulls last`,
  )
  console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN'} — ${rows.length} tenant(s)\n`)

  let changed = 0
  for (const t of rows) {
    const { id: liveId, count } = await currentClerkIdForEmail(t.owner_email.toLowerCase())
    if (!liveId) {
      console.log(`  SKIP  ${t.owner_email}  (${count} Clerk users match — need exactly 1)`)
      continue
    }
    if (t.clerk_user_id === liveId) {
      console.log(`  OK    ${t.owner_email}  already linked`)
      continue
    }
    console.log(`  RELINK ${t.owner_email}  ${t.clerk_user_id ?? 'NULL'} → ${liveId}  (${t.business_name})`)
    if (APPLY) {
      await c.query(`update tenants set clerk_user_id = $1 where id = $2`, [liveId, t.id])
    }
    changed++
  }

  console.log(`\n${APPLY ? `Done. ${changed} row(s) updated.` : `${changed} row(s) WOULD change. Re-run with --apply to write.`}`)
} finally {
  await c.end()
}
