// Verify the resolver's email fallback end-to-end against the REAL Clerk
// instance + shared DB (read-only). Replicates lib/tenant/current.ts +
// resolveClerkEmail exactly: primary lookup by clerk_user_id, then — on a miss —
// fetch email from Clerk and look the tenant up by owner_email.
//
// Simulate a LOCALHOST login (uses the sk_test key in .env.local by default):
//   node --env-file=.env.local scripts/verify-fallback.mjs user_3G9ZQR5qLqqSXpQcfYAvAkfdkC0
// Simulate a PROD login (pass the live key + a live user id):
//   PROD_CLERK_SECRET_KEY=sk_live_… node --env-file=.env.local scripts/verify-fallback.mjs <live_user_id>

import pg from 'pg'
import { createClerkClient } from '@clerk/backend'

const { Client } = pg
const clerkUserId = process.argv[2]
if (!clerkUserId) { console.error('Usage: … verify-fallback.mjs <clerk_user_id>'); process.exit(1) }

const secretKey = process.env.PROD_CLERK_SECRET_KEY || process.env.CLERK_SECRET_KEY
console.log(`Clerk instance: ${secretKey?.startsWith('sk_live') ? 'LIVE (prod)' : 'TEST (localhost)'}`)
console.log(`Simulating /api/tenant/me for clerk_user_id=${clerkUserId}\n`)

const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
try {
  // 1. Primary lookup (exactly what tenantFromRequest does first)
  const primary = await c.query(`select id, business_name, clerk_user_id from tenants where clerk_user_id = $1`, [clerkUserId])
  if (primary.rowCount > 0) {
    console.log(`STEP 1  primary lookup by clerk_user_id → HIT: ${primary.rows[0].business_name}`)
    console.log(`\n✅ Resolver returns the tenant on the primary path. Dashboard loads. (fallback not needed)`)
    process.exit(0)
  }
  console.log('STEP 1  primary lookup by clerk_user_id → MISS')

  // 2. resolveClerkEmail: fetch the caller's email from Clerk
  const user = await createClerkClient({ secretKey }).users.getUser(clerkUserId)
  const email = (user.primaryEmailAddress?.emailAddress ?? user.emailAddresses?.[0]?.emailAddress ?? '').toLowerCase()
  console.log(`STEP 2  resolveClerkEmail → ${email || '(none)'}`)

  // 3. Fallback lookup by owner_email (read-only)
  const byEmail = await c.query(`select id, business_name, clerk_user_id from tenants where lower(owner_email) = $1`, [email])
  if (byEmail.rowCount > 0) {
    const t = byEmail.rows[0]
    console.log(`STEP 3  fallback lookup by owner_email → HIT: ${t.business_name}`)
    console.log(`        (stored clerk_user_id stays ${t.clerk_user_id} — NOT overwritten)`)
    console.log(`\n✅ Resolver returns the tenant via the email fallback. Dashboard loads — no /onboard bounce.`)
  } else {
    console.log(`STEP 3  fallback lookup by owner_email → MISS`)
    console.log(`\n⚠ No tenant for that email → still 404 → /onboard (genuinely not onboarded).`)
  }
} finally {
  await c.end()
}
