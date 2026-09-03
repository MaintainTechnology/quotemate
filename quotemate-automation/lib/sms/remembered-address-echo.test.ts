// R5(a)/(d) post-review fix (2026-09-03).
//
// The build removed the customer-memory address backfill, but the SMS dialog
// still listed that address in its "CURRENT JOB STATE" block — a block whose
// own wording says "This block supersedes any earlier prompt section", "use
// these values verbatim" and "do NOT re-ask any of these".
//
// So for a returning customer the bot could speak a six-week-old roofing
// address back at them, it would land in the transcript, the structurer would
// read it as this job's address, and the incident reproduces one layer deeper.
// It also silently satisfied rule 10b ("ask for the street address once"),
// which is the rule meant to obtain a real one.
import { describe, expect, it } from 'vitest'
import { formatStateBlock } from './dialog'

type State = Parameters<typeof formatStateBlock>[0]

function state(over: Record<string, unknown> = {}): State {
  return {
    slots: { first_name: 'Jon', suburb: 'Chandler', address: '652 London Rd' },
    sources: { first_name: 'from_transcript', suburb: 'from_transcript', address: 'from_memory' },
    ...over,
  } as State
}

describe('a remembered street address is never handed back to the customer', () => {
  it('is withheld from KNOWN VALUES when it came from memory', () => {
    const block = formatStateBlock(state())!
    expect(block).not.toContain('652 London Rd')
    // The rest of what we know still travels.
    expect(block).toContain('Jon')
    expect(block).toContain('Chandler')
  })

  it('tells the model an address exists but must not be stated back', () => {
    const block = formatStateBlock(state())!
    expect(block).toContain('EARLIER job')
    expect(block).toMatch(/do NOT state it back/i)
    expect(block).toMatch(/rule 10b/i)
  })

  it('KEEPS an address the customer typed in this conversation', () => {
    const block = formatStateBlock(
      state({
        sources: {
          first_name: 'from_transcript',
          suburb: 'from_transcript',
          address: 'from_transcript',
        },
      }),
    )!
    expect(block).toContain('652 London Rd')
    expect(block).not.toContain('EARLIER job')
  })

  it('keeps a corrected address — the customer fixed it themselves', () => {
    const block = formatStateBlock(
      state({
        sources: {
          first_name: 'from_transcript',
          suburb: 'from_transcript',
          address: 'customer_corrected',
        },
      }),
    )!
    expect(block).toContain('652 London Rd')
  })

  it('still renders a block when the memory address was the only slot', () => {
    const block = formatStateBlock({
      slots: { address: '652 London Rd' },
      sources: { address: 'from_memory' },
    } as State)
    expect(block).not.toBeNull()
    expect(block!).not.toContain('652 London Rd')
    expect(block!).toContain('EARLIER job')
  })
})
