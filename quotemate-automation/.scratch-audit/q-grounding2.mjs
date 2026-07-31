import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false} })
await c.connect()

console.log('=== A: pipeline_traces validate_grounding err rows (does outputs.failures exist?) ===')
const a = await c.query(`
  select id, created_at, intake_id, message,
         jsonb_pretty(outputs) as outputs
  from pipeline_traces
  where step='estimate' and outputs->>'failure_count' is not null
  order by created_at desc limit 4
`)
for (const r of a.rows) console.log(r.created_at, '|', r.message, '\n', r.outputs, '\n')

console.log('=== B: every downgraded quote — does risk_flags carry a [grounding] entry? ===')
const b = await c.query(`
  select id, created_at, tenant_id,
         grounding_result,
         (select count(*) from unnest(risk_flags) f where f like '[grounding]%') as grounding_flag_count,
         array_length(risk_flags,1) as total_flags
  from quotes
  where grounding_result->>'downgraded' = 'true'
  order by created_at desc limit 30
`)
console.table(b.rows.map(r=>({id:r.id.slice(0,8),at:String(r.created_at).slice(0,19),gr:JSON.stringify(r.grounding_result),gflags:r.grounding_flag_count,total:r.total_flags})))

console.log('=== C: quotes with downgraded=true but ZERO [grounding] flags (the gap) ===')
const cq = await c.query(`
  select count(*) as n from quotes
  where grounding_result->>'downgraded'='true'
    and (select count(*) from unnest(coalesce(risk_flags,'{}')) f where f like '[grounding]%')=0
`)
console.log(cq.rows[0])

console.log('=== D: 2026-07-29 six-line failure — trace + any quote ===')
const d = await c.query(`
  select created_at, intake_id, message, outputs->'failures' as failures
  from pipeline_traces
  where message like '%6 line(s) ungrounded%'
  order by created_at desc limit 3
`)
for (const r of d.rows) console.log(r.created_at, r.intake_id, r.message, '\n', JSON.stringify(r.failures,null,1))
await c.end()
