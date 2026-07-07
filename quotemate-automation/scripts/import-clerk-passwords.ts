// Import existing Supabase passwords into the ALREADY-LINKED Clerk users, so
// existing subscribers keep their EXACT password after the auth swap (no reset,
// no email-code first login).
//
// Context: scripts/link-accounts-clerk.ts already created a Clerk user per
// tenant owner and stamped tenants.clerk_user_id — but it created them
// passwordless (skipPasswordRequirement). This script fills in the password by
// copying auth.users.encrypted_password (a bcrypt digest) into the existing
// Clerk user via updateUser({ passwordDigest, passwordHasher: 'bcrypt' }). The
// Clerk user id is unchanged, so tenants.clerk_user_id stays valid.
//
// SAFE + REVERSIBLE + IDEMPOTENT: only writes a password onto Clerk users;
// touches no Supabase data. A second run is a no-op (skips passwordEnabled
// users unless --force). Supabase login is unaffected.
//
// Requires migration 163 (tenants.clerk_user_id) + CLERK_SECRET_KEY +
// SUPABASE_DB_URL. Dry-run unless --apply.
//
// Run:
//   node --env-file=.env.local --import tsx scripts/import-clerk-passwords.ts --dry-run
//   node --env-file=.env.local --import tsx scripts/import-clerk-passwords.ts --email you@example.com --apply
//   node --env-file=.env.local --import tsx scripts/import-clerk-passwords.ts --apply
//   node --env-file=.env.local --import tsx scripts/import-clerk-passwords.ts --apply --force
import pg from 'pg'
import { createClerkClient } from '@clerk/backend'
import { toClerkPasswordParams } from '../lib/clerk/password-import'
import { normalizeEmail } from '../lib/clerk/link'

const apply = process.argv.includes('--apply')
const force = process.argv.includes('--force')
const emailArg = (() => {
  const i = process.argv.indexOf('--email')
  const inline = process.argv.find((a) => a.startsWith('--email='))
  if (inline) return normalizeEmail(inline.split('=').slice(1).join('='))
  if (i >= 0 && process.argv[i + 1]) return normalizeEmail(process.argv[i + 1])
  return null
})()
if (!apply && !process.argv.includes('--dry-run')) {
  console.log('No --apply flag → DRY RUN (no writes). Pass --apply to commit.\n')
}

const dbUrl = process.env.SUPABASE_DB_URL
const clerkKey = process.env.CLERK_SECRET_KEY
if (!dbUrl) throw new Error('Missing SUPABASE_DB_URL')
if (!clerkKey) throw new Error('Missing CLERK_SECRET_KEY')

const clerk = createClerkClient({ secretKey: clerkKey })
const db = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

type Row = {
  id: string
  business_name: string | null
  clerk_user_id: string | null
  owner_email: string | null
  encrypted_password: string | null
}

/** Resolve the linked Clerk user, preferring the stamped id, falling back to
 *  an email match if the id has drifted (e.g. the user was recreated). */
async function resolveClerkUser(row: Row) {
  if (row.clerk_user_id) {
    try {
      return await clerk.users.getUser(row.clerk_user_id)
    } catch {
      // fall through to email lookup
    }
  }
  const email = normalizeEmail(row.owner_email)
  if (!email) return null
  const found = await clerk.users.getUserList({ emailAddress: [email], limit: 1 })
  return found.data[0] ?? null
}

async function main() {
  await db.connect()

  const params: unknown[] = []
  let where = 't.clerk_user_id is not null'
  if (emailArg) {
    params.push(emailArg)
    where += ` and lower(u.email) = $1`
  }
  const res = await db.query<Row>(
    `select t.id, t.business_name, t.clerk_user_id,
            u.email as owner_email, u.encrypted_password
       from public.tenants t
       join auth.users u on u.id = t.owner_user_id
      where ${where}
      order by t.business_name nulls last`,
    params,
  )

  if (res.rows.length === 0) {
    console.log(emailArg ? `No linked tenant found for ${emailArg}.` : 'No linked tenants found.')
    await db.end()
    return
  }

  let imported = 0
  let skipped = 0
  let failed = 0

  for (const row of res.rows) {
    const label = (row.business_name ?? row.id).padEnd(22)
    const email = normalizeEmail(row.owner_email)

    const pw = toClerkPasswordParams(row.encrypted_password)
    if (!pw.ok) {
      skipped++
      console.log(`SKIP  ${label} ${email.padEnd(42)} — ${pw.reason}`)
      continue
    }

    const user = await resolveClerkUser(row)
    if (!user) {
      failed++
      console.log(`MISS  ${label} ${email.padEnd(42)} — no Clerk user (clerk_user_id=${row.clerk_user_id})`)
      continue
    }

    if (user.passwordEnabled && !force) {
      skipped++
      console.log(`HAVE  ${label} ${email.padEnd(42)} — password already set (use --force to overwrite)`)
      continue
    }

    if (!apply) {
      console.log(`WOULD ${label} ${email.padEnd(42)} — import bcrypt password → clerk=${user.id}`)
      imported++
      continue
    }

    await clerk.users.updateUser(user.id, pw.params)
    // Confirm the digest was accepted (passwordEnabled flips true).
    const after = await clerk.users.getUser(user.id)
    if (after.passwordEnabled) {
      imported++
      console.log(`OK    ${label} ${email.padEnd(42)} — password imported → clerk=${user.id}`)
    } else {
      failed++
      console.log(`FAIL  ${label} ${email.padEnd(42)} — updateUser returned but passwordEnabled still false`)
    }
  }

  console.log(
    `\n${apply ? 'APPLIED' : 'DRY RUN'}: ${imported} ${apply ? 'imported' : 'to import'}, ` +
      `${skipped} skipped, ${failed} failed.`,
  )
  if (!apply) console.log('Re-run with --apply to commit.')
  await db.end()
}

main().catch((err) => {
  const clerkErrors = (err as { errors?: { code: string; message: string; longMessage?: string }[] })?.errors
  if (Array.isArray(clerkErrors)) {
    console.error('Clerk API error(s):')
    for (const e of clerkErrors) console.error(`  [${e.code}] ${e.longMessage ?? e.message}`)
  }
  console.error('Failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
