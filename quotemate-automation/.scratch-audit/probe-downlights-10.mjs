// R3 baseline + the 10-downlight counting test.
// 10 is deliberately NOT the recipe default (6), so a "6" anywhere is a real failure.
//   node --env-file=.env.local .scratch-audit/probe-downlights-10.mjs
import { createHmac } from 'node:crypto'
import pg from 'pg'

const FROM = '+61489083371'
const TO = process.env.SCENARIO_TO || '+61468048422' // Sparky
const SMS_ENDPOINT = 'https://quote-mate-rho.vercel.app/api/sms/inbound'
const TOKEN = process.env.TWILIO_AUTH_TOKEN
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? 'ACtest'

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sign = (u, p) => createHmac('sha1', TOKEN).update(Buffer.from(u + Object.keys(p).sort().map(k => k + p[k]).join(''), 'utf-8')).digest('base64')
async function send(body) {
  const p = { From: FROM, To: TO, Body: body, MessageSid: `SMh${Date.now()}${Math.floor(Math.random() * 1e6)}`, AccountSid: ACCOUNT_SID }
  await fetch(SMS_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sign(SMS_ENDPOINT, p) }, body: new URLSearchParams(p).toString() })
}

/** Only the sentence being asked — never the bot's echo of what it already has. */
function question(text) {
  const parts = String(text || '').split(/(?<=[.!?])\s+/)
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].includes('?')) return parts[i]
  return String(text || '')
}
let last = null
function reply(botText) {
  const t = question(botText).toLowerCase()
  const pick = (v) => (v === last ? null : v)
  const full = String(botText || '').toLowerCase()
  const a =
    // Phase 4 catalogue product-choice offer. "standard quote" keeps us on the
    // regular G/B/B tier pricing — that is the deterministic baseline R3 rebuilds.
      /reply 1 or 2|take your pick|options in our catalogue|you pick|standard quote/.test(full) ? pick('1')
    : /ceiling/.test(t) ? pick('flat plaster')
    : /how many|number of|qty|quantity/.test(t) ? pick('10')            // <- the discriminator
    : /dimmer|switch/.test(t) ? pick('no dimmer, standard switch')
    : /existing|replacing|already there|old light|new install/.test(t) ? pick('replacing old halogens')
    : /storey|storeys|story|how many levels|one level|two levels|single.?level|double.?storey/.test(t) ? pick('single storey')
    : /switchboard|circuit|breaker|fuse|rcd|amp/.test(t) ? pick('modern switchboard with RCDs')
    : /insulation|batts/.test(t) ? pick('there is insulation up there')
    : /roof space|manhole|access|crawl/.test(t) ? pick('yes, easy access through the manhole')
    : /warm white|cool white|colour|color|globe|temperature/.test(t) ? pick('warm white')
    : /first name|your name|who am i speaking|call you/.test(t) ? pick('Jeph')
    : /photo|picture|image|upload/.test(t) ? pick('no photos sorry')
    : /email/.test(t) ? pick('jeph@example.com')
    : /when|how soon|urgent|timing/.test(t) ? pick('next week is fine')
    : /sound right|correct\?|confirm|is that right|all good/.test(t) ? pick('yes that is right')
    : /address|suburb|postcode|where/.test(t) ? pick('12 Smith Street Bondi NSW 2026')
    : pick('yes')
  last = a ?? 'yes'
  return last
}

await c.query(
  `update sms_conversations set roofing_state=null, painting_state=null, conversation_state='{}'::jsonb, status='done', last_message_at='2026-07-01T00:00:00Z' where from_number=$1 and to_number=$2`,
  [FROM, TO])
const startedAt = new Date().toISOString()
const marker = new Date(Date.now() - 5000).toISOString()

let id = null
const lastBot = async () => (await c.query(`select body from sms_messages where conversation_id=$1 and direction='outbound' order by created_at desc limit 1`, [id])).rows[0]?.body ?? ''
const outN = async () => (await c.query(`select count(*)::int n from sms_messages where conversation_id=$1 and direction='outbound'`, [id])).rows[0].n
async function waitReply(prev, ms = 100000) {
  const end = Date.now() + ms
  while (Date.now() < end) { await sleep(4000); if (await outN() > prev) { await sleep(2500); return true } }
  return false
}
const newIntake = async () => (await c.query(
  `select id, trade, job_type, scope, scope->>'item_count' item_count, inspection_required, confidence, created_at
   from intakes where created_at > $1 order by created_at desc limit 1`, [startedAt])).rows[0] ?? null

await send('need 10 downlights installed in my kitchen')
for (let k = 0; k < 8 && !id; k++) {
  const { rows } = await c.query(
    `select id from sms_conversations where from_number=$1 and to_number=$2 and created_at > $3 order by created_at desc limit 1`, [FROM, TO, marker])
  id = rows[0]?.id ?? null
  if (!id) await sleep(1500)
}
await waitReply(0)

for (let turn = 0; turn < 16; turn++) {
  if (await newIntake()) { console.log(`>>> intake appeared after ${turn} follow-ups`); break }
  const q = await lastBot()
  if (/quotemax\.com\.au\/q\//.test(q)) { console.log('>>> quote link sent'); break }
  const a = reply(q)
  const prev = await outN()
  await send(a)
  if (!(await waitReply(prev))) { console.log(`>>> no reply to "${a}"`); break }
}

console.log('\n=== transcript ===')
for (const m of (await c.query(`select direction, left(body,200) body from sms_messages where conversation_id=$1 order by created_at asc`, [id])).rows)
  console.log(`${m.direction === 'inbound' ? 'CUST' : 'BOT '} | ${m.body.replace(/\n/g, ' / ')}`)

console.log('\n=== router decisions ===')
for (const d of (await c.query(
  `select decisions->>'decision_action' a, decisions->>'ready_for_intake' r
   from pipeline_traces where sms_conversation_id=$1 and step='dispatch' order by created_at asc`, [id])).rows)
  console.log(`  action=${d.a} ready_for_intake=${d.r}`)

// The last run's intake landed ~13 min late, so wait properly rather than declaring failure early.
let intake = await newIntake()
for (let k = 0; k < 40 && !intake; k++) { await sleep(6000); intake = await newIntake() }
if (!intake) { console.log('\nNo intake within 4 minutes of the conversation ending.'); await c.end(); process.exit(0) }

console.log('\n=== INTAKE ===')
console.log(`  id=${intake.id} trade=${intake.trade} job_type=${intake.job_type}`)
console.log(`  item_count=${intake.item_count}  inspection_required=${intake.inspection_required}  confidence=${intake.confidence}`)
console.log(`  scope=${JSON.stringify(intake.scope).slice(0, 400)}`)

let q = null
for (let k = 0; k < 25 && !q; k++) {
  q = (await c.query(`select * from quotes where intake_id=$1 order by created_at desc limit 1`, [intake.id])).rows[0] ?? null
  if (!q) await sleep(6000)
}
if (!q) { console.log('\nIntake exists but no quote row within 2.5 minutes.'); await c.end(); process.exit(0) }

console.log('\n=== QUOTE ===')
console.log(`  id=${q.id} status=${q.status} routing_decision=${q.routing_decision} auto_sent=${q.auto_sent}`)
console.log(`  pricing_path=${q.pricing_path}   <-- deterministic vs opus_fallback`)
console.log(`  needs_inspection=${q.needs_inspection} selected_tier=${q.selected_tier} total_inc_gst=${q.total_inc_gst}`)

console.log('\n=== TIERS (R3 baseline) ===')
const vals = []
for (const name of ['good', 'better', 'best']) {
  const t = q[name]
  if (!t) { console.log(`  ${name.padEnd(7)} NULL`); continue }
  const sub = t.subtotal_ex_gst ?? t.total ?? null
  if (sub != null) vals.push(Number(sub))
  console.log(`  ${name.padEnd(7)} ${t.label ?? ''} — ex-GST ${sub} (inc ${sub != null ? (Number(sub) * 1.1).toFixed(2) : '?'})`)
  for (const li of (t.line_items ?? []))
    console.log(`      qty=${li.qty ?? li.quantity ?? '?'}  ${String(li.description ?? li.name ?? li.item ?? '').slice(0, 90)}`)
}
console.log(`\n  distinct tier prices: ${new Set(vals).size}`)

console.log('\n=== THE COUNTING TEST: does anything say 10 (and nothing say 6)? ===')
const blob = JSON.stringify({ scope: intake.scope, good: q.good, better: q.better, best: q.best })
const tens = (blob.match(/\b10\b/g) || []).length
const sixes = (blob.match(/\b6\b/g) || []).length
console.log(`  item_count = ${intake.item_count}`)
console.log(`  occurrences of 10 in scope+tiers: ${tens}   |   occurrences of 6: ${sixes}`)
const qtys = []
for (const name of ['good', 'better', 'best'])
  for (const li of (q[name]?.line_items ?? []))
    if (/downlight|light|led/i.test(String(li.description ?? li.name ?? ''))) qtys.push(li.qty ?? li.quantity)
console.log(`  downlight line-item quantities: ${JSON.stringify(qtys)}`)
console.log(String(intake.item_count) === '10' && !qtys.includes(6)
  ? '  ==> PASS: counted 10'
  : '  ==> CHECK: item_count or a parts-list qty is not 10')

console.log('\n=== estimate traces ===')
for (const t of (await c.query(
  `select step, substep, status, left(coalesce(message,''),170) message from pipeline_traces where intake_id=$1 order by created_at asc`, [intake.id])).rows)
  console.log(`  ${t.step}/${t.substep ?? '-'} [${t.status}] ${t.message}`)

await c.end()
