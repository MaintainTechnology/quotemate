import { describe, it, expect } from 'vitest'
import { repairQuoteLinks } from './dialog'

// The correct roof link, as sent 4x by the deterministic composer earlier in
// the thread; the token is a real randomBytes(16).toString('hex').
const GOOD = 'https://www.quotemax.com.au/q/roof/fd876dcd7b1ea5d527f4f4a28d0c0663?s=1'
// Sonnet's re-quote of it, with one extra "7" in the token (the live 404).
const MANGLED = 'https://www.quotemax.com.au/q/roof/fd876dcd77b1ea5d527f4f4a28d0c0663?s=1'

describe('repairQuoteLinks', () => {
  it('snaps a token mangled by one character back to the real link (the live bug)', () => {
    const history = `outbound: Full breakdown + your roof image: ${GOOD}`
    const reply = `Good one Mark - the next step is a roofer reviewing that estimate. You can also view the full breakdown here: ${MANGLED} - did you want to proceed?`
    const out = repairQuoteLinks(reply, history)
    expect(out).toContain(GOOD)
    expect(out).not.toContain(MANGLED)
  })

  it('leaves an already-correct link untouched', () => {
    const reply = `Here it is: ${GOOD}`
    expect(repairQuoteLinks(reply, `sent earlier: ${GOOD}`)).toBe(reply)
  })

  it('picks the nearest token when the thread has several links of the same shape', () => {
    const a = 'https://www.quotemax.com.au/q/roof/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const b = 'https://www.quotemax.com.au/q/roof/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    // mangled copy of b (one char off) must snap to b, not a
    const mangledB = 'https://www.quotemax.com.au/q/roof/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbc'
    const out = repairQuoteLinks(`see ${mangledB}`, `${a}\n${b}`)
    expect(out).toContain(b)
    expect(out).not.toContain(a)
  })

  it('does not touch non-quote URLs (tenant site, maps)', () => {
    const reply = 'Our site https://atomicelectrical.com.au and map https://maps.google.com/?q=x'
    expect(repairQuoteLinks(reply, GOOD)).toBe(reply)
  })

  it('leaves a link alone when there is nothing to repair against', () => {
    const reply = `view here: ${MANGLED}`
    expect(repairQuoteLinks(reply, 'no links in this thread at all')).toBe(reply)
  })

  it('preserves trailing punctuation around the repaired link', () => {
    const reply = `here: ${MANGLED}.`
    const out = repairQuoteLinks(reply, GOOD)
    expect(out).toBe(`here: ${GOOD}.`)
  })

  it('repairs across different token surfaces (solar, generic) too', () => {
    const solarGood = 'https://www.quotemax.com.au/q/solar/0123456789abcdef0123456789abcdef'
    const solarBad = 'https://www.quotemax.com.au/q/solar/0123456789abcdef0123456789abcdeff'
    expect(repairQuoteLinks(`link: ${solarBad}`, solarGood)).toContain(solarGood)
  })
})
