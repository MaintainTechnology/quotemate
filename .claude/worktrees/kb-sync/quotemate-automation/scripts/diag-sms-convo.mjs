// Diagnose an SMS conversation by a token fragment (photo_request_token).
// Shows status, captured slots, product choice, intake + whether a quote
// was drafted, and the last messages.
// Usage: node --env-file=.env.local scripts/diag-sms-convo.mjs 8559dea68b301f48f6904b3b55

import pg from 'pg'

const frag = (process.argv[2] || '').replace(/[^a-f0-9]/gi, '')
if (!frag) { console.error('pass a token fragment'); process.exit(1) }

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const { rows } = await c.query(
  `select id, tenant_id, status, intake_id, product_choice, conversation_state,
          last_message_at, photo_request_sent_at, photos_completed_at
     from sms_conversations
    where photo_request_token like $1
    order by last_message_at desc nulls last limit 1`,
  [`${frag}%`],
)
if (rows.length === 0) { console.log('no conversation for that token fragment'); await c.end(); process.exit(0) }
const cv = rows[0]
console.log('conversation', cv.id)
console.log('  status            :', cv.status)
console.log('  last_message_at   :', String(cv.last_message_at).slice(0, 19))
console.log('  intake_id         :', cv.intake_id ?? '(none — no quote drafted)')
console.log('  product_choice    :', JSON.stringify(cv.product_choice))
console.log('  photo_request_sent:', cv.photo_request_sent_at ? 'yes' : 'no', '| photos_completed:', cv.photos_completed_at ? 'yes' : 'no')
const slots = cv.conversation_state?.slots ?? {}
console.log('  slots             :', JSON.stringify(slots))

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
    console.log(`  quote ${r.id} | status=${r.status} | routing=${r.routing_decision} | G/B/B=${r.has_good}/${r.has_better}/${r.has_best} | token=${r.share_token ? 'yes' : 'no'} | ${String(r.created_at).slice(0,19)}`)
  }
}

const msgs = await c.query(
  `select direction, left(body, 70) as body, created_at from sms_messages where conversation_id = $1 order by created_at desc limit 8`,
  [cv.id],
)
console.log('\nlast messages:')
for (const m of msgs.rows.reverse()) {
  console.log(`  ${String(m.created_at).slice(11,19)} ${m.direction.padEnd(8)} ${m.body}`)
}

await c.end()
