import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const r = await c.query(`
  select t.created_at, t.substep, t.status, t.message, t.intake_id,
         i.trade, i.job_type, i.scope->>'item_count' as item_count,
         i.scope->'chosen_product'->>'name' as chosen
  from pipeline_traces t
  left join intakes i on i.id = t.intake_id
  where t.substep in ('validate_grounding','min_labour_floor')
    and t.created_at > now() - interval '3 days'
  order by t.created_at desc limit 12`)
for (const x of r.rows) {
  console.log(
    x.created_at.toISOString(), '|', x.substep, x.status,
    '| intake', String(x.intake_id).slice(0, 8),
    '|', x.trade, '| job', x.job_type, '| n=', x.item_count,
    '| chosen=', x.chosen, '|', x.message,
  )
}
await c.end()
