import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false} })
await c.connect()
const ids = ['dc5abcbb-fd8f-4a03-98ae-8057b438fcb5','c5f2dd93-7fc8-40f3-8b13-5d47d9a6a6e4','6ff0534d']
const r = await c.query(`
  select id, created_at, pricing_path, needs_inspection, grounding_result, risk_flags, inspection_reason
  from quotes
  where id::text like any($1::text[])
  order by created_at
`, [ids.map(i=>i+'%')])
for (const row of r.rows) {
  console.log('=== quote', row.id, row.created_at.toISOString(), 'path=',row.pricing_path,'insp=',row.needs_inspection)
  console.log('  grounding_result:', JSON.stringify(row.grounding_result))
  console.log('  inspection_reason:', row.inspection_reason)
  console.log('  risk_flags:')
  for (const f of (row.risk_flags||[])) console.log('    -', f)
}
await c.end()
