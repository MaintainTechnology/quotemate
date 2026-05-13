// Vapi assistant provisioning for a newly onboarded tradie.
//
// Each tradie gets their own Vapi assistant — one assistant ID per
// tenant. The Vapi inbound webhook resolves tenant by assistant ID, so
// the right pricing book + trade prompt are used for every call.
//
// Gated by env flag `VAPI_PROVISIONING_ENABLED=true`. When disabled,
// returns a deterministic stub ID so the rest of the activate flow can
// complete without hitting the Vapi API.

const VAPI_API = 'https://api.vapi.ai'

export type VapiProvisionResult =
  | { ok: true; stubbed: false; assistantId: string }
  | { ok: true; stubbed: true; assistantId: string }
  | { ok: false; reason: string }

export async function provisionVapiAssistant(opts: {
  tenantId: string
  businessName: string
  /** Primary trade — used when only one is configured. */
  trade: 'electrical' | 'plumbing'
  /** All trades this tenant offers. When length > 1 the assistant
   *  prompt and greeting acknowledge both. Falls back to [trade]. */
  trades?: Array<'electrical' | 'plumbing'>
  voicePersona?: string                  // default 'jon'
  /** The phone number this assistant will be bound to (for first-message context) */
  phoneNumber?: string
}): Promise<VapiProvisionResult> {
  if (process.env.VAPI_PROVISIONING_ENABLED !== 'true') {
    return {
      ok: true,
      stubbed: true,
      assistantId: `vapi-stub-${opts.tenantId.slice(0, 8)}`,
    }
  }

  const apiKey = process.env.VAPI_API_KEY
  if (!apiKey) {
    return { ok: false, reason: 'VAPI_API_KEY not set' }
  }

  const persona = opts.voicePersona ?? 'jon'

  // Multi-trade aware greeting: "electrical or plumbing job" if the
  // tradie holds both licences, otherwise just the one they offer.
  const trades = opts.trades && opts.trades.length > 0 ? opts.trades : [opts.trade]
  const tradeLabel = renderTradeLabel(trades)

  const firstMessage =
    `G'day, you've reached ${opts.businessName}. ` +
    `I'm the AI quoting assistant — I can take down details for your ${tradeLabel} job and get a quote across. ` +
    `This call may be recorded for quality and quote drafting. Sound good?`

  const systemPrompt = buildSystemPrompt({ ...opts, trades })

  const body = {
    name: `${opts.businessName} — QuoteMate`,
    metadata: { tenant_id: opts.tenantId, trade: opts.trade, trades },
    firstMessage,
    model: {
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      temperature: 0.2,
      systemPrompt,
    },
    voice: {
      provider: '11labs',
      voiceId: voiceIdForPersona(persona),
    },
    transcriber: {
      provider: 'deepgram',
      model: 'nova-2',
      language: 'en-AU',
    },
    // Tools / server URL wiring is added in Phase 1c when the inbound
    // /api/vapi/webhook is tenant-aware. For now, the assistant exists
    // and can take basic calls; quote drafting is triggered by the
    // post-call webhook which we'll fork next.
    serverUrl: `${process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/vapi/webhook`,
  }

  try {
    const res = await fetch(`${VAPI_API}/assistant`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    const parsed = (() => { try { return JSON.parse(text) } catch { return null } })()
    if (!res.ok) {
      return {
        ok: false,
        reason: parsed?.message ?? parsed?.error ?? `HTTP ${res.status}: ${text.slice(0, 200)}`,
      }
    }
    if (!parsed?.id) {
      return { ok: false, reason: 'Vapi response missing id field' }
    }
    return { ok: true, stubbed: false, assistantId: parsed.id }
  } catch (e: any) {
    return { ok: false, reason: `Vapi create threw: ${e?.message ?? String(e)}` }
  }
}

/** Maps a persona name to a known 11labs voice ID. */
function voiceIdForPersona(persona: string): string {
  // Default voice IDs — replace with your tradie-vetted picks in env if needed.
  const PERSONA_VOICES: Record<string, string> = {
    jon:   process.env.VAPI_VOICE_JON   ?? 'pNInz6obpgDQGcFmaJgB',
    sarah: process.env.VAPI_VOICE_SARAH ?? 'EXAVITQu4vr4xnSDxMaL',
    mike:  process.env.VAPI_VOICE_MIKE  ?? 'TX3LPaxmHKxFdv7VOQHJ',
    anna:  process.env.VAPI_VOICE_ANNA  ?? 'XB0fDUnXU5powFXDhCwa',
  }
  return PERSONA_VOICES[persona] ?? PERSONA_VOICES.jon
}

/** Per-tenant system prompt skeleton. Trade-specific call-flow detail
 *  comes from the existing Vapi prompt template — we just bind the
 *  tenant's business name + trade context at provision time. The full
 *  pricing-book-aware prompt is rendered at quote time by the existing
 *  /lib/estimate router. */
function buildSystemPrompt(opts: {
  businessName: string
  trades: Array<'electrical' | 'plumbing'>
}): string {
  const tradeLabel = renderTradeLabel(opts.trades)
  const contractorDescription =
    opts.trades.length > 1
      ? `${opts.trades.join(' and ')} contractor`
      : `${opts.trades[0]} contractor`
  const easyFiveContext = opts.trades
    .map((t) => `recognise the easy-5 job types for ${t}`)
    .join(' and ')

  return `You are the AI receptionist for ${opts.businessName}, an Australian ${contractorDescription}.

Your job is to greet the caller, capture the key details for their ${tradeLabel} job (location, what they need done, when), and confirm what you heard at the end of the call. Do NOT quote prices on the phone — a structured quote will be drafted automatically after the call and sent via SMS.

TONE: Australian, professional, friendly. Plain English. No filler. Match the cadence of a busy suburban tradie's receptionist.

WHAT TO ASK:
1. First name
2. Suburb / location of the job
3. What ${tradeLabel} work they need (use plain language; ${easyFiveContext})
4. When they need it done (urgent / this week / flexible)
5. Confirm what you heard before ending

WHAT NOT TO DO:
- Never quote prices on the call.
- Never promise a tradie will attend on a specific day.
- If the job sounds dangerous (smell gas, sparks, burst pipe, water through ceiling), flag it as an emergency and ask if they need urgent attention.

When the caller confirms the summary, thank them and end the call. The quote will arrive by SMS within a couple of minutes.`
}

/**
 * Render the call-language trade label for a multi-trade tenant.
 *   ['electrical']               → "electrical"
 *   ['plumbing']                 → "plumbing"
 *   ['electrical','plumbing']    → "electrical or plumbing"
 *   ['plumbing','electrical']    → "plumbing or electrical"
 */
function renderTradeLabel(trades: Array<'electrical' | 'plumbing'>): string {
  if (trades.length === 1) return trades[0]
  return trades.join(' or ')
}
