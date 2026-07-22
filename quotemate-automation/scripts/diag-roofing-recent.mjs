// Diagnose recent SMS roofing threads across ALL numbers: which step did
// each stall at, and did a measurement ever get saved?
// Usage: node --env-file=.env.local scripts/diag-roofing-recent.mjs [limit] [--full]

import pg from 'pg'

const full = process.argv.includes('--full')
const limit = Number(process.argv[2] || 8)
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const convos = await c.query(
  `select id, from_number, status, last_message_at, roofing_state
     from sms_conversations
    where roofing_state is not null
    order by last_message_at desc nulls last
    limit $1`,
  [limit],
)

console.log(`\n=== ${convos.rows.length} most recent conversations with roofing_state ===`)
for (const r of convos.rows) {
  const st = r.roofing_state || {}
  console.log(
    `\n${String(r.last_message_at).slice(0, 24)} | ${r.from_number} | status=${r.status} | conv=${r.id}` +
      `\n  last_step=${st.last_step} token=${st.pending_quote_token || 'no'} count=${st.pending_structure_count} slots=${JSON.stringify(st.slots)}`,
  )
  const msgs = await c.query(
    `select direction, body, created_at
       from sms_messages where conversation_id = $1
      order by created_at desc limit 14`,
    [r.id],
  )
  for (const m of msgs.rows.reverse()) {
    const body = full ? m.body : String(m.body).replace(/\s+/g, ' ').slice(0, 110)
    console.log(`    ${String(m.created_at).slice(0, 19)} ${m.direction.padEnd(8)} ${body}`)
  }
}

await c.end()
