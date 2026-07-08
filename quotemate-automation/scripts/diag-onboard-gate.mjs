// QuoteMate · diagnose the /onboard bounce for a given login email.
// READ-ONLY — no writes. Checks the Clerk (dev) user + the Supabase tenants
// row and explains exactly why the dashboard is redirecting to /onboard.
//
// Usage: node --env-file=.env.local scripts/diag-onboard-gate.mjs you@email.com

import pg from 'pg'
import { createClerkClient } from '@clerk/backend'

const { Client } = pg

const email = (process.argv[2] || '').trim().toLowerCase()
const LIST = email === '--list' || !email

// Prefer PROD_CLERK_SECRET_KEY so the live instance can be checked without
// --env-file=.env.local overriding it with the sk_test dev key.
const SECRET = process.env.PROD_CLERK_SECRET_KEY || process.env.CLERK_SECRET_KEY
const mask = (s) => (s ? `${String(s).slice(0, 8)}…(${String(s).length} chars)` : '(unset)')
console.log(`\n═══ Onboard-gate diagnostic ${LIST ? '(SURVEY MODE)' : `for: ${email}`} ═══`)
console.log(`CLERK_SECRET_KEY: ${mask(SECRET)}  (dev key starts sk_test_)`)

// ─── SURVEY MODE: dump every Clerk dev user + every tenant so we can spot
//     the "pro" account and whether it is linked. ────────────────────────
if (LIST) {
  try {
    const clerk = createClerkClient({ secretKey: SECRET })
    const res = await clerk.users.getUserList({ limit: 100 })
    const users = Array.isArray(res) ? res : res?.data ?? []
    console.log(`\n[Clerk] ${users.length} dev user(s):`)
    for (const u of users) {
      const sub = u.publicMetadata?.subscription ?? null
      console.log(
        `  • ${u.primaryEmailAddress?.emailAddress ?? '(no email)'}  id=${u.id}  plan=${sub?.plan ?? '-'}/${sub?.status ?? '-'}`,
      )
    }
  } catch (e) {
    console.log(`\n[Clerk] list failed: ${e.message}`)
  }
  const dbUrl0 = process.env.SUPABASE_DB_URL
  if (dbUrl0) {
    const cc = new Client({ connectionString: dbUrl0, ssl: { rejectUnauthorized: false } })
    try {
      await cc.connect()
      const t = await cc.query(
        `select owner_email, status, clerk_user_id, owner_user_id, business_name
           from tenants order by created_at desc nulls last limit 100`,
      )
      console.log(`\n[DB] ${t.rowCount} tenant(s):`)
      for (const r of t.rows) {
        console.log(
          `  • ${r.owner_email ?? '(no email)'}  status=${r.status}  clerk=${r.clerk_user_id ?? 'NULL'}  supa=${r.owner_user_id ?? 'NULL'}  (${r.business_name})`,
        )
      }
    } catch (e) {
      console.log(`\n[DB] list failed: ${e.message}`)
    } finally {
      await cc.end()
    }
  }
  console.log('\n→ Re-run with the pro account email to get its exact verdict:')
  console.log('  node --env-file=.env.local scripts/diag-onboard-gate.mjs <that-email>')
  process.exit(0)
}

// ─── 1. Clerk (development instance) ────────────────────────────────
let clerkUser = null
try {
  const clerk = createClerkClient({ secretKey: SECRET })
  const res = await clerk.users.getUserList({ emailAddress: [email] })
  const users = Array.isArray(res) ? res : res?.data ?? []
  if (!users.length) {
    console.log('\n[Clerk] NO user found with that email on the dev instance.')
  } else {
    clerkUser = users[0]
    const pub = clerkUser.publicMetadata ?? {}
    const sub = pub.subscription ?? null
    console.log('\n[Clerk] user found:')
    console.log(`  user_id:            ${clerkUser.id}`)
    console.log(`  primaryEmail:       ${clerkUser.primaryEmailAddress?.emailAddress ?? '(none)'}`)
    console.log(`  publicMetadata:     ${JSON.stringify(pub)}`)
    console.log(`  subscription.plan:  ${sub?.plan ?? '(none)'}   status: ${sub?.status ?? '(none)'}`)
    if (users.length > 1) console.log(`  ⚠ ${users.length} Clerk users share this email.`)
  }
} catch (e) {
  console.log(`\n[Clerk] lookup failed: ${e.message}`)
}

// ─── 2. Supabase tenants row ────────────────────────────────────────
const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.log('\n[DB] Missing SUPABASE_DB_URL — skipping tenant check.')
  process.exit(0)
}
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
try {
  await c.connect()

  const byEmail = await c.query(
    `select id, status, business_name, owner_email, owner_user_id, clerk_user_id,
            subscription_plan, subscription_status
       from tenants where lower(owner_email) = $1`,
    [email],
  )
  console.log(`\n[DB] tenants WHERE owner_email = '${email}': ${byEmail.rowCount} row(s)`)
  for (const r of byEmail.rows) {
    console.log(`  • id=${r.id}  status=${r.status}  business=${r.business_name}`)
    console.log(`      owner_user_id=${r.owner_user_id ?? 'NULL'}`)
    console.log(`      clerk_user_id=${r.clerk_user_id ?? 'NULL'}`)
    console.log(`      subscription_plan=${r.subscription_plan ?? 'NULL'}  status=${r.subscription_status ?? 'NULL'}`)
  }

  // What the dual-auth resolver actually does for a Clerk session:
  // SELECT ... FROM tenants WHERE clerk_user_id = <clerk user id>
  let resolverHit = null
  if (clerkUser) {
    const byClerk = await c.query(
      `select id, status from tenants where clerk_user_id = $1`,
      [clerkUser.id],
    )
    resolverHit = byClerk.rows[0] ?? null
    console.log(`\n[DB] tenants WHERE clerk_user_id = '${clerkUser.id}' (what /api/tenant/me uses): ${byClerk.rowCount} row(s)`)
  }

  // ─── 3. Verdict ───────────────────────────────────────────────────
  console.log('\n═══ VERDICT ═══')
  if (!clerkUser) {
    console.log('You have no Clerk dev user with this email. You are logging in with a different email/instance.')
  } else if (resolverHit) {
    console.log('✅ A tenant IS linked to your clerk_user_id. /api/tenant/me should return it, NOT 404.')
    console.log('   If you still land on /onboard, the bounce is elsewhere (token, or a stale build). Re-check.')
  } else if (byEmail.rowCount > 0) {
    console.log('⚠ CASE B — a tenant exists for your email but clerk_user_id is NOT linked to your Clerk user.')
    console.log('   The dual-auth resolver looks up by clerk_user_id, misses, and the email self-heal')
    console.log('   in /api/tenant/me only runs if the Clerk session token carries an `email` claim')
    console.log('   (Clerk omits it by default) → 404 → /onboard.')
    console.log(`   FIX: link the row → update tenants set clerk_user_id = '${clerkUser.id}' where id = '${byEmail.rows[0].id}';`)
  } else {
    console.log('⚠ CASE A — you have a Clerk account (and a pro subscription in metadata) but NO tenant row.')
    console.log('   Subscribing does NOT create a tenant; only completing /onboard (POST /api/onboard/activate) does.')
    console.log('   Being on "pro" is billing state; the dashboard needs a tenant row. That is why /onboard shows.')
    console.log('   FIX: finish the /onboard wizard once (it creates + links the tenant), or admin-insert the row.')
  }
} catch (e) {
  console.log(`\n[DB] query failed: ${e.message}`)
} finally {
  await c.end()
}
