// SMS receptionist test controller (Sparky).
// Subcommands:
//   show           — recent conversations for the test sender
//   reset          — age out last_message_at so the NEXT inbound starts a fresh conversation
//   convo          — full dump of the latest conversation: messages (in/out), intake, quote tiers
//   messages       — just the message transcript of the latest conversation
// Usage: node --env-file=.env.local scripts/sms-test-ctl.mjs <cmd>

import pg from 'pg'

const SENDER = process.env.TEST_SENDER || '+61489083371'   // harness "from" (test customer)
const SPARKY = '6dca084c-10d5-4459-b48f-9b45e4bbc68a'
const cmd = process.argv[2] || 'show'

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const L = (s = '') => console.log(s)
const age = (ts) => ts ? `${Math.round((Date.now() - new Date(ts).getTime()) / 1000)}s ago` : '(never)'

async function latestConvo() {
  const { rows } = await c.query(
    `select * from sms_conversations where from_number = $1 and tenant_id = $2
       order by last_message_at desc nulls last limit 1`, [SENDER, SPARKY])
  return rows[0]
}

function fmtTier(name, t) {
  if (!t) { L(`  ${name}: (none)`); return }
  L(`  ${name.toUpperCase()} — "${t.label ?? ''}"  | ${t.timeframe ?? ''} | subtotal_ex_gst=$${t.subtotal_ex_gst}`)
  for (const li of t.line_items ?? []) {
    const src = li.source ?? '?'
    const tag = src.startsWith('material') ? '🧱' : src === 'labour' ? '🔧' : '•'
    L(`     ${tag} ${String(li.description).padEnd(46)} ${String(li.quantity).padStart(3)} ${String(li.unit).padEnd(5)} @ $${li.unit_price_ex_gst} = $${li.total_ex_gst}   [${src}]${li.supplied_by ? ' supplied_by=' + li.supplied_by : ''}`)
  }
}

if (cmd === 'show') {
  const { rows } = await c.query(
    `select id, status, turn_count, intake_id, last_message_at, created_at,
            conversation_state->'slots' as slots
       from sms_conversations where from_number = $1
       order by last_message_at desc nulls last limit 8`, [SENDER])
  L(`Recent conversations for ${SENDER}:`)
  for (const r of rows) {
    L(`  ${r.id} | status=${String(r.status).padEnd(11)} | turns=${r.turn_count ?? 0} | intake=${r.intake_id ? 'yes' : 'no '} | ${age(r.last_message_at)}`)
    if (r.slots && Object.keys(r.slots).length) L(`        slots=${JSON.stringify(r.slots)}`)
  }
}

else if (cmd === 'reset') {
  const { rowCount } = await c.query(
    `update sms_conversations set last_message_at = now() - interval '6 hours', status = 'done'
       where from_number = $1 and tenant_id = $2
         and (status <> 'done' or last_message_at > now() - interval '6 hours')`,
    [SENDER, SPARKY])
  L(`reset: aged out ${rowCount} conversation(s) for ${SENDER} → next inbound starts FRESH`)
}

else if (cmd === 'messages' || cmd === 'convo') {
  const cv = await latestConvo()
  if (!cv) { L('no conversation for the test sender + Sparky'); await c.end(); process.exit(0) }
  L(`CONVERSATION ${cv.id}`)
  L(`  status=${cv.status} | turns=${cv.turn_count} | last=${age(cv.last_message_at)} | intake=${cv.intake_id ?? '(none)'}`)
  const slots = cv.conversation_state?.slots ?? {}
  if (Object.keys(slots).length) L(`  slots=${JSON.stringify(slots)}`)
  if (cv.product_choice) L(`  product_choice=${JSON.stringify(cv.product_choice)}`)

  const { rows: msgs } = await c.query(
    `select direction, body, created_at from sms_messages where conversation_id = $1 order by created_at asc`, [cv.id])
  L(`\n  ── transcript (${msgs.length} msgs) ──`)
  for (const m of msgs) {
    const who = m.direction === 'inbound' ? '👤 CUST' : '🤖 AGENT'
    L(`  ${who}: ${String(m.body).replace(/\n/g, '\n           ')}`)
  }

  if (cmd === 'convo' && cv.intake_id) {
    const { rows: ins } = await c.query(`select * from intakes where id = $1`, [cv.intake_id])
    const ik = ins[0]
    if (ik) {
      L(`\n  ── intake ${ik.id} ──`)
      L(`  trade=${ik.trade} | job_type=${ik.job_type} | confidence=${ik.confidence} | inspection_required=${ik.inspection_required}`)
      L(`  scope=${JSON.stringify(ik.scope)}`)
      L(`  property=${JSON.stringify(ik.property)} access=${JSON.stringify(ik.access)} risks=${JSON.stringify(ik.risks)}`)
    }
    const { rows: qs } = await c.query(
      `select * from quotes where intake_id = $1 order by created_at desc limit 1`, [cv.intake_id])
    const q = qs[0]
    if (!q) { L('\n  (no quote drafted yet)') }
    else {
      L(`\n  ── quote ${q.id} ──`)
      L(`  status=${q.status} | routing=${q.routing_decision} | needs_inspection=${q.needs_inspection}${q.inspection_reason ? ' (' + q.inspection_reason + ')' : ''}`)
      L(`  totals: subtotal_ex=$${q.subtotal_ex_gst} gst=$${q.gst} total_inc=$${q.total_inc_gst} | selected_tier=${q.selected_tier} | display=${q.display_mode}`)
      L(`  scope_of_works=${q.scope_of_works}`)
      if (q.assumptions) L(`  assumptions=${JSON.stringify(q.assumptions)}`)
      L('')
      fmtTier('good', q.good); fmtTier('better', q.better); fmtTier('best', q.best)
      if (q.optional_upsells) L(`\n  upsells=${JSON.stringify(q.optional_upsells)}`)
    }
  }
}

else { L(`unknown cmd: ${cmd}`) }

await c.end()
