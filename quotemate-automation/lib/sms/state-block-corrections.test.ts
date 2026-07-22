// Regression pin for the "Got it, Chillingham not Chandler" hallucination.
//
// formatStateBlock() is injected verbatim into the dialog's system prompt,
// so anything it says is effectively customer-facing. It used to emit, for
// every corrected slot:
//
//   (e.g. "Got it, <new> not <previous value from history> - ...").
//
// with "<previous value from history>" as LITERAL text — nothing ever
// substituted it, and the previous value is provably absent from the
// prompt by that point (mergeSlotUpdates overwrites the slot in place and
// keeps no history; KNOWN VALUES renders post-merge values only; the
// customer-memory block that still held it is dropped by
// `stateBlock ?? args.customerContext`).
//
// The model was therefore ordered — under a "MUST acknowledge" directive —
// to name a value it could not see, and it invented one. Live 2026-07-22 a
// customer who texted "1434 NUMINBAH Road Chillingham NSW 2484" was told
// "Got it, Chillingham not Chandler", naming a suburb they never mentioned.

import { describe, it, expect } from 'vitest'
import { formatStateBlock } from './dialog'
import type { ConversationState } from './extract-slots'

const corrected: ConversationState = {
  slots: { suburb: 'Chillingham', address: '1434 Numinbah Road' },
  sources: { suburb: 'customer_corrected', address: 'customer_corrected' },
  last_extracted_at: null,
}

describe('formatStateBlock — customer corrections block', () => {
  it('renders the corrections block when a slot was corrected', () => {
    const block = formatStateBlock(corrected)
    expect(block).toContain('CUSTOMER CORRECTIONS')
    expect(block).toContain('Chillingham')
  })

  // THE BUG: an unsubstituted placeholder shipped into the live prompt.
  it('never emits an unsubstituted placeholder into the prompt', () => {
    const block = formatStateBlock(corrected) ?? ''
    expect(block).not.toContain('<previous value from history>')
    expect(block).not.toMatch(/<[a-z][a-z ]+>/)
  })

  // THE FIX: the model must not be asked to contrast against a value it
  // was never given. No "X not Y" template, and an explicit prohibition.
  it('does not instruct the model to name the previous value', () => {
    const block = formatStateBlock(corrected) ?? ''
    expect(block).not.toMatch(/\bnot <|Got it, .* not /)
    expect(block).toMatch(/Do NOT name, guess, or contrast against the previous value/)
  })

  // Load-bearing: scrubAskingForKnownSuburb assumes this instruction
  // exists when it bails on a customer_corrected suburb.
  it('keeps the corrected-value handshake instruction', () => {
    const block = formatStateBlock(corrected) ?? ''
    expect(block).toContain('Echo the CORRECTED value in your verification handshake')
  })

  it('omits the corrections block entirely when nothing was corrected', () => {
    const block = formatStateBlock({
      slots: { suburb: 'Chandler' },
      sources: { suburb: 'from_memory' },
      last_extracted_at: null,
    }) ?? ''
    expect(block).not.toContain('CUSTOMER CORRECTIONS')
  })
})
