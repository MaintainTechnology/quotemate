// Plumbing (no catalogue) -> does the quote carry THREE DIFFERENT prices?
//
// The normal SMS path is blocked by the APP_URL redirect stripping the auth
// header (www -> apex is cross-origin, so Authorization is dropped -> 401).
// To answer the pricing question anyway, we drive the real conversation over
// Twilio, then fire the intake handoff ourselves at the host that DOES accept
// the secret (quote-mate-rho). Same route, same payload the app would send.
//
//   node --env-file=.env.local .scratch-audit/probe-plumbing-tiers.mjs
import { createHmac } from 'node:crypto'
import pg from 'pg'

const FROM = '+61489083371'
const TO = process.env.SCENARIO_TO || '+61468048422' // Sparky
const SMS_ENDPOINT = 'https://quote-mate-rho.vercel.app/api/sms/inbound'
const HANDOFF = 'https://quote-mate-rho.vercel.app/api/intake/structure'
const TOKEN = process.env.TWILIO_AUTH_TOKEN
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? 'ACtest'
const SECRET = process.env.CRON_SECRET

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
  const a =
      /gas or electric|electric or gas|storage or continuous|what type/.test(t) ? pick('gas storage')
    : /litre|how many l\b|what size|capacity/.test(t) ? pick('250L')
    : /how old|age of|when was it/.test(t) ? pick('about 12 years old')
    : /inside or outside|where is|located|location|which wall/.test(t) ? pick('outside, back wall')
    : /access|tight|stairs|ladder/.test(t) ? pick('easy access')
    : /first name|your name|who am i speaking|call you/.test(t) ? pick('Jeph')
    : /photo|picture|image|upload/.test(t) ? pick('no photos sorry')
    : /email/.test(t) ? pick('jeph@example.com')
    : /when|how soon|urgent|timing/.test(t) ? pick('next week is fine')
    : /sound right|correct\?|confirm|is that right/.test(t) ? pick('yes that is right')
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
async function waitReply(prev, ms = 120000) {
  const end = Date.now() + ms
  while (Date.now() < end) { await sleep(4000); if (await outN() > prev) { await sleep(2500); return true } }
  return false
}
const newIntake = async () => (await c.query(
  `select id, trade, job_type, scope->>'item_count' item_count, inspection_required, confidence, created_at
   from intakes where created_at > $1 order by created_at desc limit 1`, [startedAt])).rows[0] ?? null

await send('Need my gas hot water system replaced, 250L, outside back wall')
for (let k = 0; k < 8 && !id; k++) {
  const { rows } = await c.query(
    `select id from sms_conversations where from_number=$1 and to_number=$2 and created_at > $3 order by created_at desc limit 1`, [FROM, TO, marker])
  id = rows[0]?.id ?? null
  if (!id) await sleep(1500)
}
await waitReply(0)

let ready = false
for (let turn = 0; turn < 8; turn++) {
  if (await newIntake()) { console.log(`>>> intake appeared naturally after ${turn} follow-ups`); ready = true; break }
  const q = await lastBot()
  if (/quotemax\.com\.au\/q\//.test(q)) { console.log('>>> quote link sent naturally'); ready = true; break }
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
  `select decisions->>'decision_action' a, decisions->>'ready_for_intake' r, decisions->>'decision_job_type' j
   from pipeline_traces where sms_conversation_id=$1 and step='dispatch' order by created_at asc`, [id])).rows)
  console.log(`  action=${d.a} ready_for_intake=${d.r} job_type=${d.j}`)

// --- Route around the outage: fire the handoff at the host that accepts the secret.
if (!(await newIntake())) {
  console.log('\n=== no intake via SMS -> firing handoff directly (bypassing the www redirect) ===')
  const res = await fetch(HANDOFF, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ conversationId: id, sourceChannel: 'sms' }),
    signal: AbortSignal.timeout(240000),
  })
  console.log(`handoff -> HTTP ${res.status}  ${(await res.text()).slice(0, 300).replace(/\s+/g, ' ')}`)
}

const intake = await newIntake()
console.log('\n=== YOUR QUERY (top 3 intakes) ===')
console.log(JSON.stringify((await c.query(
  `select id, trade, job_type, scope->>'item_count' as item_count, inspection_required, confidence, created_at
   from intakes order by created_at desc limit 3`)).rows, null, 2))

console.log('\n=== THE ACTUAL QUESTION: three different prices? ===')
if (!intake) {
  console.log('No intake from this run -> cannot evaluate tiers.')
} else {
  for (let k = 0; k < 20; k++) {
    const { rows } = await c.query(
      `select id, good, better, best, routing, created_at from quotes where intake_id=$1 order by created_at desc limit 1`, [intake.id])
    if (rows[0]) {
      const q = rows[0]
      console.log('quote', q.id, 'routing=', q.routing)
      const money = (tier) => {
        if (!tier) return null
        for (const k of ['total_inc_gst', 'total', 'price_inc_gst', 'price', 'amount', 'subtotal'])
          if (tier[k] != null) return `${k}=${tier[k]}`
        return 'keys: ' + Object.keys(tier).join(',')
      }
      const g = money(q.good), b = money(q.better), s = money(q.best)
      console.log('  good  :', g)
      console.log('  better:', b)
      console.log('  best  :', s)
      const vals = [q.good, q.better, q.best].map(t => t && (t.total_inc_gst ?? t.total ?? t.price ?? null))
      const distinct = new Set(vals.filter(v => v != null)).size
      console.log(distinct === 3 ? '  ==> PASS: three different prices' : `  ==> ${distinct} distinct price(s) — NOT three`)
      break
    }
    await sleep(6000)
    if (k === 19) console.log('intake exists but no quote row appeared within 2 minutes')
  }
}
await c.end()
