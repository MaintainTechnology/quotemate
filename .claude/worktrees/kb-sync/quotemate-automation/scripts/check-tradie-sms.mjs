import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const SPARKY = '6dca084c-10d5-4459-b48f-9b45e4bbc68a'
const SPARKY_FROM = '+61468048422'
const OWNER_TO = '+61480808517'

// 1. Last 8 Sparky quotes — show share_token + status + created_at
const { data: quotes } = await supabase
  .from('quotes')
  .select('id, share_token, status, total_inc_gst, created_at')
  .eq('tenant_id', SPARKY)
  .order('created_at', { ascending: false })
  .limit(8)

console.log('=== Last 8 Sparky quotes ===')
for (const q of quotes ?? []) {
  console.log(`  ${q.created_at}  ${q.id.slice(0,8)}  token=${q.share_token}  status=${q.status}  $${q.total_inc_gst}`)
}

// 2. Twilio — full outbound list from Sparky number over the last 2 hours
const sid = process.env.TWILIO_ACCOUNT_SID
const tok = process.env.TWILIO_AUTH_TOKEN
const auth = Buffer.from(`${sid}:${tok}`).toString('base64')

const resp = await fetch(
  `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json?From=${encodeURIComponent(SPARKY_FROM)}&PageSize=50`,
  { headers: { Authorization: `Basic ${auth}` } },
)
if (!resp.ok) { console.log('Twilio HTTP', resp.status, await resp.text()); process.exit(0) }
const { messages } = await resp.json()

console.log(`\n=== Outbound from ${SPARKY_FROM} — last 50 messages ===\n`)
// Show only tradie-notify-like messages first (Hi Jeph / quote ready / review)
const tradieNotifies = (messages ?? []).filter(m =>
  /Hi Jeph|quote ready|for your review|Tap to send|review-all is on/i.test(m.body ?? '')
)
console.log(`Tradie review SMS messages: ${tradieNotifies.length}\n`)
for (const m of tradieNotifies) {
  console.log(`  ${m.date_sent ?? m.date_created}  to=${m.to}  status=${m.status}  err=${m.error_code ?? '-'}`)
  console.log(`    body: ${(m.body ?? '').slice(0, 240)}`)
  console.log()
}

// Also search for the older share_token specifically
const OLDER_TOKEN = 'yJ2ksAFtpu5qlyr3FL_RSA'
const olderTokenMatches = (messages ?? []).filter(m => (m.body ?? '').includes(OLDER_TOKEN))
console.log(`\nMessages mentioning share_token ${OLDER_TOKEN}: ${olderTokenMatches.length}`)
for (const m of olderTokenMatches) {
  console.log(`  ${m.date_sent}  to=${m.to}  status=${m.status}`)
  console.log(`    body: ${(m.body ?? '').slice(0, 240)}`)
}

// And — was the original db0f7864 quote ever sent to the customer or tradie?
console.log('\n=== Quote db0f7864 history ===')
const { data: dbQuote } = await supabase
  .from('quotes')
  .select('id, share_token, status, total_inc_gst, created_at, intake_id, tenant_id')
  .eq('id', 'db0f7864-253f-420e-b956-c5146863b3d0')
  .single()
console.log('  share_token  :', dbQuote.share_token)
console.log('  status       :', dbQuote.status)
console.log('  total_inc_gst:', dbQuote.total_inc_gst)
console.log('  created_at   :', dbQuote.created_at)
