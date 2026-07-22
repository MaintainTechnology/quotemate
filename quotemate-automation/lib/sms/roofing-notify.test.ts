// US-002 — the roofing SMS path never notified the tradie: quotes and
// booked inspections landed in the DB and nobody was told (2026-07-23
// audit). Mirrors notifyPaintingTradie: injected dispatch, never throws,
// missing notify number just means no notification.

import { afterEach, describe, it, expect, vi } from 'vitest'
import { buildRoofingTradieNotification, notifyRoofingTradie } from './roofing-notify'

// One test deletes TRADIE_NOTIFY_NUMBER; restore so nothing leaks into
// other files sharing this worker's process.env.
const ENV = { ...process.env }
afterEach(() => {
  process.env = { ...ENV }
})

const TENANT = {
  owner_mobile: '+61400111222',
  owner_first_name: 'Bill',
  twilio_sms_number: '+61468011464',
}

describe('buildRoofingTradieNotification', () => {
  it('quote_sent carries customer, address, price and the quote link', () => {
    const text = buildRoofingTradieNotification({
      kind: 'quote_sent',
      tradieFirstName: 'Bill',
      customerName: 'Mark',
      customerPhone: '+61414530836',
      address: '670 London Road, Chandler, QLD, 4155',
      betterIncGst: 115117,
      quoteUrl: 'https://quotemax.com.au/q/roof/abc123',
    })
    expect(text).toContain('Mark')
    expect(text).toContain('670 London Road')
    expect(text).toContain('$115,117')
    expect(text).toContain('https://quotemax.com.au/q/roof/abc123')
    expect(text).toContain('+61414530836')
  })

  it('inspection_booked reads as a booking alert, price-free', () => {
    const text = buildRoofingTradieNotification({
      kind: 'inspection_booked',
      tradieFirstName: null,
      customerName: null,
      customerPhone: '+61401460956',
      address: '31 greens rd coorparoo 4151',
      betterIncGst: null,
      quoteUrl: 'https://quotemax.com.au/q/roof/def456',
    })
    expect(text.toLowerCase()).toContain('inspection')
    expect(text).toContain('31 greens rd coorparoo')
    expect(text).toContain('+61401460956')
    expect(text).not.toContain('$')
  })
})

describe('notifyRoofingTradie', () => {
  const args = (over: Record<string, unknown> = {}) => ({
    kind: 'quote_sent' as const,
    tenant: TENANT,
    customerName: 'Mark',
    customerPhone: '+61414530836',
    address: '670 London Road, Chandler',
    betterIncGst: 115117,
    quoteUrl: 'https://x/q/roof/abc',
    ...over,
  })

  it('dispatches to owner_mobile FROM the tenant number', async () => {
    const dispatch = vi.fn(async () => ({ ok: true }))
    const r = await notifyRoofingTradie({ ...args(), dispatch })
    expect(r.notified).toBe(true)
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+61400111222', from: '+61468011464' }),
    )
  })

  it('no owner_mobile and no fallback env → silently not notified', async () => {
    delete process.env.TRADIE_NOTIFY_NUMBER
    const dispatch = vi.fn(async () => ({ ok: true }))
    const r = await notifyRoofingTradie({
      ...args({ tenant: { ...TENANT, owner_mobile: null } }),
      dispatch,
    })
    expect(r.notified).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('never throws — a dispatch explosion reports notified:false', async () => {
    const dispatch = vi.fn(async () => {
      throw new Error('twilio down')
    })
    const r = await notifyRoofingTradie({ ...args(), dispatch })
    expect(r.notified).toBe(false)
  })

  it('never notifies the customer themselves (owner_mobile === customer phone guard)', async () => {
    // Dev/self-testing: the tradie texts their own provisioned number. A
    // notify to the same handset that just received the quote is noise.
    const dispatch = vi.fn(async () => ({ ok: true }))
    const r = await notifyRoofingTradie({
      ...args({ customerPhone: TENANT.owner_mobile }),
      dispatch,
    })
    expect(r.notified).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })
})
