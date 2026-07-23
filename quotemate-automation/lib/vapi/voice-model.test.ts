// The one place the voice assistant's LLM is chosen. Sonnet 5 by default
// (upgrade decision 2026-07-23 — "truly intelligent" receptionist), with an
// env escape hatch so a rollback never needs a deploy.

import { afterEach, describe, expect, it } from 'vitest'
import { resolveVoiceModel } from './voice-model'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('resolveVoiceModel', () => {
  it('defaults to claude-sonnet-5', () => {
    delete process.env.VAPI_VOICE_MODEL
    expect(resolveVoiceModel()).toBe('claude-sonnet-5')
  })

  it('VAPI_VOICE_MODEL env override wins', () => {
    process.env.VAPI_VOICE_MODEL = 'claude-haiku-4-5-20251001'
    expect(resolveVoiceModel()).toBe('claude-haiku-4-5-20251001')
  })

  it('blank override falls back to the default', () => {
    process.env.VAPI_VOICE_MODEL = '   '
    expect(resolveVoiceModel()).toBe('claude-sonnet-5')
  })
})
