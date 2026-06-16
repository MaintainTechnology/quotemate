import { describe, it, expect } from 'vitest'
import { buildTradieWebLeadAlert } from './templates'

describe('buildTradieWebLeadAlert', () => {
  it('includes tradie name, customer first name, suburb and a trimmed description', () => {
    const body = buildTradieWebLeadAlert({
      tradieFirstName: 'Jon',
      customerName: 'Jeph Daligdig',
      suburb: 'Bondi',
      description: 'I need 6 downlights installed in the lounge',
    })
    expect(body).toContain('Jon')
    expect(body).toContain('Jeph')
    expect(body).toContain('Bondi')
    expect(body).toContain('downlights')
    expect(body).toContain('texting them now')
    expect(body.length).toBeLessThanOrEqual(320)
  })

  it('handles a missing tradie first name and clamps a very long description', () => {
    const body = buildTradieWebLeadAlert({
      tradieFirstName: null,
      customerName: 'Sam',
      suburb: 'Newtown',
      description: 'x'.repeat(400),
    })
    expect(body.length).toBeLessThanOrEqual(320)
    expect(body).toContain('Sam')
    expect(body).toContain('Newtown')
    expect(body.startsWith('Hi')).toBe(false) // no greeting when first name absent
  })
})
