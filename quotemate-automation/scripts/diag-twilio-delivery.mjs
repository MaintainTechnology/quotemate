// What did Twilio actually DO with our outbound messages? The DB logs an
// sms_messages row even when delivery later fails, so this is the only
// place the truth lives. Shows status + error code per message.
// Usage: node --env-file=.env.local scripts/diag-twilio-delivery.mjs [+61...] [limit]

const to = process.argv[2] || '+61414530836'
const limit = Number(process.argv[3] || 15)

const sid = process.env.TWILIO_ACCOUNT_SID
const token = process.env.TWILIO_AUTH_TOKEN
if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set')

const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json?To=${encodeURIComponent(to)}&PageSize=${limit}`
const res = await fetch(url, {
  headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') },
})
if (!res.ok) throw new Error(`Twilio API ${res.status}: ${await res.text()}`)
const { messages } = await res.json()

console.log(`\n=== last ${messages.length} outbound Twilio messages to ${to} ===\n`)
for (const m of messages.reverse()) {
  const flag = ['failed', 'undelivered'].includes(m.status) ? ' <<< NOT DELIVERED' : ''
  console.log(
    `${m.date_sent || m.date_created} | ${String(m.status).padEnd(11)} | err=${m.error_code ?? '-'} | media=${m.num_media} | ${String(m.body ?? '').replace(/\s+/g, ' ').slice(0, 70)}${flag}`,
  )
  if (m.error_message) console.log(`    ↳ ${m.error_message}`)
}

const bad = messages.filter((m) => ['failed', 'undelivered'].includes(m.status))
console.log(`\n${bad.length} of ${messages.length} did NOT reach the handset.`)
