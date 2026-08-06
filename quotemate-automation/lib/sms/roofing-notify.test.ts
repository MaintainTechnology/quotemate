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

// ── booking_confirmed — the customer picked a time ──────────────────
//
// Live 2026-07-27: token ff6f67ce… took a $69,652 quote, a paid deposit and a
// Fri 31 Jul 12:00pm slot, and Jeph heard nothing. The quotes funnel has done
// this since lib/quote/booking-notify.ts; the roofing/painting funnel was
// built in parallel and this half was never ported.
describe('buildRoofingTradieNotification — booking_confirmed', () => {
  const BOOKED = {
    kind: 'booking_confirmed' as const,
    tradieFirstName: 'Jeph',
    customerName: null,
    customerPhone: '+61480808517',
    address: '670 London Rd, Chandler QLD 4155',
    betterIncGst: 69652,
    quoteUrl: 'https://www.quotemax.com.au/q/roof/ff6f67ce',
    scheduledAt: '2026-07-31T02:00:00.000Z',
    timeZone: 'Australia/Brisbane',
  }

  it('AC1 renders the slot, the served price and the property', () => {
    expect(buildRoofingTradieNotification(BOOKED)).toBe(
      'Hi Jeph - roofing job BOOKED via SMS for Fri, 31 July, 12:00pm.\n' +
        'Customer: +61480808517\n' +
        'Property: 670 London Rd, Chandler QLD 4155\n' +
        'Quoted: $69,652 inc GST (deposit paid)\n' +
        'Details: https://www.quotemax.com.au/q/roof/ff6f67ce',
    )
  })

  it('AC2 tradeLabel swaps the trade word so painting reuses the module', () => {
    const text = buildRoofingTradieNotification({ ...BOOKED, tradeLabel: 'painting' })
    expect(text).toContain('painting job BOOKED')
    expect(text).not.toContain('roofing')
  })

  it('AC3 renders in the tenant timezone — Perth reads 10:00am, not 12:00pm', () => {
    const text = buildRoofingTradieNotification({ ...BOOKED, timeZone: 'Australia/Perth' })
    expect(text).toContain('Fri, 31 July, 10:00am')
  })

  it('AC1 a named customer shows name and number, like the other kinds', () => {
    expect(buildRoofingTradieNotification({ ...BOOKED, customerName: 'Sam' })).toContain(
      'Customer: Sam (+61480808517)',
    )
  })

  it('AC1 an unpriced booking omits the Quoted line rather than saying $0', () => {
    const text = buildRoofingTradieNotification({ ...BOOKED, betterIncGst: null })
    expect(text).not.toContain('Quoted:')
    expect(text).not.toContain('$')
    expect(text).toContain('BOOKED via SMS for Fri, 31 July, 12:00pm')
  })
})

// AC2 — the three shipped kinds must not shift by a byte while a fourth is
// added beside them. These are the exact strings production sends today.
describe('AC2 existing kinds are byte-identical', () => {
  const BASE = {
    tradieFirstName: 'Jeph',
    customerName: null,
    customerPhone: '+61480808517',
    address: '670 London Rd, Chandler QLD 4155',
    quoteUrl: 'https://www.quotemax.com.au/q/roof/ff6f67ce',
  }

  it('quote_sent', () => {
    expect(buildRoofingTradieNotification({ ...BASE, kind: 'quote_sent', betterIncGst: 69652 })).toBe(
      'Hi Jeph - roofing quote sent via SMS at $69,652 inc GST.\n' +
        'Customer: +61480808517\n' +
        'Property: 670 London Rd, Chandler QLD 4155\n' +
        'Review: https://www.quotemax.com.au/q/roof/ff6f67ce',
    )
  })

  it('inspection_booked', () => {
    expect(
      buildRoofingTradieNotification({ ...BASE, kind: 'inspection_booked', betterIncGst: null }),
    ).toBe(
      'Hi Jeph - new roofing INSPECTION booked via SMS.\n' +
        'Customer: +61480808517\n' +
        'Property: 670 London Rd, Chandler QLD 4155\n' +
        'Details: https://www.quotemax.com.au/q/roof/ff6f67ce\n' +
        'Reply to the customer to lock in a time.',
    )
  })

  // A painting inspection used to text the painter "new ROOFING inspection
  // booked" — the module is roofing-named but painting reuses it, and only
  // booking_confirmed honoured tradeLabel.
  it('inspection_booked names the trade it was given', () => {
    expect(
      buildRoofingTradieNotification({
        ...BASE, kind: 'inspection_booked', betterIncGst: null, tradeLabel: 'painting',
      }),
    ).toContain('new painting INSPECTION booked via SMS.')
  })

  it('question_asked', () => {
    expect(
      buildRoofingTradieNotification({
        ...BASE,
        kind: 'question_asked',
        betterIncGst: null,
        question: 'do you blokes work Saturdays?',
      }),
    ).toBe(
      'Hi Jeph - a customer asked something the SMS receptionist could not answer.\n' +
        'Customer: +61480808517\n' +
        'They asked: do you blokes work Saturdays?\n' +
        'We told them you would come back to them.',
    )
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

  // AC6 — the guard above is correct in production and made the whole feature
  // untestable from the owner handset: Sparky's owner_mobile IS the number
  // used to test, so every alert vanished with no log line. Escape hatch, off
  // by default, plus a reason on both suppression paths.
  it('AC6 TRADIE_NOTIFY_SELF_TEST=1 lets the tradie test from their own handset', async () => {
    process.env.TRADIE_NOTIFY_SELF_TEST = '1'
    const dispatch = vi.fn(async () => ({ ok: true }))
    const r = await notifyRoofingTradie({
      ...args({ customerPhone: TENANT.owner_mobile }),
      dispatch,
    })
    expect(r.notified).toBe(true)
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ to: TENANT.owner_mobile }),
    )
  })

  it('AC6 the escape is OFF unless explicitly set to 1', async () => {
    for (const v of ['0', 'false', '', 'no']) {
      process.env.TRADIE_NOTIFY_SELF_TEST = v
      const dispatch = vi.fn(async () => ({ ok: true }))
      const r = await notifyRoofingTradie({
        ...args({ customerPhone: TENANT.owner_mobile }),
        dispatch,
      })
      expect(r.notified, `TRADIE_NOTIFY_SELF_TEST=${JSON.stringify(v)}`).toBe(false)
    }
  })

  it('AC6 a suppressed notify says WHY instead of returning silently', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    delete process.env.TRADIE_NOTIFY_SELF_TEST

    await notifyRoofingTradie({
      ...args({ customerPhone: TENANT.owner_mobile }),
      dispatch: vi.fn(async () => ({ ok: true })),
    })
    expect(warn.mock.calls.flat().join(' ')).toMatch(/self-test|own handset|same number/i)

    warn.mockClear()
    delete process.env.TRADIE_NOTIFY_NUMBER
    await notifyRoofingTradie({
      ...args({ tenant: { ...TENANT, owner_mobile: null } }),
      dispatch: vi.fn(async () => ({ ok: true })),
    })
    expect(warn.mock.calls.flat().join(' ')).toMatch(/no notify number|owner_mobile/i)

    warn.mockRestore()
  })
})
