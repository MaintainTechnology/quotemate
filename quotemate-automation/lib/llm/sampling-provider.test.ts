import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import { describe, expect, it } from 'vitest'
import { deterministicSampling } from './sampling'
import { SMS_RECEPTIONIST_MODEL } from '@/lib/sms/model'

describe('sampling policy at the installed provider request boundary', () => {
  it.each([
    { modelId: SMS_RECEPTIONIST_MODEL, expectedTemperature: undefined },
    { modelId: 'claude-opus-4-8', expectedTemperature: undefined },
    { modelId: 'claude-sonnet-4-6', expectedTemperature: 0 },
    { modelId: 'claude-haiku-4-5', expectedTemperature: 0 },
  ])('$modelId uses only supported sampling settings', async ({ modelId, expectedTemperature }) => {
    let request: Record<string, unknown> = {}
    const provider = createAnthropic({ apiKey: 'synthetic-test-key', fetch: async (_url, options) => {
      request = JSON.parse(String(options?.body))
      return new Response(JSON.stringify({ id: 'synthetic-message', type: 'message', role: 'assistant',
        model: modelId, content: [{ type: 'text', text: 'Which vehicle is this for?' }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    } })
    const reply = await generateText({ model: provider(modelId), ...deterministicSampling(modelId),
      maxOutputTokens: 64, maxRetries: 0, prompt: 'Synthetic sampling contract check.' })
    expect(reply.text).toBe('Which vehicle is this for?')
    expect(request.temperature).toBe(expectedTemperature)
    if (expectedTemperature === undefined) expect(request).not.toHaveProperty('temperature')
    expect(request).not.toHaveProperty('top_p')
    expect(request).not.toHaveProperty('top_k')
  })
})
