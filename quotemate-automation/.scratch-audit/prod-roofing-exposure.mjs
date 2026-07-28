// Real production exposure of the AI receptionist since it went default-on.
//   node --env-file=.env.local .scratch-audit/prod-roofing-exposure.mjs
//
// The synthetic parity/variance runs measure the model. This measures what
// has actually happened to real customers.

import pg from 'pg'

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await client.connect()

const q = async (label, sql, params = []) => {
  const { rows } = await client.query(sql, params)
  console.log(`\n── ${label}`)
  if (!rows.length) console.log('   (no rows)')
  for (const r of rows) console.log('   ' + JSON.stringify(r))
}

// 08a2220b (LLM default on) was pushed 2026-07-26.
const SINCE = '2026-07-26'

await q('conversation_type values in play', `select conversation_type, count(*) n from sms_conversations group by 1 order by 2 desc`)

await q(
  'roofing measurements since the AI went default-on — who and what',
  `select id, tenant_id is null as orphan, customer_phone, structure_count, routing,
          (quote is not null) as priced, created_at
     from roofing_measurements
    where created_at >= $1
    order by created_at`,
  [SINCE],
)

await q(
  'distinct phones that texted roofing in the last 3 days',
  `select m.from_number, count(*) inbound, min(m.created_at) first_seen
     from sms_messages m
    where m.direction = 'inbound' and m.created_at >= now() - interval '3 days'
    group by 1 order by 2 desc limit 15`,
)

await client.end()
