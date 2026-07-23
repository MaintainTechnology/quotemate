// buildAssistantPatch — the PURE merge behind updateVapiAssistant.
//
// The 2026-07-23 incident class this prevents: the old update PATCHed a brand
// new `model` object, which (a) reset the model to Haiku, (b) dropped any
// tools/messages the live assistant carried. The patch must be surgical:
// swap ONLY the prompt + firstMessage + model id, preserve everything else.

import { describe, expect, it } from 'vitest'
import { buildAssistantPatch } from './assistant-patch'

const NEXT = {
  firstMessage: 'G\'day, you\'ve reached Acme.',
  systemPrompt: 'NEW PROMPT',
  modelId: 'claude-sonnet-5',
  trades: ['electrical', 'roofing'],
}

describe('buildAssistantPatch', () => {
  it('sets the model id and provider while preserving other model fields', () => {
    const patch = buildAssistantPatch(
      {
        model: {
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          temperature: 0.2,
          maxTokens: 400,
          systemPrompt: 'OLD',
        },
      },
      NEXT,
    )
    expect(patch.model.model).toBe('claude-sonnet-5')
    expect(patch.model.provider).toBe('anthropic')
    expect(patch.model.temperature).toBe(0.2)
    expect(patch.model.maxTokens).toBe(400)
  })

  it('preserves tools and toolIds verbatim', () => {
    const tools = [{ type: 'endCall' }]
    const toolIds = ['tool-123']
    const patch = buildAssistantPatch(
      { model: { provider: 'anthropic', model: 'x', tools, toolIds, systemPrompt: 'OLD' } },
      NEXT,
    )
    expect(patch.model.tools).toEqual(tools)
    expect(patch.model.toolIds).toEqual(toolIds)
  })

  it('writes the prompt into model.systemPrompt when there are no messages', () => {
    const patch = buildAssistantPatch(
      { model: { provider: 'anthropic', model: 'x', systemPrompt: 'OLD' } },
      NEXT,
    )
    expect(patch.model.systemPrompt).toBe('NEW PROMPT')
    expect(patch.model.messages).toBeUndefined()
  })

  it('swaps the system entry in model.messages when messages exist (messages win in Vapi)', () => {
    const patch = buildAssistantPatch(
      {
        model: {
          provider: 'anthropic',
          model: 'x',
          messages: [
            { role: 'system', content: 'OLD' },
            { role: 'assistant', content: 'example' },
          ],
        },
      },
      NEXT,
    )
    expect(patch.model.messages).toEqual([
      { role: 'system', content: 'NEW PROMPT' },
      { role: 'assistant', content: 'example' },
    ])
  })

  it('sets firstMessage, merges metadata.trades, enables the end-call function', () => {
    const patch = buildAssistantPatch(
      { model: { provider: 'anthropic', model: 'x' }, metadata: { tenant_id: 't1', trades: ['electrical'] } },
      NEXT,
    )
    expect(patch.firstMessage).toBe(NEXT.firstMessage)
    expect(patch.metadata).toEqual({ tenant_id: 't1', trades: ['electrical', 'roofing'] })
    expect(patch.endCallFunctionEnabled).toBe(true)
  })

  it('defaults temperature to 0.2 when the live assistant has none', () => {
    const patch = buildAssistantPatch({ model: { provider: 'anthropic', model: 'x' } }, NEXT)
    expect(patch.model.temperature).toBe(0.2)
  })
})
