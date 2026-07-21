import { describe, it, expect } from 'vitest'
import { thanksPageTarget, bookingRef } from './thanks'

describe('thanksPageTarget', () => {
  it('sends an unpaid visitor to pay, even when a slot is already held', () => {
    expect(thanksPageTarget({ paid: false, scheduledAt: null })).toBe('pay')
    expect(thanksPageTarget({ paid: false, scheduledAt: '2026-08-03T07:00:00+10:00' })).toBe('pay')
  })

  it('sends a paid visitor with no slot to the booking page', () => {
    expect(thanksPageTarget({ paid: true, scheduledAt: null })).toBe('book')
    expect(thanksPageTarget({ paid: true, scheduledAt: undefined })).toBe('book')
    expect(thanksPageTarget({ paid: true, scheduledAt: '' })).toBe('book')
  })

  it('renders only once the booking is both paid AND scheduled', () => {
    expect(thanksPageTarget({ paid: true, scheduledAt: '2026-08-03T07:00:00+10:00' })).toBe('render')
  })
})

describe('bookingRef', () => {
  it('takes the first 8 characters, uppercased', () => {
    expect(bookingRef('a1b2c3d4e5f6')).toBe('A1B2C3D4')
  })

  it('is empty for a missing token rather than throwing', () => {
    expect(bookingRef(null)).toBe('')
    expect(bookingRef(undefined)).toBe('')
    expect(bookingRef('')).toBe('')
  })

  it('tolerates a token shorter than 8 characters', () => {
    expect(bookingRef('abc')).toBe('ABC')
  })
})
