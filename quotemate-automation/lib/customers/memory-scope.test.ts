// US-004 — customers rows are globally unique by phone number, so the
// remembered profile (name, suburb, address, email, total_quotes) leaked
// across tenants: a customer of tenant A texting tenant B was greeted by
// name with A's history in B's prompt (2026-07-23 audit). Memory may only
// be replayed to the tenant it belongs to.

import { describe, it, expect } from 'vitest'
import { customerMemoryAllowed, stripCustomerMemory } from './memory-scope'
import type { CustomerProfile } from './lookup'

describe('customerMemoryAllowed', () => {
  it('allows memory when the customer belongs to the resolved tenant', () => {
    expect(customerMemoryAllowed('t1', 't1')).toBe(true)
  })

  it('BLOCKS memory when the customer belongs to a different tenant', () => {
    expect(customerMemoryAllowed('t1', 't2')).toBe(false)
  })

  it('legacy rows with no tenant stamp stay usable (first-writer-wins will stamp them)', () => {
    expect(customerMemoryAllowed(null, 't1')).toBe(true)
    expect(customerMemoryAllowed(undefined, 't1')).toBe(true)
  })

  it('no tenant resolved (shared/dev number) keeps memory', () => {
    expect(customerMemoryAllowed('t1', null)).toBe(true)
    expect(customerMemoryAllowed(null, null)).toBe(true)
  })
})

describe('stripCustomerMemory', () => {
  const full: CustomerProfile = {
    id: 'c1',
    phone_number: '+61414530836',
    first_name: 'Mark',
    full_name: 'Mark Smith',
    email: 'mark@example.com',
    address: '670 London Rd',
    suburb: 'Chandler',
    notes: 'VIP',
    preferred_channel: 'sms',
    total_quotes: 53,
    total_bookings: 2,
    first_contacted_at: '2026-01-01',
    last_contacted_at: '2026-07-23',
    tenant_id: 'tenant-a',
  }

  it('keeps identity for linking but withholds everything a prompt could leak', () => {
    const s = stripCustomerMemory(full)!
    expect(s.id).toBe('c1')
    expect(s.phone_number).toBe('+61414530836')
    expect(s.first_name).toBeNull()
    expect(s.full_name).toBeNull()
    expect(s.email).toBeNull()
    expect(s.address).toBeNull()
    expect(s.suburb).toBeNull()
    expect(s.notes).toBeNull()
    expect(s.total_quotes).toBe(0)
    expect(s.total_bookings).toBe(0)
  })

  it('null in, null out', () => {
    expect(stripCustomerMemory(null)).toBeNull()
  })
})
