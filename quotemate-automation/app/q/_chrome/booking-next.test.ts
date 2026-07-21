import { describe, it, expect } from 'vitest'
import { resolveBookingNext } from './booking-next'

describe('resolveBookingNext', () => {
  it('uses the API next field when present', () => {
    expect(
      resolveBookingNext({ ok: true, next: '/q/roof/abc/thanks' }, '/q/roof/abc/book'),
    ).toBe('/q/roof/abc/thanks')
  })

  it('falls back to the current path when next is missing', () => {
    expect(resolveBookingNext({ ok: true }, '/q/roof/abc/book')).toBe('/q/roof/abc/book')
  })

  it('falls back when next is empty or not a string', () => {
    expect(resolveBookingNext({ ok: true, next: '' }, '/x')).toBe('/x')
    expect(resolveBookingNext({ ok: true, next: 42 }, '/x')).toBe('/x')
    expect(resolveBookingNext({ ok: true, next: null }, '/x')).toBe('/x')
    expect(resolveBookingNext({}, '/x')).toBe('/x')
  })

  it('refuses an absolute off-site URL — open-redirect guard', () => {
    // The response is server-issued today, but this value is fed straight to
    // window.location.href. Anything that is not a same-origin relative path
    // must never be navigated to.
    expect(resolveBookingNext({ next: 'https://evil.example/steal' }, '/x')).toBe('/x')
    expect(resolveBookingNext({ next: 'http://evil.example' }, '/x')).toBe('/x')
  })

  it('refuses a protocol-relative URL — //host is off-site too', () => {
    expect(resolveBookingNext({ next: '//evil.example' }, '/x')).toBe('/x')
    expect(resolveBookingNext({ next: '//evil.example/q/abc/thanks' }, '/x')).toBe('/x')
  })

  it('refuses a scheme-bearing value that is not http', () => {
    expect(resolveBookingNext({ next: 'javascript:alert(1)' }, '/x')).toBe('/x')
  })
})
