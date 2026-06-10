// Dump intake.scope.specs for an intake id fragment.
// Usage: node --env-file=.env.local scripts/dump-intake-specs.mjs 0cdc2905
import pg from 'pg'
const frag = (process.argv[2] || '').toLowerCase()
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const { rows } = await c.query(
  `select id, trade, job_type, scope from intakes where id::text like $1 order by created_at desc limit 1`,
  [`${frag}%`],
)
if (!rows.length) { console.log('no intake'); await c.end(); process.exit(0) }
const r = rows[0]
console.log('intake', r.id, '| trade:', r.trade, '| job_type:', r.job_type)
console.log('scope.specs:', JSON.stringify(r.scope?.specs ?? null, null, 2))
console.log('scope.chosen_product:', JSON.stringify(r.scope?.chosen_product ?? null, null, 2))
await c.end()
