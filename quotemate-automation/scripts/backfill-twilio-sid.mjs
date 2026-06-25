// QuoteMate · Backfill tenants.twilio_number_sid from the live Twilio API.
//
//   node --env-file=.env.local scripts/backfill-twilio-sid.mjs          (dry-run)
//   node --env-file=.env.local scripts/backfill-twilio-sid.mjs --apply  (write)
//
// Self-heals the Tenant Health "stub number" false positive (BUG-15): for every
// tenant that has a twilio_sms_number but no twilio_number_sid, ask Twilio for
// the number's Phone Number SID. If Twilio returns one, the number is real →
// stamp twilio_number_sid (so the health check reads it as a real number).
// Numbers Twilio does not recognise were never live (genuine stubs) and are
// left NULL. Idempotent: only touches rows where twilio_number_sid IS NULL.
//
// Needs SUPABASE_DB_URL + TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN in the env.
// Without Twilio creds it exits early — every affected number stays
// "unverified" (never flagged as a stub); re-run later with creds present.

import pg from 'pg'

const { Client } = pg
const APPLY = process.argv.includes('--apply')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

function twilioAuth() {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null
  return { sid, header: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') }
}

// Returns the Twilio Phone Number SID (PN…) for a number, or null when Twilio
// has no record of it (i.e. it was never a live number) or on any API error.
async function getNumberSid(phoneNumber) {
  const a = twilioAuth()
  if (!a) return null
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${a.sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`
    const res = await fetch(url, { headers: { Authorization: a.header } })
    if (!res.ok) return null
    const json = await res.json()
    return json.incoming_phone_numbers?.[0]?.sid ?? null
  } catch {
    return null
  }
}

const auth = twilioAuth()
if (!auth) {
  console.error('Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN — cannot verify numbers against Twilio.')
  console.error('Without creds every affected number stays "unverified" (never flagged stub). Re-run with creds present.')
  process.exit(1)
}

const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  const { rows } = await c.query(
    `select id, business_name, twilio_sms_number
       from tenants
      where twilio_sms_number is not null
        and twilio_number_sid is null
      order by created_at desc`,
  )

  console.log(`\n${rows.length} tenant(s) with a number but no twilio_number_sid.`)
  console.log(`Mode: ${APPLY ? 'APPLY (will write)' : 'DRY-RUN (read-only)'}\n`)

  let real = 0
  let unrecognised = 0
  for (const t of rows) {
    const sid = await getNumberSid(t.twilio_sms_number)
    const who = t.business_name ?? t.id
    if (sid) {
      real++
      console.log(`  [REAL]  ${who}  ${t.twilio_sms_number} → ${sid}`)
      if (APPLY) {
        await c.query('update tenants set twilio_number_sid = $1 where id = $2', [sid, t.id])
      }
    } else {
      unrecognised++
      console.log(`  [stub]  ${who}  ${t.twilio_sms_number} → Twilio has no record (left NULL)`)
    }
  }

  console.log(
    `\nDone. ${real} real (SID ${APPLY ? 'written' : 'to write'}), ` +
      `${unrecognised} unrecognised (left NULL).`,
  )
  if (!APPLY && real > 0) console.log('Re-run with --apply to persist.')
} catch (err) {
  console.error('backfill-twilio-sid failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
