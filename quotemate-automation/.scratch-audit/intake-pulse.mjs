// Is intake creation dead platform-wide, and since when?
//   node --env-file=.env.local .scratch-audit/intake-pulse.mjs
import pg from 'pg'

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const q = async (label, sql, params = []) => {
  console.log(`\n=== ${label} ===`)
  try {
    const { rows } = await c.query(sql, params)
    console.log(rows.length ? JSON.stringify(rows, null, 2) : '(none)')
  } catch (e) {
    console.log(`ERROR: ${e.message}`)
  }
}

await q('YOUR QUERY - last 3 intakes', `
  select id, trade, job_type, created_at from intakes order by created_at desc limit 3`)

await q('intakes per day, last 21 days', `
  select date_trunc('day', created_at)::date d, count(*)::int n
  from intakes where created_at > now() - interval '21 days' group by 1 order by 1 desc`)

await q('last intake per trade', `
  select distinct on (trade) trade, job_type, created_at
  from intakes order by trade, created_at desc`)

await q('quotes per day, last 21 days', `
  select date_trunc('day', created_at)::date d, count(*)::int n
  from quotes where created_at > now() - interval '21 days' group by 1 order by 1 desc`)

await q('sms_messages per day, last 7 days (is traffic still flowing?)', `
  select date_trunc('day', created_at)::date d, direction, count(*)::int n
  from sms_messages where created_at > now() - interval '7 days' group by 1,2 order by 1 desc, 2`)

await q('pipeline_traces columns', `
  select column_name, data_type from information_schema.columns
  where table_name='pipeline_traces' order by ordinal_position`)

await q('pipeline_traces, last 2 days', `
  select * from pipeline_traces where created_at > now() - interval '2 days'
  order by created_at desc limit 15`)

await c.end()
