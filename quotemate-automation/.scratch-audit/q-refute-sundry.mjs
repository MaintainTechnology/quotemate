import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const t = await c.query(`
  select substep, status, message, outputs, decisions, created_at
  from pipeline_traces
  where intake_id = '4f2865ac-5ceb-4a97-8e65-d1b756edf9e8'
  order by created_at
`)
for (const row of t.rows) {
  console.log('==', row.created_at.toISOString(), row.substep, row.status, '|', row.message)
  if (row.outputs) console.log('   outputs:', JSON.stringify(row.outputs).slice(0, 1400))
  if (row.decisions) console.log('   decisions:', JSON.stringify(row.decisions).slice(0, 600))
}
await c.end()
