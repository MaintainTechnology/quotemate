// Diagnostic — reproduce the user's EXACT request against the running dev
// server (:3000) with a real tenant-owner token, to capture the real 500 body.
// Usage:  node --env-file=.env.local scripts/diag-tenant-files-live.mjs
//
// Mints a session for an existing tenant owner via the admin API
// (generateLink does NOT send email) + verifyOtp, then GETs /api/tenant/files.

import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const dbUrl = process.env.SUPABASE_DB_URL
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const BASE = process.env.DIAG_BASE_URL || 'http://localhost:3000'

const admin = createClient(url, key, { auth: { persistSession: false } })

// Pick a tenant owner that has documents.
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
await client.connect()
const { rows } = await client.query(
  `select t.id, t.business_name, t.owner_user_id,
          (select count(*)::int from tenant_file_documents d where d.tenant_id = t.id) as docs
     from tenants t
    where t.owner_user_id is not null
    order by docs desc limit 1`,
)
await client.end()
const tenant = rows[0]
console.log('target tenant:', tenant.business_name, tenant.id, 'docs=', tenant.docs)

// owner email
const { data: u, error: uErr } = await admin.auth.admin.getUserById(tenant.owner_user_id)
if (uErr || !u?.user?.email) {
  console.log('could not resolve owner email:', uErr?.message)
  process.exit(1)
}
const email = u.user.email
console.log('owner email:', email)

// Generate a magic link (no email sent) and exchange the OTP for a session.
const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email,
})
if (linkErr) {
  console.log('generateLink error:', linkErr.message)
  process.exit(1)
}
const props = link.properties
console.log('generateLink props keys:', Object.keys(props))

let token = null
// Try token_hash first, then email_otp.
for (const attempt of [
  { token_hash: props.hashed_token, type: 'email' },
  { email, token: props.email_otp, type: 'email' },
  { email, token: props.email_otp, type: 'magiclink' },
]) {
  const { data: sess, error: vErr } = await admin.auth.verifyOtp(attempt)
  if (sess?.session?.access_token) {
    token = sess.session.access_token
    console.log('verifyOtp ok via', JSON.stringify(Object.keys(attempt)))
    break
  }
  console.log('verifyOtp attempt failed:', vErr?.message)
}
if (!token) {
  console.log('could not mint a token')
  process.exit(1)
}

// Hit the LIVE running server exactly like the browser does.
const res = await fetch(`${BASE}/api/tenant/files`, {
  headers: { Authorization: `Bearer ${token}` },
  cache: 'no-store',
})
const body = await res.text()
console.log(`\n=== LIVE ${BASE}/api/tenant/files ===`)
console.log('HTTP', res.status)
console.log('body:', body.slice(0, 2000))
