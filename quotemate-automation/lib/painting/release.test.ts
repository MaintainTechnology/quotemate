import { afterEach, describe, expect, it, vi } from 'vitest'
import { notifyPaintingTradie } from './release'

afterEach(() => vi.unstubAllEnvs())

describe('notifyPaintingTradie', () => {
  it('texts the tradie owner_mobile from the tenant number with the /p review link', async () => {
    const dispatch = vi.fn(async () => ({ ok: true }))
    const r = await notifyPaintingTradie({
      tenant: { owner_mobile: '+61400000000', owner_first_name: 'Jo', twilio_sms_number: '+61480000000' },
      customerName: 'Sam',
      address: '5 Smith St',
      betterIncGst: 5000,
      estimateToken: 'etok',
      appUrl: 'https://x.test',
      dispatch,
    })
    expect(r.notified).toBe(true)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+61400000000',
        from: '+61480000000',
        text: expect.stringContaining('https://x.test/p/etok'),
      }),
    )
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('5 Smith St') }),
    )
  })

  it('no-ops (no dispatch) when there is no notify number', async () => {
    vi.stubEnv('TRADIE_NOTIFY_NUMBER', '')
    const dispatch = vi.fn(async () => ({ ok: true }))
    const r = await notifyPaintingTradie({
      tenant: { owner_mobile: null, owner_first_name: null, twilio_sms_number: null },
      address: '5 Smith St',
      estimateToken: 'etok',
      appUrl: 'https://x.test',
      dispatch,
    })
    expect(r.notified).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })
})
