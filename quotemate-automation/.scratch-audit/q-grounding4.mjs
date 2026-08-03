import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false} })
await c.connect()
console.log('=== quote 1ca57899 (downgraded=true, no [grounding] flag) ===')
const q = await c.query(`select id, created_at, intake_id, pricing_path, grounding_result, risk_flags
  from quotes where id::text like '1ca57899%'`)
console.log(JSON.stringify(q.rows,null,1))
if (q.rows[0]) {
  const tr = await c.query(`select created_at, status, message, jsonb_pretty(decisions) as decisions
    from pipeline_traces where intake_id=$1 and step='estimate' order by created_at`, [q.rows[0].intake_id])
  for (const r of tr.rows) console.log(String(r.created_at).slice(0,24), r.status, '|', r.message, '\n', r.decisions)
}
console.log('\n=== trace ordering for intake 5225e1a0 (run 2) ===')
const o = await c.query(`select created_at, status, substep, message
  from (select created_at, status, outputs->>'substep' as substep, message, intake_id from pipeline_traces where step='estimate') s
  where intake_id::text like '5225e1a0%' order by created_at`)
console.table(o.rows.map(r=>({at:new Date(r.created_at).toISOString(), st:r.status, msg:String(r.message).slice(0,60)})))
await c.end()
