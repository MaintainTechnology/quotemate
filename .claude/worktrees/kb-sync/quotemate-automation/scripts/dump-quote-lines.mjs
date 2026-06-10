// Dump full line items of the latest quote for a conversation id fragment.
// Usage: node --env-file=.env.local scripts/dump-quote-lines.mjs 0989b976

import pg from 'pg'
const frag = (process.argv[2] || '').toLowerCase()
if (!frag) { console.error('pass an id fragment'); process.exit(1) }

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const { rows: cvs } = await c.query(
  `select id, intake_id, product_choice, conversation_state from sms_conversations where id::text like $1 limit 1`,
  [`${frag}%`],
)
if (!cvs.length) { console.log('no conversation'); await c.end(); process.exit(0) }
const cv = cvs[0]
console.log('conversation', cv.id, '| intake_id', cv.intake_id)
console.log('product_choice status:', cv.product_choice?.status, '| chosen:', cv.product_choice?.chosen_name)
console.log('slots:', JSON.stringify(cv.conversation_state?.slots ?? {}))

if (!cv.intake_id) { console.log('no intake — no quote'); await c.end(); process.exit(0) }

const { rows: qs } = await c.query(
  `select id, status, routing_decision, needs_inspection, selected_tier, good, better, best, created_at
     from quotes where intake_id = $1 order by created_at desc limit 1`,
  [cv.intake_id],
)
if (!qs.length) { console.log('no quote for intake'); await c.end(); process.exit(0) }
const q = qs[0]
console.log(`\nquote ${q.id} | status=${q.status} | routing=${q.routing_decision} | needs_inspection=${q.needs_inspection} | selected_tier=${q.selected_tier} | ${String(q.created_at).slice(0,19)}`)

for (const tierKey of ['good','better','best']) {
  const tier = q[tierKey]
  if (!tier) { console.log(`\n[${tierKey}] (null)`); continue }
  console.log(`\n[${tierKey}] label="${tier.label ?? ''}" subtotal_ex_gst=${tier.subtotal_ex_gst} total_inc_gst=${tier.total_inc_gst ?? tier.total ?? '?'}`)
  for (const li of (tier.line_items ?? [])) {
    console.log(`   • ${li.description} | qty=${li.quantity} ${li.unit ?? ''} @ $${li.unit_price_ex_gst} = $${li.total_ex_gst}  [${li.kind ?? li.type ?? li.source ?? ''}]`)
  }
}
await c.end()
