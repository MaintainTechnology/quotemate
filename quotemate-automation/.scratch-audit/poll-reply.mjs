// Poll the sms_messages transcript for the harness pair until the bot has
// replied to the LATEST inbound (any outbound newer than it), settle 3s
// for multi-message replies, then print the tail.
import pg from 'pg'

// node --env-file=.env.local .scratch-audit/poll-reply.mjs [toNumber] [tailLines]
const FROM = '+61489083371' // harness customer
const TO = process.argv[2] || '+61468048422' // tenant number (default QM Sparky)
const TAIL = Number(process.argv[3] || 4)

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

async function fetchMsgs() {
  const convo = await c.query(
    `select id from sms_conversations where from_number = $1 and to_number = $2
       order by last_message_at desc nulls last, created_at desc limit 1`,
    [FROM, TO],
  )
  if (!convo.rows[0]) return []
  const msgs = await c.query(
    `select direction, body, created_at from sms_messages
      where conversation_id = $1 order by created_at asc`,
    [convo.rows[0].id],
  )
  return msgs.rows
}

const deadline = Date.now() + 90_000
let rows = []
for (;;) {
  rows = await fetchMsgs()
  const lastIn = [...rows].reverse().find((r) => r.direction === 'inbound')
  const answered = lastIn && rows.some(
    (r) => r.direction === 'outbound' && new Date(r.created_at) > new Date(lastIn.created_at),
  )
  if (answered) {
    await new Promise((r) => setTimeout(r, 3000)) // settle for multi-part replies
    rows = await fetchMsgs()
    break
  }
  if (Date.now() > deadline) { console.log('TIMEOUT waiting for reply'); break }
  await new Promise((r) => setTimeout(r, 2000))
}
for (const m of rows.slice(-TAIL)) {
  const t = new Date(m.created_at).toISOString().slice(11, 19)
  console.log(`${t} ${m.direction === 'inbound' ? 'CUSTOMER' : 'BOT     '} | ${m.body.replace(/\n/g, ' ¶ ')}`)
}
await c.end()
