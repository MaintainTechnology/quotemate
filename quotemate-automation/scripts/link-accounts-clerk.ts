// Connect QuoteMax accounts (Supabase `tenants`) to Clerk, and record their
// subscription + admin state.
//
// For every tradie/admin account (a tenant owner):
//   1. ensure a Clerk user exists for the owner's email (create if missing),
//   2. stamp Clerk publicMetadata { plan: 'professional', is_admin },
//   3. write tenants.clerk_user_id + tenants.subscription_plan = 'professional'.
// Then normalise is_admin across ALL Clerk users so it is FALSE for every
// account except the admin_users allow-list (the DB source of truth).
//
// Requires migration 163 (tenants.clerk_user_id). Uses CLERK_SECRET_KEY +
// SUPABASE_DB_URL from the environment. Idempotent — a second run is a no-op.
//
// Run:
//   node --env-file=.env.local --import tsx scripts/link-accounts-clerk.ts --dry-run
//   node --env-file=.env.local --import tsx scripts/link-accounts-clerk.ts --apply
import pg from 'pg'
import { createClerkClient } from '@clerk/backend'
import {
  PROFESSIONAL_PLAN,
  accountPublicMetadata,
  adminEmailSet,
  deriveUsername,
  isAdminEmail,
  mergePublicMetadata,
  normalizeEmail,
} from '../lib/clerk/link'

const apply = process.argv.includes('--apply')
const dryRun = !apply
if (dryRun && !process.argv.includes('--dry-run')) {
  console.log('No --apply flag → DRY RUN (no writes). Pass --apply to commit.\n')
}

const dbUrl = process.env.SUPABASE_DB_URL
const clerkKey = process.env.CLERK_SECRET_KEY
if (!dbUrl) throw new Error('Missing SUPABASE_DB_URL')
if (!clerkKey) throw new Error('Missing CLERK_SECRET_KEY')

const clerk = createClerkClient({ secretKey: clerkKey })
const db = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

type TenantRow = {
  id: string
  business_name: string | null
  owner_user_id: string | null
  owner_email: string | null
  clerk_user_id: string | null
  subscription_plan: string | null
}

function primaryEmail(user: {
  emailAddresses: { id: string; emailAddress: string }[]
  primaryEmailAddressId: string | null
}): string {
  const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)
  return primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? ''
}

/** Find the Clerk user for an email, or create one (metadata set on create). */
async function ensureClerkUser(email: string, seed: string, metadata: Record<string, unknown>) {
  const found = await clerk.users.getUserList({ emailAddress: [email], limit: 1 })
  if (found.data.length > 0) return { user: found.data[0], created: false }
  if (dryRun) return { user: null, created: true }
  const user = await clerk.users.createUser({
    emailAddress: [email],
    username: deriveUsername(email, seed),
    skipPasswordRequirement: true,
    publicMetadata: metadata,
  })
  return { user, created: true }
}

async function main() {
  await db.connect()

  const tenantsRes = await db.query<TenantRow>(
    `select t.id, t.business_name, t.owner_user_id, u.email as owner_email,
            t.clerk_user_id, t.subscription_plan
       from public.tenants t
       left join auth.users u on u.id = t.owner_user_id
      order by t.business_name nulls last`,
  )
  const adminRes = await db.query<{ email: string | null }>(
    `select u.email
       from public.admin_users au
       left join auth.users u on u.id = au.user_id`,
  )
  const admins = adminEmailSet(adminRes.rows)
  console.log(`Designated admins (admin_users): ${[...admins].join(', ')}\n`)

  const processedClerkIds = new Set<string>()
  let created = 0
  let linked = 0

  for (const t of tenantsRes.rows) {
    const email = normalizeEmail(t.owner_email)
    const label = t.business_name ?? t.id
    if (!email) {
      console.log(`SKIP  ${label} — no owner email`)
      continue
    }
    const isAdmin = isAdminEmail(email, admins)
    const desired = accountPublicMetadata({ isAdmin })

    const { user, created: didCreate } = await ensureClerkUser(
      email,
      t.owner_user_id ?? t.id,
      desired as unknown as Record<string, unknown>,
    )
    if (didCreate) created++

    if (user) {
      const merged = mergePublicMetadata(
        user.publicMetadata as Record<string, unknown>,
        desired as unknown as Record<string, unknown>,
      )
      if (apply) {
        await clerk.users.updateUserMetadata(user.id, { publicMetadata: merged })
      }
      processedClerkIds.add(user.id)
      if (apply) {
        await db.query(
          `update public.tenants
              set clerk_user_id = $1, subscription_plan = $2
            where id = $3`,
          [user.id, PROFESSIONAL_PLAN, t.id],
        )
      }
      linked++
      console.log(
        `${apply ? 'LINK ' : 'PLAN '} ${label.padEnd(22)} email=${email.padEnd(42)} ` +
          `clerk=${user.id} plan=${PROFESSIONAL_PLAN} is_admin=${isAdmin}` +
          `${didCreate ? ' (created)' : ''}`,
      )
    } else {
      console.log(
        `WOULD ${label.padEnd(22)} email=${email.padEnd(42)} ` +
          `plan=${PROFESSIONAL_PLAN} is_admin=${isAdmin} (create Clerk user + link)`,
      )
    }
  }

  // Normalise is_admin across ALL Clerk users: false unless in admin_users.
  let normalized = 0
  let offset = 0
  const limit = 100
  for (;;) {
    const page = await clerk.users.getUserList({ limit, offset })
    for (const u of page.data) {
      if (processedClerkIds.has(u.id)) continue
      const desiredAdmin = isAdminEmail(primaryEmail(u), admins)
      const currentAdmin = (u.publicMetadata as Record<string, unknown>)?.is_admin
      if (currentAdmin === desiredAdmin) continue
      if (apply) {
        await clerk.users.updateUserMetadata(u.id, {
          publicMetadata: mergePublicMetadata(u.publicMetadata as Record<string, unknown>, {
            is_admin: desiredAdmin,
          }),
        })
      }
      normalized++
      console.log(
        `${apply ? 'ADMIN' : 'WOULD'} normalise ${primaryEmail(u).padEnd(42)} clerk=${u.id} is_admin=${desiredAdmin}`,
      )
    }
    if (page.data.length < limit) break
    offset += limit
  }

  console.log(
    `\n${apply ? 'APPLIED' : 'DRY RUN'}: linked ${linked} tradie/admin account(s) ` +
      `(${created} Clerk user(s) ${apply ? 'created' : 'to create'}), ` +
      `${normalized} other Clerk user(s) is_admin ${apply ? 'normalised' : 'to normalise'}.`,
  )
  if (dryRun) console.log('Re-run with --apply to commit.')

  await db.end()
}

main().catch((err) => {
  // Clerk API errors carry a structured `errors` array — surface it so a 422
  // ("Unprocessable Entity") tells us WHICH field/rule the instance rejected.
  const clerkErrors = (err as { errors?: { code: string; message: string; longMessage?: string; meta?: unknown }[] })
    ?.errors
  if (Array.isArray(clerkErrors)) {
    console.error('Clerk API error(s):')
    for (const e of clerkErrors) {
      console.error(`  [${e.code}] ${e.longMessage ?? e.message}${e.meta ? ' ' + JSON.stringify(e.meta) : ''}`)
    }
  }
  console.error('Failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
