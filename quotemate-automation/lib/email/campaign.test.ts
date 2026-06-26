import { describe, expect, it, vi } from 'vitest'
import { sendCampaign, summarizeOutcomes } from '@/lib/email/campaign'
import type { Contact } from '@/lib/email/recipients'

const contacts = (n: number): Contact[] =>
  Array.from({ length: n }, (_, i) => ({ email: `lead${i}@x.com`, first_name: `L${i}` }))

const okMsg = () => ({ subject: 's', html: 'h', text: 't' })

describe('sendCampaign', () => {
  it('returns a sent outcome with messageId per recipient on success', async () => {
    const send = vi.fn(async () => ({ ok: true as const, messageId: 'm1' }))
    const out = await sendCampaign({ recipients: contacts(3), buildMessage: okMsg, send })
    expect(out).toHaveLength(3)
    expect(out.every((o) => o.status === 'sent' && o.messageId === 'm1')).toBe(true)
    expect(send).toHaveBeenCalledTimes(3)
    expect(summarizeOutcomes(out)).toEqual({ sent: 3, failed: 0 })
  })

  it('records a failed outcome (with reason) without aborting the rest', async () => {
    const send = vi.fn(async ({ to }: { to: string }) =>
      to === 'lead1@x.com'
        ? { ok: false as const, reason: 'bounced' }
        : { ok: true as const, messageId: 'm' },
    )
    const out = await sendCampaign({ recipients: contacts(3), buildMessage: okMsg, send })
    expect(summarizeOutcomes(out)).toEqual({ sent: 2, failed: 1 })
    const failed = out.find((o) => o.status === 'failed')
    expect(failed).toMatchObject({ email: 'lead1@x.com', error: 'bounced' })
  })

  it('captures a throw from send as a failed outcome', async () => {
    const send = vi.fn(async () => { throw new Error('kaboom') })
    const out = await sendCampaign({ recipients: contacts(2), buildMessage: okMsg, send })
    expect(summarizeOutcomes(out)).toEqual({ sent: 0, failed: 2 })
    expect(out[0]).toMatchObject({ status: 'failed', error: 'kaboom' })
  })

  it('personalises via buildMessage per recipient', async () => {
    const send = vi.fn(
      async (_msg: { to: string; subject: string; html: string; text: string }) => ({
        ok: true as const,
        messageId: 'm',
      }),
    )
    const buildMessage = vi.fn((c: Contact) => ({ subject: `Hi ${c.first_name}`, html: 'h', text: 't' }))
    await sendCampaign({ recipients: contacts(2), buildMessage, send })
    expect(buildMessage).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][0]).toMatchObject({ to: 'lead0@x.com', subject: 'Hi L0' })
  })

  it('preserves recipient order in outcomes even with concurrency', async () => {
    const send = vi.fn(async () => ({ ok: true as const, messageId: 'm' }))
    const out = await sendCampaign({ recipients: contacts(20), buildMessage: okMsg, send, concurrency: 5 })
    expect(out.map((o) => o.email)).toEqual(contacts(20).map((c) => c.email))
  })

  it('never exceeds the concurrency limit of in-flight sends', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const send = vi.fn(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return { ok: true as const, messageId: 'm' }
    })
    await sendCampaign({ recipients: contacts(12), buildMessage: okMsg, send, concurrency: 3 })
    expect(maxInFlight).toBeLessThanOrEqual(3)
  })

  it('handles an empty recipient list', async () => {
    const send = vi.fn()
    const out = await sendCampaign({ recipients: [], buildMessage: okMsg, send })
    expect(out).toEqual([])
    expect(send).not.toHaveBeenCalled()
  })
})
