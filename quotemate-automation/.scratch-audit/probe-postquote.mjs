// Decisive probe for the post-quote silence (G10/R3/A4).
// Hypothesis A: inflight-continuation gate swallows it.
// Hypothesis B: the follow-up arrives while the QUOTE turn still holds the
//   per-conversation lock, coalesces into a leader that has already read
//   history, and is orphaned (no reply, ever).
// Test: take the newest 'quoted' conversation, confirm no lock is held now
// (long after the quote), send ONE follow-up, wait, and see if a reply lands.
//   node --env-file=.env.local .scratch-audit/probe-postquote.mjs
import { createHmac } from 'node:crypto'
import pg from 'pg'

const FROM = '+61489083371'
const TO = process.env.SCENARIO_TO || '+61468011464'
const ENDPOINT = 'https://quote-mate-rho.vercel.app/api/sms/inbound'
const TOKEN = process.env.TWILIO_AUTH_TOKEN
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? 'ACtest'
const BODY = process.argv[2] || 'does that price include the gutters?'

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function sign(url, params) {
  const sorted = Object.keys(params).sort()
  let data = url
  for (const k of sorted) data += k + params[k]
  return createHmac('sha1', TOKEN).update(Buffer.from(data, 'utf-8')).digest('base64')
}

const { rows } = await c.query(
  `select id, status, processing_until, roofing_state->>'last_step' step, last_message_at
   from sms_conversations where from_number=$1 and to_number=$2
   order by last_message_at desc limit 1`,
  [FROM, TO],
)
const conv = rows[0]
console.log('conversation:', conv?.id)
console.log('  status:', conv?.status, '| roofing step:', conv?.step)
console.log('  processing_until:', conv?.processing_until, '| lock held now?',
  conv?.processing_until ? new Date(conv.processing_until) > new Date() : false)
console.log('  last_message_at:', conv?.last_message_at,
  '| age(s):', Math.round((Date.now() - new Date(conv.last_message_at)) / 1000))

const { rows: [pre] } = await c.query(
  `select count(*)::int n from sms_messages where conversation_id=$1 and direction='outbound'`, [conv.id])
console.log('  outbound before:', pre.n)

const params = { From: FROM, To: TO, Body: BODY, MessageSid: `SMp${Date.now()}`, AccountSid: ACCOUNT_SID }
await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sign(ENDPOINT, params) },
  body: new URLSearchParams(params).toString(),
})
console.log(`\nsent: "${BODY}" (no lock contention) — waiting up to 120s...`)

let replied = false
for (let i = 0; i < 24; i++) {
  await sleep(5000)
  const { rows: [now] } = await c.query(
    `select count(*)::int n from sms_messages where conversation_id=$1 and direction='outbound'`, [conv.id])
  if (now.n > pre.n) { replied = true; console.log(`REPLY after ~${(i + 1) * 5}s`); break }
}
if (!replied) console.log('NO REPLY after 120s')

const { rows: msgs } = await c.query(
  `select direction, left(body,110) body from sms_messages where conversation_id=$1 order by created_at desc limit 3`, [conv.id])
console.log('\nlast 3 (newest first):')
for (const m of msgs) console.log('  ', m.direction, '|', m.body)
const { rows: [after] } = await c.query(`select roofing_state->>'last_step' step, status from sms_conversations where id=$1`, [conv.id])
console.log('\nstate after:', after.step, '| status:', after.status)
console.log(replied ? '\n=> HYPOTHESIS B (lock/coalesce orphan): replies fine when no lock contention.' : '\n=> HYPOTHESIS A (routing gap): silent even with no lock contention.')
await c.end()
