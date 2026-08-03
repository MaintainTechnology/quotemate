import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false} })
await c.connect()
const t = await c.query(`select column_name, data_type, udt_name from information_schema.columns
  where table_name='quotes' and column_name in ('risk_flags','grounding_result')`)
console.log('col types:', t.rows)

const expr = t.rows.find(r=>r.column_name==='risk_flags').data_type === 'jsonb'
  ? `(select count(*) from jsonb_array_elements_text(coalesce(risk_flags,'[]'::jsonb)) f where f like '[grounding]%')`
  : `(select count(*) from unnest(coalesce(risk_flags,'{}'::text[])) f where f like '[grounding]%')`

console.log('\n=== B: downgraded quotes — grounding flags present? ===')
const b = await c.query(`
  select id, created_at, ${expr} as gflags, grounding_result
  from quotes where grounding_result->>'downgraded'='true'
  order by created_at desc limit 40`)
console.table(b.rows.map(r=>({id:r.id.slice(0,8),at:String(r.created_at).slice(0,19),gflags:Number(r.gflags)})))
console.log('total downgraded rows scanned:', b.rows.length,
            '| with ZERO grounding flags:', b.rows.filter(r=>Number(r.gflags)===0).length)

console.log('\n=== C: full-table gap count ===')
const cq = await c.query(`select
  count(*) filter (where grounding_result->>'downgraded'='true') as downgraded,
  count(*) filter (where grounding_result->>'downgraded'='true' and ${expr}=0) as downgraded_no_flag
  from quotes`)
console.log(cq.rows[0])

console.log('\n=== D: intakes 07-23..07-30 with zero quote rows — is the failing line still recoverable from traces? ===')
const d = await c.query(`
  select i.id, i.created_at, i.trade,
         (select count(*) from quotes q where q.intake_id=i.id) as quote_rows,
         (select count(*) from pipeline_traces p where p.intake_id=i.id and p.outputs->>'failure_count' is not null) as gtraces
  from intakes i
  where i.created_at >= '2026-07-23' and i.created_at < '2026-07-31'
  order by i.created_at desc limit 40`)
console.table(d.rows.map(r=>({id:r.id.slice(0,8),at:String(r.created_at).slice(0,19),trade:r.trade,quotes:Number(r.quote_rows),groundingTraces:Number(r.gtraces)})))
await c.end()
