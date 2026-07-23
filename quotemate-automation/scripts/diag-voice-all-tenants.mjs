// Diagnose "voice AI doesn't pick up" across ALL tenants.
// Chain checked: tenant row → Twilio number + voice webhook → Vapi number
// import + assistant link → assistant serverUrl reachability → recent calls.
// Run: node --env-file=.env.local <this file>  (from quotemate-automation/)

import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'

const mask = (s) => (s ? `${String(s).slice(0, 6)}…${String(s).slice(-4)}` : '(unset)')

const {
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
  VAPI_API_KEY, VAPI_ASSISTANT_ID, VAPI_SERVER_URL,
} = process.env

for (const [k, v] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, VAPI_API_KEY })) {
  if (!v) { console.error(`✗ Missing ${k}`); process.exit(1) }
}

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const tw = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

const vapi = async (path) => {
  const res = await fetch(`https://api.vapi.ai${path}`, {
    headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
  })
  const t = await res.text()
  let data; try { data = JSON.parse(t) } catch { data = t }
  return { ok: res.ok, status: res.status, data }
}

// ── 1. Tenants ──────────────────────────────────────────────────────
const { data: tenants, error } = await supabase
  .from('tenants')
  .select('id, business_name, status, trade, trades, twilio_sms_number, twilio_voice_number, twilio_number_sid, vapi_assistant_id, vapi_voice_persona')
  .order('created_at', { ascending: true })
if (error) { console.error('✗ tenants query failed:', error.message); process.exit(1) }

console.log(`\n══ 1. TENANTS (${tenants.length}) ══`)
for (const t of tenants) {
  console.log(`  · ${t.business_name} [${t.status}] trade=${t.trade} trades=${JSON.stringify(t.trades)}`)
  console.log(`      voice=${t.twilio_voice_number ?? '—'}  sms=${t.twilio_sms_number ?? '—'}  numberSid=${t.twilio_number_sid ?? '—'}  assistant=${t.vapi_assistant_id ?? '—'} persona=${t.vapi_voice_persona ?? '—'}`)
}
console.log(`  env fallback assistant (VAPI_ASSISTANT_ID): ${VAPI_ASSISTANT_ID ?? '(unset)'}`)
console.log(`  env VAPI_SERVER_URL: ${VAPI_SERVER_URL ?? '(unset)'}`)

// ── 2. Twilio account + numbers ─────────────────────────────────────
console.log(`\n══ 2. TWILIO ACCOUNT ══`)
try {
  const acct = await tw.api.v2010.accounts(TWILIO_ACCOUNT_SID).fetch()
  console.log(`  ${acct.friendlyName} — status=${acct.status} type=${acct.type}`)
  try {
    const bal = await tw.balance.fetch()
    console.log(`  balance: ${bal.balance} ${bal.currency}`)
  } catch (e) { console.log(`  balance: (fetch failed: ${e.message})`) }
} catch (e) { console.log(`  ✗ account fetch failed: ${e.message}`) }

const numbers = await tw.incomingPhoneNumbers.list({ limit: 50 })
console.log(`\n══ 3. TWILIO NUMBERS (${numbers.length}) — voice webhook is the pickup path ══`)
for (const n of numbers) {
  console.log(`  · ${n.phoneNumber}  "${n.friendlyName}"  sid=${n.sid}`)
  console.log(`      voiceUrl: ${n.voiceUrl || '(EMPTY — calls go nowhere!)'} [${n.voiceMethod}]`)
  console.log(`      smsUrl:   ${n.smsUrl || '(empty)'}`)
  console.log(`      status=${n.status ?? 'in-use'} capabilities: voice=${n.capabilities?.voice} sms=${n.capabilities?.sms}`)
}

// ── 4. Vapi phone numbers ───────────────────────────────────────────
console.log(`\n══ 4. VAPI PHONE NUMBERS ══`)
const pn = await vapi('/phone-number')
if (!pn.ok) console.log(`  ✗ list failed HTTP ${pn.status}: ${JSON.stringify(pn.data).slice(0, 300)}`)
const vapiNumbers = pn.ok ? pn.data : []
for (const p of vapiNumbers) {
  console.log(`  · ${p.number}  provider=${p.provider}  status=${p.status ?? '—'}  assistant=${p.assistantId ?? '(NONE — rings but no agent!)'}  id=${p.id}`)
  if (p.credentialId) console.log(`      credentialId=${p.credentialId}`)
  if (p.twilioAccountSid) console.log(`      twilioAccountSid=${p.twilioAccountSid} ${p.twilioAccountSid === TWILIO_ACCOUNT_SID ? '(matches env)' : '⚠ DIFFERENT from env account!'}`)
}

// ── 5. Vapi assistants referenced by tenants/env ────────────────────
console.log(`\n══ 5. VAPI ASSISTANTS ══`)
const wanted = new Set([VAPI_ASSISTANT_ID, ...tenants.map((t) => t.vapi_assistant_id)].filter(Boolean))
const assistants = {}
for (const id of wanted) {
  const a = await vapi(`/assistant/${id}`)
  if (!a.ok) { console.log(`  ✗ ${id}: HTTP ${a.status} ${JSON.stringify(a.data).slice(0, 160)}`); continue }
  assistants[id] = a.data
  const serverUrl = a.data.serverUrl ?? a.data.server?.url ?? '(none)'
  console.log(`  · ${a.data.name ?? '(unnamed)'}  id=${id}`)
  console.log(`      serverUrl: ${serverUrl}`)
  console.log(`      model: ${a.data.model?.provider}/${a.data.model?.model}  voice: ${a.data.voice?.provider}/${a.data.voice?.voiceId ?? a.data.voice?.model ?? ''}  transcriber: ${a.data.transcriber?.provider ?? '—'}`)
}

// serverUrl reachability (dead ngrok = assistant can't run tools/webhooks)
console.log(`\n══ 6. SERVER URL REACHABILITY ══`)
const urls = new Set(
  Object.values(assistants)
    .map((a) => a.serverUrl ?? a.server?.url)
    .concat(VAPI_SERVER_URL)
    .filter(Boolean),
)
for (const u of urls) {
  try {
    const r = await fetch(u, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000) })
    console.log(`  · ${u} → HTTP ${r.status} ${r.status >= 500 ? '⚠' : '(reachable)'}`)
  } catch (e) {
    console.log(`  · ${u} → ✗ UNREACHABLE (${e.cause?.code ?? e.name}: ${e.message.slice(0, 80)})`)
  }
}

// ── 7. Recent Vapi calls — what actually happened on dial-in ────────
console.log(`\n══ 7. LAST 15 VAPI CALLS ══`)
const calls = await vapi('/call?limit=15')
if (!calls.ok) console.log(`  ✗ list failed HTTP ${calls.status}`)
else if (!calls.data.length) console.log(`  (no calls on this Vapi account at all)`)
else for (const c of calls.data) {
  const when = (c.createdAt ?? '').slice(0, 19).replace('T', ' ')
  console.log(`  · ${when}  ${c.type ?? '?'}  status=${c.status}  endedReason=${c.endedReason ?? '—'}`)
  console.log(`      from=${c.customer?.number ?? '—'} to=${c.phoneNumber?.number ?? c.phoneNumberId ?? '—'}  dur=${c.startedAt && c.endedAt ? Math.round((new Date(c.endedAt) - new Date(c.startedAt)) / 1000) + 's' : '—'}`)
}

// ── 8. Recent inbound Twilio VOICE calls — did calls even reach Twilio? ─
console.log(`\n══ 8. LAST 15 TWILIO VOICE CALLS ══`)
try {
  const twCalls = await tw.calls.list({ limit: 15 })
  if (!twCalls.length) console.log(`  (no calls on the Twilio account)`)
  for (const c of twCalls) {
    const when = c.dateCreated?.toISOString().slice(0, 19).replace('T', ' ')
    console.log(`  · ${when}  ${c.direction}  ${c.from} → ${c.to}  status=${c.status}  dur=${c.duration}s`)
  }
} catch (e) { console.log(`  ✗ calls list failed: ${e.message}`) }

// ── 9. Cross-reference verdicts per tenant ──────────────────────────
console.log(`\n══ 9. PER-TENANT VERDICT ══`)
for (const t of tenants) {
  const problems = []
  const voiceNum = t.twilio_voice_number
  if (!voiceNum) { console.log(`  · ${t.business_name}: no twilio_voice_number — voice channel not provisioned (SMS-only tenant?)`); continue }
  const twNum = numbers.find((n) => n.phoneNumber === voiceNum)
  if (!twNum) problems.push(`number ${voiceNum} NOT in Twilio account ${mask(TWILIO_ACCOUNT_SID)}`)
  else if (!twNum.voiceUrl) problems.push(`Twilio voiceUrl EMPTY`)
  else if (!/vapi\.ai/i.test(twNum.voiceUrl)) problems.push(`Twilio voiceUrl not pointing at Vapi: ${twNum.voiceUrl}`)
  const vNum = vapiNumbers.find((p) => p.number === voiceNum)
  if (!vNum) problems.push(`number not imported into Vapi`)
  else {
    if (!vNum.assistantId) problems.push(`Vapi number has NO assistant linked`)
    const expected = t.vapi_assistant_id ?? VAPI_ASSISTANT_ID
    if (vNum.assistantId && expected && vNum.assistantId !== expected) problems.push(`Vapi number linked to ${vNum.assistantId}, tenant expects ${expected}`)
    if (vNum.status && vNum.status !== 'active') problems.push(`Vapi number status=${vNum.status}`)
  }
  const aId = t.vapi_assistant_id ?? VAPI_ASSISTANT_ID
  if (aId && !assistants[aId]) problems.push(`assistant ${aId} not fetchable on this Vapi key`)
  console.log(problems.length
    ? `  ✗ ${t.business_name}: ${problems.join('; ')}`
    : `  ✓ ${t.business_name}: chain looks wired (${voiceNum})`)
}
console.log()
