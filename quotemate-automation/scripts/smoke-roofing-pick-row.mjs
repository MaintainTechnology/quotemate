// Smoke helper: pick a real multi-structure roofing_measurements row so the
// live /m + PATCH + PDF smoke test can exercise selection narrowing on real
// data. Read-only. Usage:
//   node --env-file=.env.local scripts/smoke-roofing-pick-row.mjs
import pg from 'pg'

const { Client } = pg
const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
try {
  await c.connect()
  // Prefer a multi-structure, non-inspection row so toggling actually changes
  // the priced total; fall back to any row with a measure_token.
  const { rows } = await c.query(`
    select measure_token, public_token, included_indices,
           structure_count,
           coalesce(jsonb_array_length(quote->'structures'), 0) as quote_structures,
           coalesce(routing,'') as routing
      from public.roofing_measurements
     where measure_token is not null
       and quote is not null
       and coalesce(jsonb_array_length(quote->'structures'), 0) >= 2
     order by (routing is distinct from 'inspection_required') desc, created_at desc
     limit 3
  `)
  if (rows.length === 0) {
    console.log(JSON.stringify({ ok: true, found: false, note: 'no multi-structure rows' }))
  } else {
    console.log(JSON.stringify({ ok: true, found: true, rows }, null, 2))
  }
} catch (err) {
  console.error('pick-row failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
