// buildAssistantPatch — PURE merge of a fresh prompt onto a LIVE Vapi
// assistant. The old update PATCHed a brand-new `model` object, which reset
// the model id and silently dropped any tools/messages the assistant carried
// (Vapi PATCH replaces the whole `model` field). This keeps the patch
// surgical: swap the prompt in whichever slot is live, set the model id,
// preserve everything else.

export type VapiModelShape = {
  provider?: string
  model?: string
  temperature?: number
  systemPrompt?: string
  messages?: Array<{ role: string; content?: string; [k: string]: unknown }>
  tools?: unknown[]
  toolIds?: string[]
  [k: string]: unknown
}

export type VapiAssistantShape = {
  model?: VapiModelShape
  metadata?: Record<string, unknown>
  [k: string]: unknown
}

export type AssistantPatchInput = {
  firstMessage: string
  systemPrompt: string
  modelId: string
  trades: readonly string[]
}

export function buildAssistantPatch(existing: VapiAssistantShape, next: AssistantPatchInput) {
  const model: VapiModelShape = { ...(existing.model ?? {}) }
  model.provider = 'anthropic'
  model.model = next.modelId
  model.temperature = model.temperature ?? 0.2

  // Vapi precedence: model.messages wins over model.systemPrompt. Write the
  // new prompt into whichever slot the live assistant actually uses, and
  // remove the loser so a stale twin can't shadow the update.
  const messages = Array.isArray(model.messages) ? model.messages : undefined
  if (messages?.some((m) => m.role === 'system')) {
    model.messages = messages.map((m) =>
      m.role === 'system' ? { ...m, content: next.systemPrompt } : m,
    )
    delete model.systemPrompt
  } else {
    model.systemPrompt = next.systemPrompt
    delete model.messages
  }

  return {
    firstMessage: next.firstMessage,
    model,
    metadata: { ...(existing.metadata ?? {}), trades: [...next.trades] },
    // The prompt's closing says "call the endCall tool" — make sure the
    // assistant can actually hang up (live assistants had this unset).
    endCallFunctionEnabled: true,
  }
}
