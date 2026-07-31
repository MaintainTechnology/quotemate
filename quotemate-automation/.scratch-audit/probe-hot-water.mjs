// Item 2 (attempt 2): drive the gas hot water enquiry to a real intake.
// Adaptive: reads the bot's actual question each turn and answers it, instead
// of a fixed script (attempt 1 guessed wrong and never reached intake).
//   node --env-file=.env.local .scratch-audit/probe-hot-water.mjs
import { createHmac } from 'node:crypto'
import pg from 'pg'

const FROM = '+61489083371'
const TO = process.env.SCENARIO_TO || '+61468048422' // Sparky
const ENDPOINT = 'https://quote-mate-rho.vercel.app/api/sms/inbound'
const TOKEN = process.env.TWILIO_AUTH_TOKEN
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? 'ACtest'

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sign = (u, p) => createHmac('sha1', TOKEN).update(Buffer.from(u + Object.keys(p).sort().map(k => k + p[k]).join(''), 'utf-8')).digest('base64')
async function send(body) {
  const p = { From: FROM, To: TO, Body: body, MessageSid: `SMh${Date.now()}${Math.floor(Math.random() * 1e6)}`, AccountSid: ACCOUNT_SID }
  await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sign(ENDPOINT, p) }, body: new URLSearchParams(p).toString() })
}

/** Answer whatever was actually asked. */
function reply(q) {
  const t = (q || '').toLowerCase()
  if (/first name|your name|who am i speaking|call you/.test(t)) return 'Jeph'
  if (/gas or electric|electric or gas|what type of (system|hot water)|storage or continuous/.test(t)) return 'gas'
  if (/how many litres|what size|litre|capacity|\b\d+\s*l\b/.test(t)) return '250L'
  if (/where is (it|the)|located|location|inside or outside/.test(t)) return 'outside back wall'
  if (/address|suburb|postcode/.test(t)) return '12 Smith Street Bondi NSW 2026'
  if (/photo|picture|image|upload/.test(t)) return 'no photos sorry'
  if (/email/.test(t)) return 'jeph@example.com'
  if (/how old|age of|when was it/.test(t)) return 'about 12 years old'
  if (/access|stairs|ladder|tight/.test(t)) return 'easy access'
  if (/\?/.test(t)) return 'yes'
  return 'yes'
}

await c.query(
  `update sms_conversations set roofing_state=null, painting_state=null, conversation_state='{}'::jsonb, status='done', last_message_at='2026-07-01T00:00:00Z' where from_number=$1 and to_number=$2`,
  [FROM, TO],
)
const startedAt = new Date().toISOString()
const marker = new Date(Date.now() - 5000).toISOString()

let id = null
const lastBot = async () => (await c.query(
  `select body from sms_messages where conversation_id=$1 and direction='outbound' order by created_at desc limit 1`, [id])).rows[0]?.body ?? ''
const outN = async () => (await c.query(
  `select count(*)::int n from sms_messages where conversation_id=$1 and direction='outbound'`, [id])).rows[0].n
async function waitReply(prev, ms = 120000) {
  const end = Date.now() + ms
  while (Date.now() < end) { await sleep(4000); if (await outN() > prev) { await sleep(2500); return true } }
  return false
}
const intakeCount = async () => (await c.query(
  `select count(*)::int n from intakes where created_at > $1`, [startedAt])).rows[0].n

await send(process.env.PROBE_MSG || 'Need my gas hot water system replaced, 250L, outside back wall')
for (let k = 0; k < 8 && !id; k++) {
  const { rows } = await c.query(
    `select id from sms_conversations where from_number=$1 and to_number=$2 and created_at > $3 order by created_at desc limit 1`,
    [FROM, TO, marker])
  id = rows[0]?.id ?? null
  if (!id) await sleep(1500)
}
await waitReply(0)

for (let turn = 0; turn < 9; turn++) {
  if (await intakeCount() > 0) { console.log(`intake appeared after ${turn} follow-ups`); break }
  const q = await lastBot()
  if (/quotemax\.com\.au\/q\//.test(q)) { console.log('quote link sent'); break }
  const a = reply(q)
  const prev = await outN()
  await send(a)
  if (!(await waitReply(prev))) { console.log(`no reply to "${a}"`); break }
}

console.log('\n=== transcript ===')
for (const m of (await c.query(`select direction, left(body,150) body from sms_messages where conversation_id=$1 order by created_at asc`, [id])).rows) {
  console.log(`${m.direction === 'inbound' ? 'CUST' : 'BOT '} | ${m.body.replace(/\n/g, ' ¶ ')}`)
}

console.log('\n=== YOUR QUERY, bounded to this run ===')
const { rows: q1 } = await c.query(
  `select scope->'specs'->>'system_type' system_type, inspection_required, job_type, trade, created_at
   from intakes where trade='plumbing' and job_type='hot_water' and created_at > $1
   order by created_at desc limit 1`, [startedAt])
console.log(q1[0] ? JSON.stringify(q1[0], null, 2) : 'NO plumbing/hot_water intake from this run')

console.log('\n=== ANY intake from this run ===')
const { rows: q2 } = await c.query(
  `select trade, job_type, scope->'specs'->>'system_type' st, inspection_required
   from intakes where created_at > $1 order by created_at desc limit 3`, [startedAt])
console.log(q2.length ? JSON.stringify(q2, null, 2) : 'none')
await c.end()
