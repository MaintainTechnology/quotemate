// Diagnostic — why does GET /api/tenant/files return 500?
// Usage:  node --env-file=.env.local scripts/diag-tenant-files.mjs
//
// Read-only. Reproduces the route's exact PostgREST select PER TENANT (the
// route filters by the authenticated tenant_id), since the unfiltered query
// already works. Also checks auth.getUser error-vs-throw behavior.

import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const dbUrl = process.env.SUPABASE_DB_URL
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(url, key, { auth: { persistSession: false } })
const SEL = 'id, display_name, source_kind, trade, state, created_at, bytes'

// ── enumerate tenants (from the tenants table, not just doc owners) ──
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
await client.connect()
const tenants = await client.query(
  `select t.id, t.business_name, t.owner_user_id,
          (select count(*)::int from tenant_file_documents d where d.tenant_id = t.id) as docs
     from tenants t order by docs desc`,
)
await client.end()
console.log(`tenants: ${tenants.rows.length}`)

// ── run the EXACT route query for each tenant id ────────────────────
for (const t of tenants.rows) {
  const { data, error } = await supabase
    .from('tenant_file_documents')
    .select(SEL)
    .eq('tenant_id', t.id)
    .order('created_at', { ascending: false })
  const tag = `${t.business_name ?? '(no name)'} [${t.id}] docs=${t.docs} owner=${t.owner_user_id ? 'set' : 'NULL'}`
  if (error) console.log(`  ✗ ${tag}  ERROR: ${JSON.stringify(error)}`)
  else console.log(`  ✓ ${tag}  rows=${data.length}`)
}

// ── does auth.getUser throw or return error on a bad token? ─────────
try {
  const r = await supabase.auth.getUser('not-a-real-jwt')
  console.log('\nauth.getUser(bad): returned error =', r.error ? JSON.stringify(r.error.message ?? r.error) : 'none', '| user =', r.data?.user ? 'set' : 'null')
} catch (e) {
  console.log('\nauth.getUser(bad): THREW ->', e instanceof Error ? e.message : String(e))
}
