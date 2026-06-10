// Diagnose an SMS conversation by id fragment. Shows full state, slots,
// product choice, intake + quote, and recent messages.
// Usage: node --env-file=.env.local scripts/diag-convo-by-id.mjs e431637e

import pg from 'pg'

const frag = (process.argv[2] || '').toLowerCase()
if (!frag) { console.error('pass an id fragment'); process.exit(1) }

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const { rows } = await c.query(
  `select id, tenant_id, from_number, to_number, status, turn_count, intake_id,
          product_choice, conversation_state, roofing_state,
          last_message_at, photo_request_sent_at, photos_completed_at
     from sms_conversations
    where id::text like $1
    order by last_message_at desc nulls last limit 1`,
  [`${frag}%`],
)
if (rows.length === 0) { console.log('no conversation'); await c.end(); process.exit(0) }
const cv = rows[0]
console.log('conversation', cv.id)
console.log('  tenant_id         :', cv.tenant_id)
console.log('  from -> to        :', cv.from_number, '->', cv.to_number)
console.log('  status            :', cv.status, '| turns:', cv.turn_count)
console.log('  last_message_at   :', String(cv.last_message_at).slice(0, 19))
console.log('  intake_id         :', cv.intake_id ?? '(none — no quote drafted yet)')
console.log('  product_choice    :', JSON.stringify(cv.product_choice))
console.log('  photo_request_sent:', cv.photo_request_sent_at ? 'yes' : 'no', '| photos_completed:', cv.photos_completed_at ? 'yes' : 'no')
console.log('\n  conversation_state:')
console.log(JSON.stringify(cv.conversation_state, null, 2))

// tenant name
if (cv.tenant_id) {
  const t = await c.query(`select business_name, trade, trades from tenants where id=$1`, [cv.tenant_id])
  if (t.rows[0]) console.log('\n  tenant            :', t.rows[0].business_name, '| trade:', t.rows[0].trade, '| trades:', JSON.stringify(t.rows[0].trades))
}

if (cv.intake_id) {
  const q = await c.query(
    `select id, status, routing_decision, needs_inspection,
            (good is not null) as has_good, (better is not null) as has_better, (best is not null) as has_best,
            share_token, created_at
       from quotes where intake_id = $1 order by created_at desc limit 2`,
    [cv.intake_id],
  )
  console.log(`\nquotes for intake ${cv.intake_id}: ${q.rows.length}`)
  for (const r of q.rows) {
    console.log(`  quote ${r.id} | status=${r.status} | routing=${r.routing_decision} | needs_inspection=${r.needs_inspection} | G/B/B=${r.has_good}/${r.has_better}/${r.has_best} | token=${r.share_token ? 'yes' : 'no'} | ${String(r.created_at).slice(0,19)}`)
  }
}

const msgs = await c.query(
  `select direction, body, created_at from sms_messages where conversation_id = $1 order by created_at desc limit 12`,
  [cv.id],
)
console.log('\nlast messages (oldest first):')
for (const m of msgs.rows.reverse()) {
  console.log(`  ${String(m.created_at).slice(11,19)} ${m.direction.padEnd(8)} ${m.body}`)
}

await c.end()
