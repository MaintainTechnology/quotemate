// QuoteMate · MMS feasibility check for the SMS estimator (F6).
// Lists every Twilio number on the account with its sms/mms/voice
// capability flags — the authoritative answer to "can we attach the
// report PDF as MMS media on this number?".
// Usage: node --env-file=.env.local scripts/check-twilio-mms.mjs

const sid = process.env.TWILIO_ACCOUNT_SID
const tok = process.env.TWILIO_AUTH_TOKEN
if (!sid || !tok) {
  console.error('Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN')
  process.exit(1)
}

const res = await fetch(
  `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=20`,
  {
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64') },
    signal: AbortSignal.timeout(30_000),
  },
)
if (!res.ok) {
  console.error('Twilio API error:', res.status, await res.text())
  process.exit(1)
}
const json = await res.json()
const numbers = json.incoming_phone_numbers ?? []
if (numbers.length === 0) {
  console.log('No incoming phone numbers on this account.')
}
for (const n of numbers) {
  console.log(
    `${n.phone_number}  sms=${n.capabilities.sms}  mms=${n.capabilities.mms}  voice=${n.capabilities.voice}  (${n.friendly_name ?? ''})`,
  )
}
