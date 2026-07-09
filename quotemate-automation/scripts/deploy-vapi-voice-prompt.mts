// Deploy the composed multi-trade voice prompt to the LIVE Vapi assistant.
//
// This is the ONE deploy path that shares lib/vapi/voice-prompt.ts with the
// auto-provision flow (provision.ts / update-assistant.ts) — so the live
// assistant and any future auto-provisioned assistant speak the SAME script,
// which mirrors the SMS receptionist. It replaces the hand-copied prompt body
// in the older scripts/update-vapi-prompt-*.mjs one-offs.
//
// It also pulls the tenant's ENABLED services + their MUST-ASK questions
// straight from Supabase (shared_assemblies / tenant_custom_assemblies
// .clarifying_questions), using the SAME resolveEnabledSharedAssembliesForDialog
// filter the SMS inbound route uses — so the voice prompt asks the exact same
// per-service questions SMS asks. Without a tenant match it assumes every
// service is enabled (full catalogue) so the pilot line can test them all.
//
// Run (all trades, default business name):
//   node --env-file=.env.local --import tsx scripts/deploy-vapi-voice-prompt.mts
// Pick the trades the pilot is testing (shorter prompt):
//   node --env-file=.env.local --import tsx scripts/deploy-vapi-voice-prompt.mts --trades=electrical,plumbing
// Preview without pushing (still shows the DB questions):
//   node --env-file=.env.local --import tsx scripts/deploy-vapi-voice-prompt.mts --dry-run
// Set a business name:
//   VAPI_DEPLOY_BUSINESS_NAME="Bright Spark" node --env-file=.env.local --import tsx scripts/deploy-vapi-voice-prompt.mts

import { Client } from 'pg'
import {
  buildVoiceFirstMessage,
  buildVoiceSystemPrompt,
  type VoiceCustomService,
} from '../lib/vapi/voice-prompt'
import {
  resolveEnabledSharedAssembliesForDialog,
  type SharedAssemblyScopeRow,
} from '../lib/sms/service-scope'

const VAPI_API_KEY = process.env.VAPI_API_KEY
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const tradesArg = argv.find((a) => a.startsWith('--trades='))?.split('=')[1]

const businessName = process.env.VAPI_DEPLOY_BUSINESS_NAME ?? 'QuoteMate'
// Default to every trade so the pilot line can be tested against all services.
const trades = (tradesArg ?? 'electrical,plumbing,roofing,painting,solar,aircon,commercial_painting')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)

// A shared_assemblies row also carries always_inspection; resolveEnabled...
// returns the same row objects, so the extra field survives the filter.
type AssemblyRow = SharedAssemblyScopeRow & { always_inspection?: boolean | null }

// Pull the tenant's enabled services (+ MUST-ASK questions) from Supabase — the
// same data SMS injects. Best-effort: no DB url / no match → empty (code-only
// easy questions still ship). Returns the extras (non-hardcoded-easy) exactly
// as the SMS dialog would list them.
async function fetchCustomServices(): Promise<VoiceCustomService[]> {
  if (!SUPABASE_DB_URL) {
    console.warn('⚠ SUPABASE_DB_URL not set — deploying code-only easy questions (no DB custom-service MUST-ASK).')
    return []
  }
  const c = new Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    // Resolve the tenant that owns this assistant (mirrors the webhook lookup)
    // so we gate by tenant_service_offerings. No match → assume all enabled.
    let tenantId: string | null = null
    if (VAPI_ASSISTANT_ID) {
      const t = await c.query('select id from tenants where vapi_assistant_id = $1 limit 1', [VAPI_ASSISTANT_ID])
      tenantId = (t.rows[0]?.id as string | undefined) ?? null
    }

    // always_inspection lives on shared_assemblies (mig 068); fall back if absent.
    const selectRows = async (withInspection: boolean) =>
      c.query(
        `select id, name, description, default_enabled, category, clarifying_questions${
          withInspection ? ', always_inspection' : ''
        }
         from shared_assemblies
         where trade = any($1::text[])`,
        [trades],
      )
    const res = await selectRows(true).catch(() => selectRows(false))
    const rows: AssemblyRow[] = res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? null,
      default_enabled: r.default_enabled ?? null,
      category: r.category ?? null,
      clarifying_questions: r.clarifying_questions ?? null,
      always_inspection: r.always_inspection ?? false,
    }))

    const offerings = tenantId
      ? (
          await c.query('select assembly_id, enabled from tenant_service_offerings where tenant_id = $1', [tenantId])
        ).rows.map((r) => ({ assembly_id: r.assembly_id, enabled: r.enabled }))
      : []

    const enabled = resolveEnabledSharedAssembliesForDialog(rows, offerings, {
      assumeAllEnabled: !tenantId,
    }) as AssemblyRow[]

    // Tenant-owned custom assemblies (migration 023) — always the tenant's own.
    const custom: VoiceCustomService[] = tenantId
      ? (
          await c.query(
            'select name, description, clarifying_questions, always_inspection from tenant_custom_assemblies where tenant_id = $1 and enabled is not false',
            [tenantId],
          )
        ).rows.map((r) => ({
          name: r.name,
          description: r.description ?? null,
          clarifying_questions: (r.clarifying_questions ?? null) as string[] | null,
          always_inspection: r.always_inspection ?? false,
        }))
      : []

    console.log(`Tenant:        ${tenantId ?? '(none — assuming all services enabled)'}`)
    return [
      ...enabled.map((r) => ({
        name: r.name,
        description: r.description ?? null,
        clarifying_questions: (r.clarifying_questions ?? null) as string[] | null,
        always_inspection: r.always_inspection ?? false,
      })),
      ...custom,
    ]
  } finally {
    await c.end()
  }
}

const customServices = await fetchCustomServices()
const firstMessage = buildVoiceFirstMessage(businessName, trades)
const systemPrompt = buildVoiceSystemPrompt(businessName, trades, undefined, customServices)

console.log(`Business:      ${businessName}`)
console.log(`Trades:        ${trades.join(', ')}`)
console.log(`DB services:   ${customServices.length} (with MUST-ASK questions, mirrors SMS)`)
console.log(`First message: ${firstMessage.length} chars`)
console.log(`System prompt: ${systemPrompt.length} chars`)
console.log()

if (dryRun) {
  console.log('--- FIRST MESSAGE ---')
  console.log(firstMessage)
  console.log('\n--- SYSTEM PROMPT ---')
  console.log(systemPrompt)
  console.log('\n(dry run — nothing pushed)')
  process.exit(0)
}

if (!VAPI_API_KEY || !VAPI_ASSISTANT_ID) {
  console.error('Missing VAPI_API_KEY or VAPI_ASSISTANT_ID (set in .env.local)')
  process.exit(1)
}

const base = `https://api.vapi.ai/assistant/${VAPI_ASSISTANT_ID}`

// Fetch the existing assistant so we keep its model/voice/transcriber/tools and
// only swap the system message — the exact mechanic the working
// update-vapi-prompt-confirm.mjs uses.
const fetchRes = await fetch(base, { headers: { Authorization: `Bearer ${VAPI_API_KEY}` } })
if (!fetchRes.ok) {
  console.error(`✗ Failed to fetch assistant: HTTP ${fetchRes.status}`)
  console.error(await fetchRes.text())
  process.exit(1)
}
const existing = await fetchRes.json()

const updatedMessages = (existing.model?.messages ?? [])
  .filter((m: { role: string }) => m.role !== 'system')
  .concat([{ role: 'system', content: systemPrompt }])

const patchRes = await fetch(base, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${VAPI_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    firstMessage,
    model: { ...existing.model, messages: updatedMessages },
  }),
})

const text = await patchRes.text()
if (!patchRes.ok) {
  console.error(`✗ Failed: HTTP ${patchRes.status}`)
  console.error(text)
  process.exit(1)
}

console.log(`✓ Assistant ${VAPI_ASSISTANT_ID} updated`)
console.log()
console.log('Verify:')
console.log('  node --env-file=.env.local scripts/dump-vapi-prompt.mjs   # confirm the live prompt text + char count')
console.log('  then place a real call to your Vapi number and walk an electrical + a plumbing job.')
console.log('After the call, the post-call webhook drafts the quote and texts the caller a quote link (the "code").')
console.log('  Check it landed:  node --env-file=.env.local scripts/audit-vapi-orphan-calls.mjs   (or the dashboard Calls/Quotes)')
