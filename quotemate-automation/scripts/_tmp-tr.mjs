import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const cols = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='pipeline_traces'`)
console.log('trace cols:', cols.rows.map(r=>r.column_name).join(', '))
const r = await c.query(`SELECT * FROM pipeline_traces
  WHERE created_at > now() - interval '30 hours' ORDER BY created_at DESC LIMIT 6`)
for (const t of r.rows) {
  const s = JSON.stringify(t)
  if (/roof|measure/i.test(s)) console.log('\n---', String(t.created_at).slice(4,21), '\n', s.slice(0, 700))
}
console.log('\n== env: which roofing provider is selected? ==')
await c.end()
