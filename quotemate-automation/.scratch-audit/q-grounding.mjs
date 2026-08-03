import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false} })
await c.connect()
const q = await c.query(`
  select id, created_at, pricing_path, needs_inspection, grounding_result,
         risk_flags, jsonb_array_length(coalesce(to_jsonb(risk_flags),'[]'::jsonb)) as rf_len
  from quotes
  where id in ('dc5abcbb-fd8f-4a03-98ae-8057b438fcb5','c5f2dd93-7fc8-40f3-8b13-5d47d9a6a6e4')
`)
for (const r of q.rows) {
  console.log('--- quote', r.id, r.created_at)
  console.log('  pricing_path=', r.pricing_path, 'needs_inspection=', r.needs_inspection)
  console.log('  grounding_result=', JSON.stringify(r.grounding_result))
  console.log('  risk_flags=', JSON.stringify(r.risk_flags))
}
await c.end()
