// Voice-prompt builder tests.
//
// buildVoiceSystemPrompt composes a multi-trade receptionist prompt that MIRRORS
// the SMS receptionist. electrical/plumbing questions are sourced from
// lib/sms/assumptions.ts (mustAskLines) — the assertions below import that SAME
// source, so if the SMS MUST-ASK set changes but the voice prompt doesn't, these
// tests break. That is the no-drift guarantee. The other trades come from
// lib/vapi/trade-questions.ts and are asserted against it directly.

import { describe, it, expect } from 'vitest'
import {
  renderTradeLabel,
  buildVoiceFirstMessage,
  buildVoiceSystemPrompt,
} from './voice-prompt'
import { mustAskLines } from '../sms/assumptions'
import { VOICE_TRADE_QUESTIONS } from './trade-questions'

describe('renderTradeLabel', () => {
  it('returns the single trade as-is', () => {
    expect(renderTradeLabel(['electrical'])).toBe('electrical')
  })
  it('joins two trades with " or "', () => {
    expect(renderTradeLabel(['electrical', 'plumbing'])).toBe('electrical or plumbing')
  })
  it('joins 3+ trades as a natural list (no repeated "or")', () => {
    expect(renderTradeLabel(['electrical', 'plumbing', 'roofing'])).toBe(
      'electrical, plumbing or roofing',
    )
  })
})

describe('buildVoiceFirstMessage', () => {
  it('single-trade greeting', () => {
    expect(
      buildVoiceFirstMessage('Bright Spark Electric', ['electrical']),
    ).toMatchInlineSnapshot(
      `"G'day, you've reached Bright Spark Electric. I'm the AI quoting assistant — I can take down details for your electrical job and get a quote across. This call may be recorded for quality and quote drafting. Sound good?"`,
    )
  })
  it('multi-trade greeting', () => {
    expect(
      buildVoiceFirstMessage('Acme Trades', ['electrical', 'plumbing']),
    ).toMatchInlineSnapshot(
      `"G'day, you've reached Acme Trades. I'm the AI quoting assistant — I can take down details for your electrical or plumbing job and get a quote across. This call may be recorded for quality and quote drafting. Sound good?"`,
    )
  })
  it('a voice_greeting override replaces the composed greeting', () => {
    expect(
      buildVoiceFirstMessage('Acme', ['electrical'], { greeting: 'Custom greeting.' }),
    ).toBe('Custom greeting.')
  })
})

describe('buildVoiceSystemPrompt — shared behaviour', () => {
  it('always states no price on the call + read-back handshake + endCall', () => {
    const p = buildVoiceSystemPrompt('Bright Spark Electric', ['electrical'])
    expect(p).toContain('an Australian electrical contractor')
    expect(p).toContain('NEVER quote a price')
    expect(p).toContain('read the scope back')
    expect(p).toContain('endCall')
    expect(p).toContain('EMERGENCY OVERRIDE')
  })

  it('a voice_system_prompt override replaces the composed prompt', () => {
    expect(
      buildVoiceSystemPrompt('Acme', ['electrical'], { systemPrompt: 'CUSTOM PROMPT' }),
    ).toBe('CUSTOM PROMPT')
  })
})

describe('buildVoiceSystemPrompt — electrical/plumbing mirror SMS assumptions (no drift)', () => {
  it('electrical-only carries every easy-5 electrical MUST-ASK line and no plumbing lines', () => {
    const p = buildVoiceSystemPrompt('Bright Spark Electric', ['electrical'])
    for (const jt of ['downlights', 'power_points', 'ceiling_fans', 'smoke_alarms', 'outdoor_lighting'] as const) {
      for (const q of mustAskLines(jt)) expect(p).toContain(q)
    }
    // No plumbing question tree leaks into an electrical-only prompt.
    expect(p).not.toContain(mustAskLines('hot_water')[0])
    expect(p).not.toContain('PLUMBING JOBS')
    // Commercial electrical estimation (plan take-off) has its own branch.
    expect(p).toContain('plan take-off / electrical estimation')
  })

  it('plumbing-only carries every plumbing MUST-ASK line and no electrical lines', () => {
    const p = buildVoiceSystemPrompt('Peppers Plumbing', ['plumbing'])
    for (const jt of ['blocked_drain', 'hot_water', 'tap_repair', 'tap_replace', 'toilet_repair', 'toilet_replace'] as const) {
      for (const q of mustAskLines(jt)) expect(p).toContain(q)
    }
    expect(p).not.toContain(mustAskLines('downlights')[0])
    expect(p).not.toContain('ELECTRICAL JOBS')
  })

  it('electrical + plumbing carries both trees', () => {
    const p = buildVoiceSystemPrompt('Acme Trades', ['electrical', 'plumbing'])
    expect(p).toContain('ELECTRICAL JOBS')
    expect(p).toContain('PLUMBING JOBS')
    expect(p).toContain(mustAskLines('downlights')[0])
    expect(p).toContain(mustAskLines('hot_water')[0])
  })
})

describe('buildVoiceSystemPrompt — qualify-only trades (lead capture, no auto-quote)', () => {
  it('roofing gets its questions + closing, no electrical questions, no price', () => {
    const p = buildVoiceSystemPrompt('Top Roof Co', ['roofing'])
    for (const q of VOICE_TRADE_QUESTIONS.roofing.questions) expect(p).toContain(q)
    expect(p).toContain(VOICE_TRADE_QUESTIONS.roofing.closing)
    expect(p).toContain('no price on the call')
    expect(p).not.toContain(mustAskLines('downlights')[0])
  })

  it('all seven trades compose without collision', () => {
    const p = buildVoiceSystemPrompt('Everything Trades', [
      'electrical', 'plumbing', 'roofing', 'painting', 'solar', 'aircon', 'commercial_painting',
    ])
    expect(p).toContain('ELECTRICAL JOBS')
    expect(p).toContain('PLUMBING JOBS')
    expect(p).toContain('ROOFING (lead capture')
    expect(p).toContain('PAINTING (lead capture')
    expect(p).toContain('SOLAR (lead capture')
    expect(p).toContain('AIRCON (lead capture')
    expect(p).toContain('COMMERCIAL PAINTING (lead capture')
  })
})

describe('buildVoiceSystemPrompt — Supabase custom-service MUST-ASK (mirrors SMS)', () => {
  const services = [
    {
      name: 'Install EV charger',
      description: 'Wall-mounted EV charger',
      always_inspection: false,
      clarifying_questions: [
        'Is the charger on-site, and which model is it?',
        'Roughly how far is the parking spot from the switchboard?',
      ],
    },
    {
      name: 'Switchboard upgrade',
      always_inspection: true,
      clarifying_questions: ['Old ceramic fuses or modern breakers?'],
    },
  ]

  it('renders each enabled service and its DB MUST-ASK questions', () => {
    const p = buildVoiceSystemPrompt('Acme', ['electrical'], undefined, services)
    expect(p).toContain('Install EV charger')
    expect(p).toContain('Is the charger on-site, and which model is it?')
    expect(p).toContain('MUST ASK before you finish')
  })

  it('splits auto-quote vs inspection-only by always_inspection', () => {
    const p = buildVoiceSystemPrompt('Acme', ['electrical'], undefined, services)
    expect(p).toContain('AUTO-QUOTE services')
    expect(p).toContain('INSPECTION-ONLY services')
    expect(p).toContain('Switchboard upgrade')
  })

  it('omits the section entirely when no custom services are passed', () => {
    const p = buildVoiceSystemPrompt('Acme', ['electrical'])
    expect(p).not.toContain('SERVICES THIS BUSINESS OFFERS')
  })
})

describe('buildVoiceSystemPrompt — unknown / widened trade', () => {
  it('a registered-but-unscripted trade falls back to a generic lead-capture block', () => {
    const p = buildVoiceSystemPrompt('Sign Guys', ['signage'])
    expect(p).toContain('an Australian signage contractor')
    expect(p).toContain('SIGNAGE (lead capture')
    expect(p).toContain('What exactly do you need done?')
  })

  it('composes for a brand-new trade name (type widened — §3 voice blocker)', () => {
    const p = buildVoiceSystemPrompt('Hammer & Co', ['carpentry'])
    expect(p).toContain('an Australian carpentry contractor')
    expect(p).toContain('carpentry job')
  })
})
