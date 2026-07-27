import { describe, it } from 'vitest'
import { screenConfirmAddress } from '@/lib/sms/verify-address'

describe.skipIf(!process.env.LIVE_LLM)('live address verify + suggest', () => {
  it('screens the addresses from the live thread', { timeout: 300_000 }, async () => {
    for (const address of [
      '670 London Rd, Corparoo 4155',       // wrong suburb (was accepted unverified)
      '31 Greens Rd, Chandler QLD',          // failed lookup in the live thread
      '670 London Rd, Chandler 4155',        // good
      '15 Schofield drive safety each',      // the 2026-07-23 typo case
    ]) {
      const r = await screenConfirmAddress({ address })
      console.log(
        `\nIN   ${JSON.stringify(address)}\n` +
        `  step=${r.step ?? '-'} handoff=${r.handoff ?? false}\n` +
        `  addr=${JSON.stringify(r.slots.address)} postcode=${JSON.stringify(r.slots.postcode)}\n` +
        `  OUT  ${JSON.stringify(r.reply ?? '(plain read-back)')}`,
      )
    }
  })
})
