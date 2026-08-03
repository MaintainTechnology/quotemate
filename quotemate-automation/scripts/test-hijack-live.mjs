#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// test-hijack-live.mjs — drive the 2026-07-31 hijack transcript through the
// LIVE SMS receptionist and report which trade handled each turn.
//
//   node --env-file=.env.local scripts/test-hijack-live.mjs --dry
//   node --env-file=.env.local scripts/test-hijack-live.mjs --from +61481613464
//   node --env-file=.env.local scripts/test-hijack-live.mjs --verdict-only
//
// WHAT IT TESTS. On 2026-07-31 an electrical enquiry (16 downlights) was taken
// over by the ROOFING receptionist when the customer answered the dialog's own
// question — "what's the ceiling type?" — with "It's a 125mm insulated panel
// roofing". The word 'roofing' matched a keyword. The customer said downlights
// four more times and was offered a $99 ROOFING inspection.
//
// HOW IT SENDS. Real SMS via the Twilio REST API, from a number on your own
// account to the tenant's provisioned number. It does NOT forge a webhook
// signature: app/api/sms/inbound/route.ts validates X-Twilio-Signature and
// 403s a fake, which is correct, so the only honest test is a real message.
//
// ⚠ THIS COSTS MONEY AND WRITES REAL DATA. Each run sends 5 outbound SMS,
// receives ~5 replies, and creates a real sms_conversations row, an intake and
// possibly a quote on a live tenant. Run --dry first.
//
// PACING. It waits for the bot's REPLY between messages rather than sleeping a
// fixed interval. That matters: route.ts holds a 60s inflight lock and a turn
// can take 200s+ when a measure runs, so fixed sleeps either race the lock or
// waste minutes.
// ─────────────────────────────────────────────────────────────────────────

import pg from 'pg'

const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const VERDICT_ONLY = args.includes('--verdict-only')
const argOf = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

// Atomic Electrical — 8 trades, and the tenant the failure happened on.
const TO = argOf('--to', '+61468011464')
// A CLEAN customer number: on the account, SMS-capable, assigned to no tenant,
// and with ZERO existing threads to Atomic Electrical. That last part is the
// point — a warm thread resumes its old roofing_state and can make a working
// build read as a failure.
//
// +61489083371 also works and is the number most past testing used, but it has
// 225 conversations behind it, so the state you inherit is unpredictable.
//
// ⚠ NOT process.env.TWILIO_PHONE_NUMBER. That is +61745180330, an 07 landline
// prefix that is not among the account's IncomingPhoneNumbers at all — the
// send would fail with a Twilio 21606 and read like a receptionist bug.
const FROM = argOf('--from', '+61481613464')
const REPLY_TIMEOUT_MS = Number(argOf('--timeout', '180')) * 1000

// The customer's side of the real transcript. Turn 5 IS the test.
const SCRIPT = [
  'Can I have some downlights put in',
  'Jon',
  'Chandler',
  '16 downlights on my verandah',
  "It's a 125mm insulated panel roofing. The cable has been run already.",
]

const SID = process.env.TWILIO_ACCOUNT_SID
const TOKEN = process.env.TWILIO_AUTH_TOKEN
const DB = process.env.SUPABASE_DB_URL

function die(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

const db = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } })

async function sendSms(body) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: FROM, To: TO, Body: body }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) die(`Twilio ${res.status}: ${j.message ?? JSON.stringify(j).slice(0, 200)}`)
  return j.sid
}

/** Wait until an OUTBOUND message newer than `since` lands for this thread. */
async function waitForReply(since) {
  const deadline = Date.now() + REPLY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const { rows } = await db.query(
      `select body, created_at from sms_messages
        where conversation_id in (
          select id from sms_conversations where from_number = $1 and to_number = $2
        )
          and direction = 'outbound' and created_at > $3
        order by created_at asc limit 1`,
      [FROM, TO, since],
    )
    if (rows[0]) return rows[0]
    await new Promise((r) => setTimeout(r, 4000))
  }
  return null
}

/** Which receptionist owned each turn, and did the guard hold? */
async function verdict() {
  const { rows: convs } = await db.query(
    `select id, turn_count, status, conversation_state, roofing_state, painting_state,
            intake_id, created_at
       from sms_conversations
      where from_number = $1 and to_number = $2
      order by created_at desc limit 1`,
    [FROM, TO],
  )
  if (!convs[0]) return void console.log('\nNo conversation found for that number pair.')
  const c = convs[0]

  const { rows: msgs } = await db.query(
    `select direction, body, created_at from sms_messages
      where conversation_id = $1 order by created_at asc`,
    [c.id],
  )

  console.log(`\n══ conversation ${String(c.id).slice(0, 8)} ═══════════════════════════`)
  console.log(`   turn_count=${c.turn_count}  status=${c.status}  intake=${c.intake_id ?? 'none'}`)
  console.log(`   conversation_state.slots  : ${JSON.stringify(c.conversation_state?.slots ?? {})}`)
  console.log(`   conversation_state.sources: ${JSON.stringify(c.conversation_state?.sources ?? {})}`)
  console.log(`   last_extracted_at         : ${c.conversation_state?.last_extracted_at ?? 'null'}`)
  console.log(`   roofing_state             : ${c.roofing_state ? JSON.stringify(c.roofing_state.slots ?? {}) + ' last_step=' + c.roofing_state.last_step : 'NULL'}`)
  console.log(`   painting_state            : ${c.painting_state ? 'PRESENT last_step=' + c.painting_state.last_step : 'NULL'}`)

  console.log('\n── transcript ──────────────────────────────────────────────')
  for (const m of msgs) {
    const t = m.created_at.toISOString().slice(11, 19)
    console.log(`${t} ${m.direction === 'inbound' ? 'IN  ' : 'OUT '} ${m.body.replace(/\n/g, ' ⏎ ')}`)
  }

  // ── the checks ────────────────────────────────────────────────────────
  const out = msgs.filter((m) => m.direction === 'outbound').map((m) => m.body.toLowerCase())
  const checks = [
    ['roofing_state was never created', c.roofing_state === null],
    ['painting_state was never created', c.painting_state === null],
    [
      'no reply fed an answer to the geocoder',
      !out.some((b) => b.includes("can't find") && b.includes('on the map')),
    ],
    [
      'no roofing intent menu was offered',
      !out.some((b) => b.includes('full re-roof') || b.includes('gutters and downpipes')),
    ],
    [
      'no roofing inspection was offered',
      !out.some((b) => b.includes('on-site inspection') && b.includes('roof')),
    ],
    [
      'the electrical gather kept extracting (last_extracted_at set)',
      !!c.conversation_state?.last_extracted_at,
    ],
    [
      'a trade-specific slot was gathered from the transcript',
      Object.entries(c.conversation_state?.sources ?? {}).some(
        ([k, v]) =>
          !['first_name', 'suburb', 'address', 'email', 'verified'].includes(k) &&
          (v === 'from_transcript' || v === 'customer_corrected'),
      ),
    ],
  ]

  console.log('\n── verdict ─────────────────────────────────────────────────')
  let pass = true
  for (const [label, ok] of checks) {
    console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}`)
    if (!ok) pass = false
  }
  console.log(`\n${pass ? '✓ HIJACK GUARD HELD' : '✗ HIJACKED — the guard did not hold'}\n`)
  process.exitCode = pass ? 0 : 1
}

// ── run ─────────────────────────────────────────────────────────────────

if (!DB) die('SUPABASE_DB_URL missing — run with: node --env-file=.env.local ...')
await db.connect()

try {
  if (VERDICT_ONLY) {
    if (!FROM) die('--from is required so the right thread can be found')
    await verdict()
  } else {
    // ── preflight ───────────────────────────────────────────────────────
    console.log('\n══ preflight ═══════════════════════════════════════════════')
    if (!SID || !TOKEN) die('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing')
    if (!FROM) die('No --from number. Pass one you own: --from +614XXXXXXXX')
    if (FROM === TO) die(`--from and --to are both ${TO}. A number cannot text itself.`)
    console.log(`   from ${FROM}  →  to ${TO}`)

    // Verify --from is actually on the account and SMS-capable. Without this a
    // wrong number fails as a Twilio 21606 mid-run, after some messages have
    // already landed, which reads like a receptionist fault.
    const nums = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers.json?PageSize=100`,
      { headers: { Authorization: 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64') } },
    ).then((r) => r.json())
    const mine = (nums.incoming_phone_numbers ?? []).find((n) => n.phone_number === FROM)
    if (!mine) {
      die(
        `${FROM} is not on this Twilio account. Available SMS-capable numbers:\n     ` +
          (nums.incoming_phone_numbers ?? [])
            .filter((n) => n.capabilities?.sms)
            .map((n) => n.phone_number)
            .join('\n     '),
      )
    }
    if (!mine.capabilities?.sms) die(`${FROM} is on the account but is not SMS-capable.`)

    // The fix must actually be deployed, or the test proves nothing.
    const health = await fetch('https://quotemax.com.au/api/health').then((r) => r.json())
    const live = String(health.commit ?? '').slice(0, 8)
    console.log(`   live commit: ${live}`)
    if (live === 'f1e36cca') {
      die('That is the commit from BEFORE the hijack fix. Wait for the deploy.')
    }

    const { rows: t } = await db.query(
      'select business_name, array_length(trades,1) n from tenants where twilio_sms_number = $1',
      [TO],
    )
    if (!t[0]) die(`No tenant owns ${TO}`)
    console.log(`   tenant: ${t[0].business_name} (${t[0].n} trades)`)
    if (t[0].n < 2) {
      console.log('   ⚠ single-trade tenant — the hijack class cannot occur here.')
    }

    // A warm thread from an earlier test will RESUME its old state and make a
    // good build look broken. This is the most likely way to misread the result.
    const { rows: prior } = await db.query(
      `select id, status, roofing_state is not null as had_roofing, created_at
         from sms_conversations where from_number = $1 and to_number = $2
        order by created_at desc limit 1`,
      [FROM, TO],
    )
    if (prior[0]) {
      console.log(
        `   ⚠ EXISTING THREAD ${String(prior[0].id).slice(0, 8)} (${prior[0].status}, roofing_state=${prior[0].had_roofing})`,
      )
      console.log('     A warm thread resumes its old state. For a clean read, use a')
      console.log('     different --from number, or close this thread first.')
    }

    if (DRY) {
      console.log('\n══ DRY RUN — nothing sent ══════════════════════════════════')
      SCRIPT.forEach((m, i) => console.log(`   ${i + 1}. ${m}`))
      console.log('\n   Turn 5 is the test: before the fix it produced')
      console.log('   "Sorry, I can\'t find ... on the map."')
      console.log('\n   Re-run without --dry to send. Costs ~10 SMS and writes live data.\n')
      process.exit(0)
    }

    // ── send, pacing on the bot's replies ───────────────────────────────
    console.log('\n══ sending ═════════════════════════════════════════════════')
    for (let i = 0; i < SCRIPT.length; i++) {
      const mark = new Date()
      const sid = await sendSms(SCRIPT[i])
      console.log(`\n   ${i + 1}/${SCRIPT.length} IN  ${SCRIPT[i]}`)
      console.log(`        sent ${sid}`)
      const reply = await waitForReply(mark)
      if (!reply) {
        console.log(`        ⚠ no reply within ${REPLY_TIMEOUT_MS / 1000}s — continuing`)
        continue
      }
      console.log(`        OUT ${reply.body.replace(/\n/g, ' ⏎ ')}`)
    }

    // Let any after() work (intake, estimate, quote SMS) settle.
    console.log('\n   waiting 30s for background work to settle…')
    await new Promise((r) => setTimeout(r, 30000))
    await verdict()
  }
} catch (err) {
  console.error('\nFAILED:', err.message ?? err)
  process.exitCode = 1
} finally {
  await db.end()
}
