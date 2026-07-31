// Follow-up: did the recent intakes fail to become quotes, or were they inspection-routed?
//   node --env-file=.env.local .scratch-audit/intake-pulse2.mjs
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

await q('intakes columns', `
  select column_name from information_schema.columns
  where table_name='intakes' order by ordinal_position`)

// Every intake since quotes stopped: did it produce a quote?
await q('intakes since 2026-07-20 -> did a quote follow?', `
  select i.id, i.trade, i.job_type, i.inspection_required, i.created_at,
         (select count(*)::int from quotes qq where qq.intake_id = i.id) quotes
  from intakes i where i.created_at > '2026-07-20' order by i.created_at desc`)

// Non-ok traces: what is actually failing?
await q('NON-OK pipeline_traces, last 3 days', `
  select created_at, step, substep, status, left(coalesce(message,''),300) message
  from pipeline_traces
  where created_at > now() - interval '3 days' and status <> 'ok'
  order by created_at desc limit 40`)

// Trace step histogram today: how far does a turn actually get?
await q('trace steps today, by status', `
  select step, status, count(*)::int n
  from pipeline_traces where created_at > now() - interval '1 day'
  group by 1,2 order by 1,2`)

// The plumbing run specifically.
await q('plumbing run traces (conversation with the HWS thread)', `
  select t.created_at, t.step, t.substep, t.status, left(coalesce(t.message,''),300) message,
         t.decisions
  from pipeline_traces t
  where t.created_at > now() - interval '1 day'
    and t.sms_conversation_id in (
      select distinct m.conversation_id from sms_messages m
      where m.created_at > now() - interval '1 day' and m.body ilike '%hot water%')
  order by t.created_at asc limit 40`)

await c.end()
