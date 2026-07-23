// Sync EVERY tenant's live Vapi assistant with its account settings.
//
// 2026-07-23 — voice/SMS receptionist alignment. For each tenant with a real
// (non-stub) vapi_assistant_id this composes the multi-trade prompt from the
// CURRENT tenants.trades[] + enabled services (same rows + MUST-ASK set the
// SMS dialog uses) and PATCHes the live assistant non-destructively via the
// SAME lib path the account-settings routes use (lib/vapi/update-assistant).
// Model goes to Sonnet 5 (lib/vapi/voice-model.ts).
//
// Run:      node --env-file=.env.local --import tsx scripts/sync-vapi-assistants.mts
// Preview:  node --env-file=.env.local --import tsx scripts/sync-vapi-assistants.mts --dry-run

import { createClient } from '@supabase/supabase-js'
import { updateVapiAssistant } from '../lib/vapi/update-assistant'
import { fetchTenantVoiceServices } from '../lib/vapi/tenant-services'
import { buildVoiceSystemPrompt, buildVoiceFirstMessage } from '../lib/vapi/voice-prompt'
import { resolveVoiceModel } from '../lib/vapi/voice-model'

const dryRun = process.argv.includes('--dry-run')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const { data: tenants, error } = await supabase
  .from('tenants')
  .select('id, business_name, status, trade, trades, vapi_assistant_id')
  .order('created_at', { ascending: true })
if (error) { console.error('tenants query failed:', error.message); process.exit(1) }

console.log(`Model target: ${resolveVoiceModel()}\n`)

let okCount = 0, failCount = 0
for (const t of tenants ?? []) {
  const label = `${t.business_name} [${t.status}]`
  const assistantId = t.vapi_assistant_id as string | null
  if (!assistantId || assistantId.startsWith('vapi-stub-')) {
    console.log(`· skip ${label} — no live assistant (${assistantId ?? 'none'})`)
    continue
  }
  const trades: string[] =
    Array.isArray(t.trades) && t.trades.length > 0 ? t.trades : t.trade ? [t.trade] : []
  if (trades.length === 0) {
    console.log(`· skip ${label} — no trades configured`)
    continue
  }

  const services = await fetchTenantVoiceServices(supabase, t.id, trades)
  const prompt = buildVoiceSystemPrompt(t.business_name ?? '', trades, undefined, services)
  const greeting = buildVoiceFirstMessage(t.business_name ?? '', trades)
  console.log(`· ${label}`)
  console.log(`    trades=${trades.join(',')}  services=${services.length}  prompt=${prompt.length}ch  greeting=${greeting.length}ch`)

  if (dryRun) continue
  const res = await updateVapiAssistant({
    assistantId,
    businessName: t.business_name ?? '',
    trades,
    customServices: services,
  })
  if (res.ok) {
    okCount++
    console.log(`    ✓ synced (${res.stubbed ? 'stubbed?!' : 'live'})`)
  } else {
    failCount++
    console.log(`    ✗ FAILED: ${res.reason}`)
  }
}

console.log(`\n${dryRun ? 'DRY RUN — nothing pushed.' : `Done: ${okCount} synced, ${failCount} failed.`}`)
if (failCount > 0) process.exit(1)
