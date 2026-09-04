// ═══════════════════════════════════════════════════════════════════
// EV charger SMS end-to-end driver — REAL Twilio, real tenant.
//
// Drives a conversation against a tenant's provisioned number by
// actually sending SMS/MMS through Twilio, then reads the agent's
// replies back off the Twilio Messages API (not the phone), so the
// whole loop is scriptable.
//
// Subcommands:
//   reset                 close any open conversation for the test sender
//   send "<text>"         send one SMS, then poll for replies
//   mms "<text>" <url>    send one MMS with a media URL, then poll
//   poll [seconds]        just poll for new replies
//   convo                 dump the DB view: messages, slots, intake, quote
//
// Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, SUPABASE_DB_URL
// Run: node --env-file=.env.local scripts/ev-sms-e2e.mjs <cmd>
//
// SENDS REAL SMS. Costs money. Only point it at numbers you own.
// ═══════════════════════════════════════════════════════════════════
import twilio from 'twilio'
import pg from 'pg'

const AGENT = process.env.EV_E2E_AGENT ?? '+61468048422'      // Sparky
const SENDER = process.env.EV_E2E_SENDER ?? '+61489083371'    // test customer (owned)
const TENANT = process.env.EV_E2E_TENANT ?? '6dca084c-10d5-4459-b48f-9b45e4bbc68a'
const POLL_SECONDS = Number(process.env.EV_E2E_POLL ?? 75)

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const L = (s = '') => console.log(s)
const hhmm = (d) => new Date(d).toISOString().slice(11, 19)

async function db() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  return c
}

/** Replies the agent sent to our test sender after `since`. */
async function repliesSince(since) {
  const out = await client.messages.list({ from: AGENT, to: SENDER, limit: 30 })
  return out
    .filter((m) => new Date(m.dateCreated) > since)
    .sort((a, b) => new Date(a.dateCreated) - new Date(b.dateCreated))
}

async function poll(seconds = POLL_SECONDS, since = new Date(Date.now() - 5000)) {
  const seen = new Set()
  const deadline = Date.now() + seconds * 1000
  let quiet = 0
  while (Date.now() < deadline) {
    await sleep(5000)
    const rs = await repliesSince(since)
    let fresh = 0
    for (const m of rs) {
      // Both numbers live in one Twilio account, so Twilio records two legs
      // per SMS (outbound from the agent + inbound to us). Dedupe on body.
      if (seen.has(m.body)) continue
      seen.add(m.body)
      fresh++
      L(`  ← [${hhmm(m.dateCreated)}] ${m.status}${m.errorCode ? ` err=${m.errorCode}` : ''}`)
      L(`    ${m.body.replace(/\n/g, '\n    ')}`)
    }
    // Two consecutive quiet polls after at least one reply = turn is done.
    if (fresh === 0 && seen.size > 0) { if (++quiet >= 2) break } else { quiet = 0 }
  }
  if (seen.size === 0) L('  ← (NO REPLY within ' + seconds + 's)  *** HANG / FAILURE ***')
  return seen.size
}

async function send(body, mediaUrl) {
  const since = new Date()
  const payload = { to: AGENT, from: SENDER }
  // A photo sent with NO caption is the most natural reply to "send us a
  // photo", and Twilio posts an EMPTY Body for it — the exact shape that
  // used to 400 at the missing-fields guard (spec blocker B5). Omit `body`
  // entirely so we reproduce it faithfully.
  if (body) payload.body = body
  if (mediaUrl) payload.mediaUrl = [mediaUrl]
  const m = await client.messages.create(payload)
  L(`  → [${hhmm(Date.now())}] ${body}${mediaUrl ? `  [MMS: ${mediaUrl}]` : ''}`)
  L(`    (sid=${m.sid} status=${m.status})`)
  await sleep(3000)
  const chk = await client.messages(m.sid).fetch()
  if (chk.errorCode) L(`    !! outbound error ${chk.errorCode}: ${chk.errorMessage}`)
  return poll(POLL_SECONDS, since)
}

async function reset() {
  const c = await db()
  const { rowCount } = await c.query(
    `update sms_conversations
        set status = 'closed', last_message_at = now() - interval '30 days'
      where from_number = $1 and tenant_id = $2 and status <> 'closed'`,
    [SENDER, TENANT])
  L(`reset: closed ${rowCount} open conversation(s) for ${SENDER} on tenant ${TENANT}`)
  await c.end()
}

async function convo() {
  const c = await db()
  const { rows: cv } = await c.query(
    `select * from sms_conversations where from_number=$1 and tenant_id=$2
      order by last_message_at desc nulls last limit 1`, [SENDER, TENANT])
  if (!cv.length) { L('no conversation'); await c.end(); return }
  const v = cv[0]
  L(`conversation ${v.id}`)
  L(`  status=${v.status} turns=${v.turn_count} type=${v.conversation_type} intake=${v.intake_id ?? '(none)'}`)
  L(`  slots=${JSON.stringify(v.conversation_state?.slots ?? {})}`)
  const st = { ...(v.conversation_state ?? {}) }; delete st.slots
  L(`  state=${JSON.stringify(st).slice(0, 600)}`)

  const { rows: ms } = await c.query(
    `select direction, body, created_at from sms_messages
      where conversation_id=$1 order by created_at`, [v.id])
  L(`\n  transcript (${ms.length}):`)
  for (const m of ms)
    L(`   ${m.direction === 'inbound' ? '→' : '←'} [${hhmm(m.created_at)}] ${String(m.body).replace(/\n/g, ' ')}`)

  if (v.intake_id) {
    const { rows: iq } = await c.query(
      `select i.job_type, i.trade, i.address, i.created_at intake_at,
              q.id quote_id, q.needs_inspection, q.inspection_cause, q.share_token,
              (q.good->>'subtotal_ex_gst') good, (q.better->>'subtotal_ex_gst') better,
              (q.best->>'subtotal_ex_gst') best
         from intakes i left join quotes q on q.intake_id = i.id where i.id = $1`, [v.intake_id])
    L(`\n  intake/quote: ${JSON.stringify(iq[0], null, 1)}`)
  }
  await c.end()
}

const [cmd, a, b] = process.argv.slice(2)
L(`\n[${SENDER} → ${AGENT}]  cmd=${cmd}\n`)
if (cmd === 'reset') await reset()
else if (cmd === 'send') await send(a)
else if (cmd === 'mms') await send(a, b)
// Photo with NO caption — Twilio posts an empty Body (spec blocker B5).
// Its own subcommand because a shell drops a bare "" argument.
else if (cmd === 'mmsonly') await send('', a)
else if (cmd === 'poll') await poll(Number(a ?? POLL_SECONDS))
else if (cmd === 'convo') await convo()
else L('usage: reset | send "text" | mms "text" <mediaUrl> | poll [s] | convo')
process.exit(0)
