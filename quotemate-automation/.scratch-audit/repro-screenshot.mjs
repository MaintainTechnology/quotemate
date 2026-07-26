// Reproduce the QM Sparky screenshot (2026-07-25) EXACTLY, then capture which
// handler produced each reply and what state was live.
// Precondition from the screenshot: a roofing gather already parked at the
// intent step holding 670 London Rd (the address the customer never gave in
// the visible part of the conversation).
//   node --env-file=.env.local .scratch-audit/repro-screenshot.mjs
import { createHmac } from 'node:crypto'
import pg from 'pg'

const FROM = '+61489083371'
const TO = process.env.SCENARIO_TO || '+61468048422' // QM Sparky
const ENDPOINT = 'https://quote-mate-rho.vercel.app/api/sms/inbound'
const TOKEN = process.env.TWILIO_AUTH_TOKEN
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? 'ACtest'

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sign = (u, p) => createHmac('sha1', TOKEN).update(Buffer.from(u + Object.keys(p).sort().map(k => k + p[k]).join(''), 'utf-8')).digest('base64')
async function send(body) {
  const p = { From: FROM, To: TO, Body: body, MessageSid: `SMr${Date.now()}${Math.floor(Math.random() * 1e6)}`, AccountSid: ACCOUNT_SID }
  await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sign(ENDPOINT, p) }, body: new URLSearchParams(p).toString() })
}
const outCount = async (id) => (await c.query(`select count(*)::int n from sms_messages where conversation_id=$1 and direction='outbound'`, [id])).rows[0].n
async function waitOut(id, prev, ms = 90000) {
  const end = Date.now() + ms
  while (Date.now() < end) { await sleep(4000); if (await outCount(id) > prev) { await sleep(2500); return true } }
  return false
}
async function state(id) {
  const { rows } = await c.query(`select roofing_state->>'last_step' r, roofing_state->'slots'->>'address' addr, painting_state->>'last_step' p, status from sms_conversations where id=$1`, [id])
  return rows[0]
}

await c.query(`update sms_conversations set roofing_state=null, painting_state=null, conversation_state='{}'::jsonb, status='done', last_message_at='2026-07-01T00:00:00Z' where from_number=$1 and to_number=$2`, [FROM, TO])
const marker = new Date(Date.now() - 5000).toISOString()

// ── Precondition: park a roofing gather at the intent step holding an address
console.log('--- setting up the stale gather (as in the screenshot) ---')
await send('quote my roof')
let id = null
for (let i = 0; i < 8 && !id; i++) {
  const { rows } = await c.query(`select id from sms_conversations where from_number=$1 and to_number=$2 and created_at > $3 order by created_at desc limit 1`, [FROM, TO, marker])
  id = rows[0]?.id ?? null; if (!id) await sleep(1500)
}
let n = await outCount(id); await waitOut(id, n)
n = await outCount(id); await send('670 London Road Chandler QLD 4155'); await waitOut(id, n)
n = await outCount(id); await send('yes'); await waitOut(id, n)
console.log('  precondition state:', await state(id))

// ── The screenshot transcript, verbatim
const SCRIPT = [
  'Hi there mate!',
  'Can you help me decide and list out the services you have now',
  'You do paint?',
  'How about electrical',
  'No im asking electrical',
]
for (const msg of SCRIPT) {
  n = await outCount(id)
  await send(msg)
  const got = await waitOut(id, n)
  const s = await state(id)
  console.log(`\nCUST | ${msg}`)
  if (!got) console.log('  (no reply)')
  console.log(`  [state] roofing:${s.r ?? '-'} addr:${s.addr ?? '-'} painting:${s.p ?? '-'} status:${s.status}`)
}

console.log('\n=== full transcript ===')
const { rows: msgs } = await c.query(`select direction, left(body,190) body from sms_messages where conversation_id=$1 order by created_at asc`, [id])
for (const m of msgs) console.log(`  ${m.direction === 'inbound' ? 'CUST' : 'BOT '} | ${m.body.replace(/\n/g, ' ¶ ')}`)
console.log('\nfinal state:', await state(id))
await c.end()
