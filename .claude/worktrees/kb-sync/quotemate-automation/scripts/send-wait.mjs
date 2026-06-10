// Send one SMS turn through the n8n harness to the Sparky receptionist,
// then poll the DB for the agent's reply and print the running transcript.
// Usage: node --env-file=.env.local scripts/send-wait.mjs "message text" [timeoutSec]

import pg from 'pg'

const WEBHOOK = process.env.HARNESS_WEBHOOK || 'https://n8n.nomanuai.com/webhook/sms-test-send'
const SENDER  = process.env.TEST_SENDER || '+61489083371'
const SPARKY_NUM = process.env.SPARKY_NUM || '+61468048422'
const SPARKY  = '6dca084c-10d5-4459-b48f-9b45e4bbc68a'

const message = process.argv[2]
const TIMEOUT = (Number(process.argv[3]) || 110) * 1000
if (!message) { console.error('pass a message'); process.exit(1) }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

// baseline: outbound count in the currently-active conversation (if any)
async function activeConv() {
  const { rows } = await c.query(
    `select id, status, turn_count, intake_id from sms_conversations
       where from_number=$1 and tenant_id=$2 and last_message_at > now() - interval '5 minutes'
       order by last_message_at desc limit 1`, [SENDER, SPARKY])
  return rows[0] || null
}
async function counts(convId) {
  if (!convId) return { inbound: 0, outbound: 0 }
  const { rows } = await c.query(
    `select direction, count(*)::int n from sms_messages where conversation_id=$1 group by direction`, [convId])
  const m = { inbound: 0, outbound: 0 }
  for (const r of rows) m[r.direction] = r.n
  return m
}

const before = await activeConv()
const baseOut = (await counts(before?.id)).outbound

// fire the send through the harness
const res = await fetch(WEBHOOK, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message, to: SPARKY_NUM, from: SENDER }),
})
console.log(`➡️  SENT (${res.status}): "${message}"\n`)

// poll for a NEW outbound message beyond baseline
const start = Date.now()
let printed = baseOut
while (Date.now() - start < TIMEOUT) {
  await sleep(3000)
  const cv = await activeConv()
  if (!cv) continue
  const cnt = await counts(cv.id)
  if (cnt.outbound > baseOut || (before && cv.id !== before.id && cnt.outbound > 0)) {
    // got a fresh reply — print full transcript + state, then exit
    const { rows: msgs } = await c.query(
      `select direction, body from sms_messages where conversation_id=$1 order by created_at asc`, [cv.id])
    console.log(`✅ reply (conv ${cv.id} | status=${cv.status} | turns=${cv.turn_count} | intake=${cv.intake_id ? 'YES' : 'no'} | ${Math.round((Date.now()-start)/1000)}s)\n`)
    for (const m of msgs) {
      const who = m.direction === 'inbound' ? '👤 CUST ' : '🤖 AGENT'
      console.log(`${who}: ${String(m.body).replace(/\n/g, '\n         ')}\n`)
    }
    if (cv.intake_id) console.log(`📐 intake created (${cv.intake_id}) → run:  node --env-file=.env.local scripts/sms-test-ctl.mjs convo`)
    await c.end(); process.exit(0)
  }
}
console.log(`⏱  timed out after ${TIMEOUT/1000}s with no new agent reply`)
await c.end()
