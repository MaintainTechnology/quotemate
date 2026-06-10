// QuoteMate · add (or confirm) an admin for the bulk loader.
//
// admin_users (migration 050) is the allow-list /admin/loader checks. This
// looks up the auth user by email and inserts the row — run it for the
// account you sign in with.
//
// Usage: node --env-file=.env.local scripts/add-admin.mjs you@email.com

import pg from 'pg'

const email = (process.argv[2] ?? '').trim().toLowerCase()
if (!email) {
  console.error('Usage: node --env-file=.env.local scripts/add-admin.mjs <email>')
  process.exit(1)
}

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const c = new pg.Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
})

try {
  await c.connect()

  const u = await c.query(
    'select id, email from auth.users where lower(email) = $1',
    [email],
  )
  if (u.rows.length === 0) {
    console.error(
      `No QuoteMate account found for "${email}".\n` +
        'Sign up / sign in to the app with that email first, then re-run.',
    )
    process.exit(1)
  }

  const { id } = u.rows[0]
  await c.query(
    `insert into admin_users (user_id, note)
     values ($1, $2)
     on conflict (user_id) do nothing`,
    [id, `bulk-loader admin — ${email}`],
  )

  const { rows } = await c.query(
    'select count(*)::int n from admin_users where user_id = $1',
    [id],
  )
  if (rows[0].n === 1) {
    console.log(`OK — ${email} is now a loader admin.`)
    console.log('Sign in as that account, then open /admin/loader.')
  } else {
    console.error(`FAILED — ${email} was not added.`)
    process.exit(1)
  }
} catch (err) {
  console.error('Failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
