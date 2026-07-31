import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false} })
await c.connect()
const r = await c.query(`
  select id, created_at,
         (select count(*) from jsonb_array_elements_text(risk_flags) f where f like '[grounding]%') as n_grounding,
         (select f from jsonb_array_elements_text(risk_flags) f where f like '[grounding]%' limit 1) as first_flag
  from quotes
  where (grounding_result->>'downgraded')::boolean is true
  order by created_at desc limit 25`)
console.log('downgraded quotes, newest 25:')
for (const x of r.rows) console.log(' ', x.created_at.toISOString(), x.id.slice(0,8), 'flags=', x.n_grounding, '|', (x.first_flag||'(none)').slice(0,130))
const t = await c.query(`
  select created_at, message from pipeline_traces
  where substep='validate_grounding' and status='err' order by created_at desc limit 12`)
console.log('\nvalidate_grounding err traces, newest 12:')
for (const x of t.rows) console.log(' ', x.created_at.toISOString(), x.message)
await c.end()
