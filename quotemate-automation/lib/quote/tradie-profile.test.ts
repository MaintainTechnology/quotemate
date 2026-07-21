// Unit tests for the shared "Your tradie" block (spec: the customer quote PDF
// carries the same tradie identity the web customer view shows).

import { describe, it, expect } from 'vitest'
import { tradieProfile, TRADIE_AVATAR_PLACEHOLDER } from './tradie-profile'

describe('tradieProfile', () => {
  it('uses the tradie-uploaded photo when one is set', () => {
    const p = tradieProfile({
      businessName: 'Atomic Electrical',
      photoUrl: 'https://cdn.example.com/t/photo-1.jpg',
      trade: 'roofing',
    })
    expect(p.photoSrc).toBe('https://cdn.example.com/t/photo-1.jpg')
    expect(p.hasPhoto).toBe(true)
  })

  it('falls back to the placeholder avatar when no photo is set', () => {
    const p = tradieProfile({ businessName: 'Atomic Electrical', photoUrl: null, trade: 'roofing' })
    expect(p.photoSrc).toBe(TRADIE_AVATAR_PLACEHOLDER)
    expect(p.hasPhoto).toBe(false)
  })

  it('treats a blank / whitespace photo_url as unset', () => {
    expect(tradieProfile({ businessName: 'A', photoUrl: '   ' }).hasPhoto).toBe(false)
    expect(tradieProfile({ businessName: 'A', photoUrl: '' }).hasPhoto).toBe(false)
    expect(tradieProfile({ businessName: 'A', photoUrl: undefined }).hasPhoto).toBe(false)
  })

  it('rejects a non-https photo url (a public customer surface never loads http/javascript)', () => {
    expect(tradieProfile({ businessName: 'A', photoUrl: 'javascript:alert(1)' }).hasPhoto).toBe(false)
    expect(tradieProfile({ businessName: 'A', photoUrl: 'http://cdn.example.com/p.jpg' }).hasPhoto).toBe(
      false,
    )
  })

  it('keeps a data: URI (the PDF embeds the photo as one)', () => {
    const src = 'data:image/jpeg;base64,AAAA'
    expect(tradieProfile({ businessName: 'A', photoUrl: src }).photoSrc).toBe(src)
  })

  it('names the business and the trade in the blurb — the same sentence the web page shows', () => {
    const p = tradieProfile({ businessName: 'Atomic Electrical', trade: 'roofing' })
    expect(p.name).toBe('Atomic Electrical')
    expect(p.blurb).toBe('Atomic Electrical is a licensed local roofing business.')
  })

  it('uses the human trade label for multi-word trades', () => {
    expect(tradieProfile({ businessName: 'Acme', trade: 'commercial_painting' }).blurb).toBe(
      'Acme is a licensed local commercial painting business.',
    )
  })

  it('degrades to a trade-less sentence when the trade is unknown', () => {
    expect(tradieProfile({ businessName: 'Acme', trade: null }).blurb).toBe(
      'Acme is a licensed local business.',
    )
  })

  it('falls back to "Your tradie" when the business name is missing', () => {
    const p = tradieProfile({ businessName: null, trade: 'roofing' })
    expect(p.name).toBe('Your tradie')
    expect(p.blurb).toBe('Your tradie is a licensed local roofing business.')
  })

  it('placeholder is a self-contained data URI — a PDF render must never hit the network', () => {
    expect(TRADIE_AVATAR_PLACEHOLDER.startsWith('data:image/svg+xml')).toBe(true)
    // No external asset reference: the only URL inside is the SVG xmlns.
    const decoded = decodeURIComponent(TRADIE_AVATAR_PLACEHOLDER.split(',')[1] ?? '')
    expect(decoded).not.toMatch(/(href|src)\s*=/)
    expect(decoded.match(/https?:\/\//g) ?? []).toEqual(['http://'])
  })
})
