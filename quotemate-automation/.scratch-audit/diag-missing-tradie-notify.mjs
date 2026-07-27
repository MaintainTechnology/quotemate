// Why did the tradie hear nothing for token ff6f67cec0d503d571394338d07a23cf?
//   node --env-file=.env.local .scratch-audit/diag-missing-tradie-notify.mjs
//
// Three suspects, in order:
//   1. notifyRoofingTradie's self-test guard (owner_mobile === customer_phone)
//   2. owner_mobile null and TRADIE_NOTIFY_NUMBER unset
//   3. the notify fired and the dispatch failed
// Plus: does ANY booking notification exist in the outbound history?

import pg from 'pg'

const TOKEN = process.argv[2] ?? 'ff6f67cec0d503d571394338d07a23cf'

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
  return rows
}

const [m] = await q(
  'the measurement row',
  `select id, tenant_id, address, customer_name, customer_phone, routing,
          structure_count, included_indices, paid_at, scheduled_at,
          confirmed_at, created_at,
          (quote #>> '{combined,tiers,1,inc_gst}') as better_inc_gst
     from roofing_measurements
    where public_token = $1`,
  [TOKEN],
)

if (!m) {
  console.log('\nno such token — stopping')
  await client.end()
  process.exit(0)
}

const [t] = await q(
  'the tenant',
  `select id, business_name, owner_first_name, owner_mobile, twilio_sms_number, status
     from tenants where id = $1`,
  [m.tenant_id],
)

console.log('\n── notifyRoofingTradie guard evaluation')
const notifyMobile = t?.owner_mobile ?? '(TRADIE_NOTIFY_NUMBER fallback)'
console.log(`   owner_mobile        = ${JSON.stringify(t?.owner_mobile ?? null)}`)
console.log(`   customer_phone      = ${JSON.stringify(m.customer_phone)}`)
console.log(`   twilio_sms_number   = ${JSON.stringify(t?.twilio_sms_number ?? null)}`)
console.log(`   -> no notify number : ${!t?.owner_mobile}`)
console.log(`   -> SELF-TEST GUARD  : ${t?.owner_mobile === m.customer_phone}`)
console.log(`   -> notify target    : ${notifyMobile}`)

await q(
  'every outbound SMS to the tradie owner_mobile in the last 3 days',
  `select m.created_at, left(m.body, 90) as body
     from sms_messages m
     join sms_conversations c on c.id = m.conversation_id
    where m.direction = 'outbound'
      and c.customer_phone = $1
      and m.created_at >= now() - interval '3 days'
    order by m.created_at desc limit 20`,
  [t?.owner_mobile ?? '__none__'],
)

await q(
  'outbound messages on the CUSTOMER thread around the quote',
  `select m.created_at, left(m.body, 70) as body
     from sms_messages m
     join sms_conversations c on c.id = m.conversation_id
    where c.customer_phone = $1
      and m.direction = 'outbound'
      and m.created_at >= $2::timestamptz - interval '10 minutes'
    order by m.created_at limit 20`,
  [m.customer_phone, m.created_at],
)

await q(
  'has a "quote sent via SMS" tradie alert EVER been delivered?',
  `select count(*) as n, max(created_at) as most_recent
     from sms_messages
    where direction = 'outbound' and body like '%quote sent via SMS%'`,
)

await q(
  'has any BOOKING alert ever gone to a tradie? (expected: none — no such code)',
  `select count(*) as n
     from sms_messages
    where direction = 'outbound'
      and (body ilike '%booked a time%' or body ilike '%locked in%' or body ilike '%booking confirmed%')`,
)

await client.end()
