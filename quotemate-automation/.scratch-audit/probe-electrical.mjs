// Step 1: "need 6 downlights installed in my kitchen" -> does an intake row appear?
//   node --env-file=.env.local .scratch-audit/probe-electrical.mjs
//
// Fixes the attempt-1 harness bug: the old responder matched the word "address"
// anywhere in the bot's text, so the bot ECHOING "got the Bondi address" made it
// re-send the address forever instead of answering the real question.
import { createHmac } from 'node:crypto'
import pg from 'pg'

const FROM = '+61489083371'
const TO = process.env.SCENARIO_TO || '+61468048422' // Sparky
const ENDPOINT = process.env.SMS_ENDPOINT || 'https://quote-mate-rho.vercel.app/api/sms/inbound'
const TOKEN = process.env.TWILIO_AUTH_TOKEN
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? 'ACtest'

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sign = (u, p) => createHmac('sha1', TOKEN).update(Buffer.from(u + Object.keys(p).sort().map(k => k + p[k]).join(''), 'utf-8'), ).digest('base64')
async function send(body) {
  const p = { From: FROM, To: TO, Body: body, MessageSid: `SMh${Date.now()}${Math.floor(Math.random() * 1e6)}`, AccountSid: ACCOUNT_SID }
  await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sign(ENDPOINT, p) }, body: new URLSearchParams(p).toString() })
}

/** Only the sentence actually being asked — not the bot's echo of what it already has. */
function question(text) {
  const parts = String(text || '').split(/(?<=[.!?])\s+/)
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].includes('?')) return parts[i]
  return String(text || '')
}

let last = null
function reply(botText) {
  const t = question(botText).toLowerCase()
  const pick = (v) => (v === last ? null : v)
  const answer =
    // specific electrical questions first, so a generic word never wins
    /reply 1 or 2|take your pick|options in our catalogue|you pick|reply "yes" to confirm/.test(String(botText).toLowerCase()) ? pick('standard quote')
    : /storey|storeys|how many levels|one level|two levels|single.?level/.test(t) ? pick('single storey')
    : /switchboard|circuit|breaker|fuse|rcd/.test(t) ? pick('modern switchboard with RCDs')
    : /ceiling/.test(t) ? pick('flat plaster')
    : /how many|number of|qty|quantity/.test(t) ? pick('6')
    : /dimmer|switch/.test(t) ? pick('no dimmer, standard switch')
    // This tenant only offers NEW downlight installs — a like-for-like swap is
    // refused, so answer in scope or the dialog can never reach an intake.
    : /new downlight install|gpos|fans|smoke alarms|outdoor lights/.test(t) ? pick('new downlight install')
    : /existing|replacing|already there|old light|new install/.test(t) ? pick('new install, no fittings there now')
    : /roof space|manhole|access/.test(t) ? pick('yes, easy access through the manhole')
    : /warm white|cool white|colour|color|globe|led/.test(t) ? pick('warm white')
    : /inspection|\$99|book|booking/.test(t) ? pick('yes please, book it')
    : /first name|your name|who am i speaking|call you/.test(t) ? pick('Jeph')
    : /photo|picture|image|upload/.test(t) ? pick('no photos sorry')
    : /email/.test(t) ? pick('jeph@example.com')
    : /when|timing|how soon|urgent/.test(t) ? pick('next week is fine')
    // generic location question LAST
    : /address|suburb|postcode|where/.test(t) ? pick('12 Smith Street Bondi NSW 2026')
    : pick('yes')
  last = answer ?? 'yes'
  return last
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

await send('need 6 downlights installed in my kitchen')
for (let k = 0; k < 8 && !id; k++) {
  const { rows } = await c.query(
    `select id from sms_conversations where from_number=$1 and to_number=$2 and created_at > $3 order by created_at desc limit 1`,
    [FROM, TO, marker])
  id = rows[0]?.id ?? null
  if (!id) await sleep(1500)
}
await waitReply(0)

for (let turn = 0; turn < 10; turn++) {
  if (await intakeCount() > 0) { console.log(`>>> intake row appeared after ${turn} follow-ups`); break }
  const q = await lastBot()
  if (/quotemax\.com\.au\/q\//.test(q)) { console.log('>>> quote link sent'); break }
  const a = reply(q)
  const prev = await outN()
  await send(a)
  if (!(await waitReply(prev))) { console.log(`>>> no reply to "${a}"`); break }
}

console.log('\n=== transcript ===')
for (const m of (await c.query(`select direction, left(body,170) body from sms_messages where conversation_id=$1 order by created_at asc`, [id])).rows) {
  console.log(`${m.direction === 'inbound' ? 'CUST' : 'BOT '} | ${m.body.replace(/\n/g, ' / ')}`)
}

console.log('\n=== router decisions this run (did it ever reach intake?) ===')
const { rows: d } = await c.query(
  `select created_at, decisions->>'decision_action' action, decisions->>'ready_for_intake' ready,
          decisions->>'decision_job_type' job_type
   from pipeline_traces where sms_conversation_id=$1 and step='dispatch' order by created_at asc`, [id])
console.log(d.length ? JSON.stringify(d, null, 2) : '(no dispatch traces)')

console.log('\n=== YOUR QUERY (unbounded, exactly as written) ===')
console.log(JSON.stringify((await c.query(
  `select id, trade, job_type,
          scope->>'item_count' as item_count,
          inspection_required,
          confidence,
          created_at
   from intakes order by created_at desc limit 3`)).rows, null, 2))

console.log('\n=== ...and bounded to THIS run, so an old row cannot look like a pass ===')
const { rows: mine } = await c.query(
  `select id, trade, job_type, inspection_required, created_at from intakes where created_at > $1 order by created_at desc`, [startedAt])
console.log(mine.length ? JSON.stringify(mine, null, 2) : 'NO intake row created by this run')
await c.end()
