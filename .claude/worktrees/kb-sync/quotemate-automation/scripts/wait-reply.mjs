// Poll the DB for the Sparky receptionist's reply to the latest test inbound.
// Waits until an AGENT (outbound) message appears AFTER the most recent
// CUSTOMER (inbound) message in a freshly-active conversation, or times out.
// Usage: node --env-file=.env.local scripts/wait-reply.mjs [timeoutSec]

import pg from 'pg'
const SENDER = process.env.TEST_SENDER || '+61489083371'
const SPARKY = '6dca084c-10d5-4459-b48f-9b45e4bbc68a'
const TIMEOUT = (Number(process.argv[2]) || 90) * 1000
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const start = Date.now()

let convId = null
let lastSeen = 0
while (Date.now() - start < TIMEOUT) {
  // latest conversation active in the last 5 min
  const { rows: cvs } = await c.query(
    `select id, status, turn_count, intake_id, last_message_at from sms_conversations
       where from_number=$1 and tenant_id=$2 and last_message_at > now() - interval '5 minutes'
       order by last_message_at desc limit 1`, [SENDER, SPARKY])
  if (cvs[0]) {
    convId = cvs[0].id
    const { rows: msgs } = await c.query(
      `select direction, created_at from sms_messages where conversation_id=$1 order by created_at asc`, [convId])
    const lastIn  = [...msgs].reverse().find(m => m.direction === 'inbound')
    const lastOut = [...msgs].reverse().find(m => m.direction === 'outbound')
    const outCount = msgs.filter(m => m.direction === 'outbound').length
    if (lastIn && lastOut && new Date(lastOut.created_at) > new Date(lastIn.created_at)) {
      // agent has replied to the most recent customer msg
      const { rows: full } = await c.query(
        `select direction, body, created_at from sms_messages where conversation_id=$1 order by created_at asc`, [convId])
      console.log(`✅ reply received (conv ${convId}, status=${cvs[0].status}, turns=${cvs[0].turn_count}, intake=${cvs[0].intake_id ? 'yes' : 'no'}, ${Math.round((Date.now()-start)/1000)}s)\n`)
      for (const m of full) {
        const who = m.direction === 'inbound' ? '👤 CUST ' : '🤖 AGENT'
        console.log(`${who}: ${String(m.body).replace(/\n/g, '\n         ')}\n`)
      }
      await c.end(); process.exit(0)
    }
    if (outCount !== lastSeen) { lastSeen = outCount; process.stdout.write(`   …waiting (conv active, ${outCount} agent msgs so far)\n`) }
  }
  await sleep(3000)
}
console.log(`⏱  timed out after ${TIMEOUT/1000}s${convId ? ` (conv ${convId} active but no new agent reply)` : ' (no active conversation — inbound may not have arrived)'}`)
await c.end()
