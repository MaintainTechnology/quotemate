// SMS-parity Q&A for the voice receptionist (2026-07-23).
//
// The SMS receptionists can answer "how does it work?" for their trade; the
// voice prompt historically could only ASK questions. These tests pin the new
// capability: every trade block carries spoken how-it-works facts, they render
// ONLY for the tenant's enabled trades, and a general ANSWERING QUESTIONS
// section tells the assistant how to handle service queries — including
// services the business does NOT offer.

import { describe, expect, it } from 'vitest'
import { buildVoiceSystemPrompt } from './voice-prompt'
import { VOICE_TRADE_QUESTIONS } from './trade-questions'

describe('trade how-it-works facts', () => {
  it('every qualify-trade block declares non-empty howItWorks lines', () => {
    for (const [trade, block] of Object.entries(VOICE_TRADE_QUESTIONS)) {
      expect(block.howItWorks, `${trade} needs howItWorks`).toBeDefined()
      expect(block.howItWorks.length, `${trade} howItWorks empty`).toBeGreaterThan(0)
    }
  })

  it('roofing how-it-works explains the satellite measure + SMS quote', () => {
    const lines = VOICE_TRADE_QUESTIONS.roofing.howItWorks.join(' ')
    expect(lines).toMatch(/satellite|aerial/i)
    expect(lines).toMatch(/text|SMS/i)
  })

  it('renders a trade\'s how-it-works only when that trade is enabled', () => {
    const withRoofing = buildVoiceSystemPrompt('Acme', ['electrical', 'roofing'])
    const withoutRoofing = buildVoiceSystemPrompt('Acme', ['electrical'])
    const marker = VOICE_TRADE_QUESTIONS.roofing.howItWorks[0]
    expect(withRoofing).toContain(marker)
    expect(withoutRoofing).not.toContain(marker)
  })
})

describe('ANSWERING QUESTIONS section', () => {
  const prompt = buildVoiceSystemPrompt('Acme', ['electrical', 'roofing'])

  it('is present in the composed prompt', () => {
    expect(prompt).toContain('ANSWERING QUESTIONS')
  })

  it('auto-quote trades explain the after-call quote process', () => {
    // electrical/plumbing: quote drafts automatically after the call, lands
    // by text — the assistant may explain this when asked how it works.
    expect(prompt).toMatch(/HOW IT WORKS/i)
    expect(prompt).toMatch(/drafts automatically|quote drafts/i)
  })

  it('instructs redirection for services the business does not offer', () => {
    expect(prompt).toMatch(/not something (this business|we) (does|do)/i)
  })

  it('forbids inventing prices when answering questions', () => {
    // The Q&A section must not open a price loophole.
    const qa = prompt.slice(prompt.indexOf('ANSWERING QUESTIONS'))
    expect(qa).toMatch(/never (invent|make up|quote)/i)
  })

  it('survives the override path untouched (override replaces everything)', () => {
    const overridden = buildVoiceSystemPrompt('Acme', ['roofing'], {
      systemPrompt: 'CUSTOM',
    })
    expect(overridden).toBe('CUSTOM')
  })
})
