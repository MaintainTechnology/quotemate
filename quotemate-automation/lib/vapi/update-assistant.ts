// Update an existing Vapi assistant in place.
//
// Used when the tenant's trade portfolio or enabled services change after
// activation — e.g. a sparky enables roofing in account settings, and the AI
// receptionist must start handling roofing callers without losing the
// existing assistant ID (which Twilio routing depends on).
//
// 2026-07-23 rewrite (voice/SMS sync):
//   • DECOUPLED from VAPI_PROVISIONING_ENABLED. That flag guards resource
//     CREATION (new assistants/numbers); refreshing an existing assistant's
//     prompt works whenever VAPI_API_KEY is set — the old coupling meant
//     account-settings toggles silently never reached the live receptionist.
//     Opt-out: VAPI_PROMPT_SYNC_ENABLED=false.
//   • GET-then-PATCH via buildAssistantPatch (pure, tested): tools, voice,
//     transcriber and temperature survive; only the prompt, firstMessage,
//     model id and metadata.trades change. The old code PATCHed a fresh
//     `model` object, nuking tools and resetting the model to Haiku.
//   • Accepts the tenant's enabled services (+ MUST-ASK questions) so the
//     voice prompt carries the SAME per-service set the SMS dialog uses —
//     fetch them with lib/vapi/tenant-services.ts.
//   • Model resolves through lib/vapi/voice-model.ts (Sonnet 5 default).

import {
  buildVoiceFirstMessage,
  buildVoiceSystemPrompt,
  type VoiceCustomService,
} from './voice-prompt'
import { buildAssistantPatch } from './assistant-patch'
import { resolveVoiceModel } from './voice-model'

const VAPI_API = 'https://api.vapi.ai'

export type VapiUpdateResult =
  | { ok: true; stubbed: false }
  | { ok: true; stubbed: true }
  | { ok: false; reason: string }

export async function updateVapiAssistant(opts: {
  assistantId: string
  businessName: string
  /** Full trade portfolio after the change. Any registered trade names
   *  (data-driven since the admin bulk loader, Phase 0). */
  trades: string[]
  /** Tenant's enabled services + MUST-ASK questions (same rows the SMS
   *  dialog injects). Optional so legacy callers keep working; pass them
   *  via fetchTenantVoiceServices for full SMS parity. */
  customServices?: VoiceCustomService[]
}): Promise<VapiUpdateResult> {
  if (process.env.VAPI_PROMPT_SYNC_ENABLED === 'false') {
    return { ok: true, stubbed: true }
  }
  // A stubbed provision (VAPI_PROVISIONING_ENABLED off) stores ids like
  // "vapi-stub-<tenant>" — there is no live assistant to update.
  if (opts.assistantId.startsWith('vapi-stub-')) {
    return { ok: true, stubbed: true }
  }
  const apiKey = process.env.VAPI_API_KEY
  if (!apiKey) {
    return { ok: false, reason: 'VAPI_API_KEY not set' }
  }
  if (opts.trades.length === 0) {
    return { ok: false, reason: 'updateVapiAssistant called with empty trades[]' }
  }

  const firstMessage = buildVoiceFirstMessage(opts.businessName, opts.trades)
  const systemPrompt = buildVoiceSystemPrompt(
    opts.businessName,
    opts.trades,
    undefined,
    opts.customServices,
  )

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  const url = `${VAPI_API}/assistant/${encodeURIComponent(opts.assistantId)}`

  try {
    // GET the live assistant so the patch preserves tools/voice/transcriber
    // and writes the prompt into whichever slot (messages vs systemPrompt)
    // the assistant actually uses.
    const getRes = await fetch(url, { headers })
    if (!getRes.ok) {
      const text = await getRes.text()
      return { ok: false, reason: `fetch assistant failed: HTTP ${getRes.status}: ${text.slice(0, 200)}` }
    }
    const existing = await getRes.json()

    const body = buildAssistantPatch(existing, {
      firstMessage,
      systemPrompt,
      modelId: resolveVoiceModel(),
      trades: opts.trades,
    })

    const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(body) })
    if (!res.ok) {
      const text = await res.text()
      const parsed = (() => {
        try { return JSON.parse(text) } catch { return null }
      })()
      return {
        ok: false,
        reason:
          parsed?.message ??
          parsed?.error ??
          `HTTP ${res.status}: ${text.slice(0, 200)}`,
      }
    }
    return { ok: true, stubbed: false }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: `Vapi update threw: ${msg}` }
  }
}
