// Poll until the latest test conversation has a drafted quote (intake_id + quotes row),
// then print the new agent messages. Usage: node --env-file=.env.local scripts/wait-quote.mjs [timeoutSec]
import pg from 'pg'
const SENDER = process.env.TEST_SENDER || '+61489083371'
const SPARKY = '6dca084c-10d5-4459-b48f-9b45e4bbc68a'
const TIMEOUT = (Number(process.argv[2]) || 150) * 1000
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const start = Date.now()
while (Date.now() - start < TIMEOUT) {
  const { rows } = await c.query(
    `select id, status, intake_id from sms_conversations
       where from_number=$1 and tenant_id=$2 and last_message_at > now() - interval '15 minutes'
       order by last_message_at desc limit 1`, [SENDER, SPARKY])
  const cv = rows[0]
  if (cv?.intake_id) {
    const { rows: qs } = await c.query(`select id from quotes where intake_id=$1 limit 1`, [cv.intake_id])
    if (qs.length) { console.log(`✅ quote drafted after ${Math.round((Date.now()-start)/1000)}s (conv ${cv.id}, status=${cv.status})`); await c.end(); process.exit(0) }
  }
  await sleep(4000)
}
console.log(`⏱  timed out after ${TIMEOUT/1000}s — no quote yet`)
await c.end()
