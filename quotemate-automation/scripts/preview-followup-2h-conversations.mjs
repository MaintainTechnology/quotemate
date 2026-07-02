// READ-ONLY dry run of the CONVERSATION half of /api/cron/followup-2h
// (migration 159). Replays the exact candidate query + pure gates the
// sweep uses and prints what WOULD fire — sends nothing, stamps nothing.
//
// Usage: node --env-file=.env.local scripts/preview-followup-2h-conversations.mjs
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const MIN_AGE_MS = 2 * 60 * 60 * 1000
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const nowMs = Date.now()
const floorIso = new Date(nowMs - MAX_AGE_MS).toISOString()
const ceilingIso = new Date(nowMs - MIN_AGE_MS).toISOString()

const mask = (p) => (p ? `${String(p).slice(0, 6)}…${String(p).slice(-3)}` : 'null')

// 1. Candidate scan — identical to the route.
const { data: candidates, error: scanErr } = await supabase
  .from('sms_conversations')
  .select(
    'id, tenant_id, intake_id, from_number, status, conversation_type, followup_2h_sent_at, last_message_at',
  )
  .is('followup_2h_sent_at', null)
  .eq('conversation_type', 'customer_quote')
  .eq('status', 'open')
  .not('tenant_id', 'is', null)
  .gte('last_message_at', floorIso)
  .lte('last_message_at', ceilingIso)
  .order('last_message_at', { ascending: true })
  .limit(200)

if (scanErr) {
  console.error('candidate scan failed:', scanErr.message)
  process.exit(1)
}

console.log(`window: idle since [${floorIso} .. ${ceilingIso}]`)
console.log(`candidates (pre-gates): ${candidates.length}\n`)

if (candidates.length === 0) {
  console.log('Nothing in the idle window right now — stall a test convo ≥2h to see it appear.')
  process.exit(0)
}

// 2. Tenant enable flags + numbers.
const tenantIds = [...new Set(candidates.map((c) => c.tenant_id))]
const [{ data: tenants }, { data: books }] = await Promise.all([
  supabase.from('tenants').select('id, business_name, twilio_sms_number').in('id', tenantIds),
  supabase.from('pricing_book').select('tenant_id, followup_2h_enabled').in('tenant_id', tenantIds),
])
const tenantById = new Map((tenants ?? []).map((t) => [t.id, t]))
const enabled = new Map()
for (const b of books ?? []) {
  enabled.set(b.tenant_id, (enabled.get(b.tenant_id) ?? false) || Boolean(b.followup_2h_enabled))
}

// 3. Newest message per thread (windowed like the route).
const { data: msgs } = await supabase
  .from('sms_messages')
  .select('conversation_id, direction, created_at')
  .in('conversation_id', candidates.map((c) => c.id))
  .gte('created_at', floorIso)
  .order('created_at', { ascending: false })
const lastByConvo = {}
for (const m of msgs ?? []) {
  if (!lastByConvo[m.conversation_id]) lastByConvo[m.conversation_id] = m
}

// 4. Delivered-quote intakes.
const intakeIds = [...new Set(candidates.map((c) => c.intake_id).filter(Boolean))]
const delivered = new Set()
if (intakeIds.length > 0) {
  const { data: qs } = await supabase
    .from('quotes')
    .select('intake_id')
    .in('intake_id', intakeIds)
    .not('sent_at', 'is', null)
  for (const q of qs ?? []) delivered.add(q.intake_id)
}

// 5. Verdict per candidate (mirrors lib/sms/conversation-followup-2h.ts).
let wouldFire = 0
for (const c of candidates) {
  const t = tenantById.get(c.tenant_id)
  const last = lastByConvo[c.id]
  const idleH = ((nowMs - Date.parse(c.last_message_at)) / 3.6e6).toFixed(1)
  let verdict
  if (!enabled.get(c.tenant_id)) verdict = 'skip:disabled'
  else if (c.intake_id && delivered.has(c.intake_id)) verdict = 'skip:quote_covered'
  else if (!last) verdict = 'skip:no_messages'
  else if (last.direction !== 'outbound') verdict = 'skip:customer_engaged'
  else if (!t?.twilio_sms_number) verdict = 'skip:tenant_unprovisioned'
  else { verdict = 'FIRE'; wouldFire++ }
  console.log(
    `  ${verdict.padEnd(26)} convo=${c.id.slice(0, 8)}… tenant=${(t?.business_name ?? c.tenant_id).slice(0, 24).padEnd(24)} from=${mask(c.from_number)} idle=${idleH}h lastDir=${last?.direction ?? '—'}`,
  )
}
console.log(`\nwould fire: ${wouldFire} of ${candidates.length}`)
