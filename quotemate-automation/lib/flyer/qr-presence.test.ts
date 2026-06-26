import { describe, it, expect } from 'vitest'
import { customerQrs, hasCustomerQr, flyerQrAction } from './qr-presence'

describe('qr-presence', () => {
  it('treats no QRs as "generate"', () => {
    expect(hasCustomerQr([])).toBe(false)
    expect(flyerQrAction([])).toBe('generate')
  })

  it('a signup-only QR still counts as no customer QR (generate)', () => {
    const qrs = [{ destination_type: 'signup' }]
    expect(hasCustomerQr(qrs)).toBe(false)
    expect(customerQrs(qrs)).toHaveLength(0)
    expect(flyerQrAction(qrs)).toBe('generate')
  })

  it('a landing or sms QR flips the editor to "insert" (E2)', () => {
    expect(flyerQrAction([{ destination_type: 'landing' }])).toBe('insert')
    expect(flyerQrAction([{ destination_type: 'sms' }])).toBe('insert')
    const mixed = [{ destination_type: 'signup' }, { destination_type: 'landing' }]
    expect(customerQrs(mixed)).toHaveLength(1)
    expect(flyerQrAction(mixed)).toBe('insert')
  })
})
