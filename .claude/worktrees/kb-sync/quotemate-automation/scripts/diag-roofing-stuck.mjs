// Diagnose a stuck SMS roofing turn: where did it stall after the pitch
// answer? Reads the conversation's roofing_state + last messages + any
// saved measurement, via pg (bypasses PostgREST).
// Usage: node --env-file=.env.local scripts/diag-roofing-stuck.mjs +61480808517

import pg from 'pg'

const phone = process.argv[2] || '+61480808517'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

console.log(`\n=== sms_conversations for ${phone} (latest 3) ===`)
const convos = await c.query(
  `select id, status, last_message_at, roofing_state
     from sms_conversations
    where from_number = $1
    order by last_message_at desc nulls last
    limit 3`,
  [phone],
)
for (const r of convos.rows) {
  console.log(`\nconv ${r.id} | status=${r.status} | ${String(r.last_message_at).slice(0, 19)}`)
  console.log('  roofing_state:', JSON.stringify(r.roofing_state))
}

const latest = convos.rows[0]
if (latest) {
  console.log(`\n=== last 8 messages on ${latest.id} ===`)
  const msgs = await c.query(
    `select direction, left(body, 90) as body, created_at
       from sms_messages where conversation_id = $1
      order by created_at desc limit 8`,
    [latest.id],
  )
  for (const m of msgs.rows.reverse()) {
    console.log(`  ${String(m.created_at).slice(11, 19)} ${m.direction.padEnd(8)} ${m.body}`)
  }
}

console.log(`\n=== roofing_measurements for ${phone} (latest 3) ===`)
const meas = await c.query(
  `select id, address, routing, structure_count, public_token, created_at
     from roofing_measurements
    where customer_phone = $1
    order by created_at desc limit 3`,
  [phone],
)
if (meas.rows.length === 0) console.log('  (none — no measurement was ever saved)')
for (const m of meas.rows) {
  console.log(`  ${String(m.created_at).slice(0, 19)} | ${m.address} | routing=${m.routing} | structures=${m.structure_count} | token=${m.public_token ? 'yes' : 'no'}`)
}

await c.end()
