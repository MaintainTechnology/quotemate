// Round-4 live verification against the deployed build.
//  A) DRAIN: fire the final gather answer (starts a ~90s measure), then send a
//     follow-up 15s later WITHOUT waiting — the exact mid-pipeline orphan that
//     used to be answered with silence. Expect the quote AND a reply to it.
//  B) G6: a roof emergency engages roofing (not the general dialog).
//  C) R1: a one-shot brief reaches the measure without re-asking the pitch.
//   node --env-file=.env.local .scratch-audit/verify-round4.mjs
import { createHmac } from 'node:crypto'
import pg from 'pg'

const FROM = '+61489083371'
const TO = process.env.SCENARIO_TO || '+61468011464'
const ENDPOINT = 'https://quote-mate-rho.vercel.app/api/sms/inbound'
const TOKEN = process.env.TWILIO_AUTH_TOKEN
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? 'ACtest'

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sign = (url, p) => createHmac('sha1', TOKEN).update(Buffer.from(url + Object.keys(p).sort().map(k => k + p[k]).join(''), 'utf-8')).digest('base64')
async function send(body) {
  const p = { From: FROM, To: TO, Body: body, MessageSid: `SMv${Date.now()}${Math.floor(Math.random() * 1e6)}`, AccountSid: ACCOUNT_SID }
  await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sign(ENDPOINT, p) }, body: new URLSearchParams(p).toString() })
}
async function reset() {
  await c.query(`update sms_conversations set roofing_state=null, painting_state=null, conversation_state='{}'::jsonb, status='done', last_message_at='2026-07-01T00:00:00Z' where from_number=$1 and to_number=$2`, [FROM, TO])
}
async function convId(afterIso) {
  const { rows } = await c.query(`select id from sms_conversations where from_number=$1 and to_number=$2 and created_at > $3 order by created_at desc limit 1`, [FROM, TO, afterIso])
  return rows[0]?.id ?? null
}
const outCount = async (id) => (await c.query(`select count(*)::int n from sms_messages where conversation_id=$1 and direction='outbound'`, [id])).rows[0].n
async function waitOut(id, prev, ms = 150000) {
  const end = Date.now() + ms
  while (Date.now() < end) { await sleep(4000); if (await outCount(id) > prev) { await sleep(2500); return true } }
  return false
}
async function dump(id, label) {
  const { rows } = await c.query(`select direction, left(body,150) body from sms_messages where conversation_id=$1 order by created_at asc`, [id])
  console.log(`\n--- ${label} ---`)
  for (const m of rows) console.log(`  ${m.direction === 'inbound' ? 'CUST' : 'BOT '} | ${m.body.replace(/\n/g, ' ¶ ')}`)
  const { rows: s } = await c.query(`select roofing_state->>'last_step' step from sms_conversations where id=$1`, [id])
  console.log(`  [state] roofing:${s[0]?.step ?? '-'}`)
  return rows
}

// ── A) DRAIN ───────────────────────────────────────────────────────────
console.log('=== A) post-quote / mid-pipeline orphan drain ===')
await reset()
let marker = new Date(Date.now() - 5000).toISOString()
await send('new roof quote')
let id = null
for (let i = 0; i < 8 && !id; i++) { id = await convId(marker); if (!id) await sleep(1500) }
let n = await outCount(id); await waitOut(id, n)
n = await outCount(id); await send('670 London Road Chandler QLD 4155'); await waitOut(id, n)
n = await outCount(id); await send('yes'); await waitOut(id, n)
n = await outCount(id); await send('colorbond corrugated'); await waitOut(id, n)
n = await outCount(id)
console.log('firing "standard" (starts the ~90s measure), then a follow-up 15s later WITHOUT waiting...')
await send('standard')
await sleep(15000)
await send('thats way too expensive can you do better')
const got = await waitOut(id, n, 200000)
await sleep(45000) // let the drain / any trailing sends land
const rowsA = await dump(id, 'A) drain')
const lastA = rowsA[rowsA.length - 1]
console.log(lastA?.direction === 'outbound'
  ? '  => PASS: the thread does NOT end on an unanswered customer message'
  : '  => FAIL: last message is the customer (silence)')

// ── B) G6 emergency ────────────────────────────────────────────────────
console.log('\n=== B) roof emergency engages roofing ===')
await reset()
marker = new Date(Date.now() - 5000).toISOString()
await send('MY ROOF IS COLLAPSING RIGHT NOW you useless bot HELP ME')
id = null
for (let i = 0; i < 8 && !id; i++) { id = await convId(marker); if (!id) await sleep(1500) }
await waitOut(id, 0)
const rowsB = await dump(id, 'B) emergency')
const { rows: sB } = await c.query(`select roofing_state->>'last_step' step from sms_conversations where id=$1`, [id])
console.log(sB[0]?.step ? '  => PASS: roofing engaged' : '  => FAIL: fell to the general dialog')

// ── C) R1 one-shot brief ───────────────────────────────────────────────
console.log('\n=== C) one-shot brief keeps the pitch ===')
await reset()
marker = new Date(Date.now() - 5000).toISOString()
await send('I need a full reroof at 670 London Road Chandler QLD 4155, colorbond corrugated, standard pitch')
id = null
for (let i = 0; i < 8 && !id; i++) { id = await convId(marker); if (!id) await sleep(1500) }
await waitOut(id, 0)
n = await outCount(id); await send('yes'); await waitOut(id, n, 200000)
const rowsC = await dump(id, 'C) one-shot')
console.log(rowsC.some(m => /how steep/i.test(m.body)) ? '  => FAIL: still asked the pitch' : '  => PASS: pitch not re-asked')

await c.end()
