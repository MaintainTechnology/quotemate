// Compare the persisted state of two roofing measurement tokens — the
// columns that drive what /q/roof/[token] renders (picker vs priced view).
// Usage: node --env-file=.env.local scripts/diag-roof-token-compare.mjs <tokenA> <tokenB>

import pg from 'pg'

const tokens = process.argv.slice(2)
if (tokens.length === 0) throw new Error('pass one or more public_token values')

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const { rows } = await c.query(
  `select m.public_token, m.tenant_id, t.business_name, m.address, m.routing,
          m.structure_count, m.confirmed_at, m.confirmed_structure,
          m.included_indices, m.pdf_path, m.created_at,
          m.quote -> 'routing' as quote_routing
     from roofing_measurements m
     left join tenants t on t.id = m.tenant_id
    where m.public_token = any($1)
    order by m.created_at asc`,
  [tokens],
)

for (const r of rows) {
  console.log('─'.repeat(72))
  console.log(`token             ${r.public_token}`)
  console.log(`tenant            ${r.business_name ?? '(none)'}  (${r.tenant_id ?? 'null'})`)
  console.log(`created_at        ${r.created_at?.toISOString?.() ?? r.created_at}`)
  console.log(`structure_count   ${r.structure_count}`)
  console.log(`routing           ${r.routing}`)
  console.log(`quote.routing     ${JSON.stringify(r.quote_routing)}`)
  console.log(`confirmed_at      ${r.confirmed_at?.toISOString?.() ?? r.confirmed_at}`)
  console.log(`confirmed_structure ${r.confirmed_structure}`)
  console.log(`included_indices  ${JSON.stringify(r.included_indices)}`)
  console.log(`pdf_path          ${r.pdf_path}`)
}
if (rows.length !== tokens.length) {
  console.log(`\n!! only ${rows.length} of ${tokens.length} tokens found`)
}

await c.end()
