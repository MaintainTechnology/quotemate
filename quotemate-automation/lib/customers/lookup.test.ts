// U1 (2026-07-24 audit) — customers rows are phone-keyed and GLOBALLY unique,
// so both write sinks target whatever tenant owns the row for that phone. A
// tenant B intake must never overwrite tenant A's customer record. The gate is
// the same customerMemoryAllowed predicate the READ side already uses.
//
// London-school: lookup.ts builds a supabase client at import, so the client is
// mocked and we assert the sink never issues an .update() on a cross-tenant hit.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const state: { row: Record<string, unknown> | null; updates: unknown[] } = { row: null, updates: [] }

vi.mock('@supabase/supabase-js', () => {
  const builder = () => {
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = () => b
    b.maybeSingle = async () => ({ data: state.row, error: null })
    b.update = (payload: unknown) => {
      state.updates.push(payload)
      return { eq: async () => ({ error: null }) }
    }
    b.insert = () => ({ select: () => ({ single: async () => ({ data: state.row, error: null }) }) })
    return b
  }
  return { createClient: () => ({ from: () => builder() }) }
})

// Address path hits the network via verifyAuAddress — the U1 tests use
// name/suburb only, so it is never reached; stub it defensively anyway.
vi.mock('@/lib/sms/verify-address', () => ({
  verifyAuAddress: async () => ({ outcome: 'match', formatted: '', postcode: null, state: null, corrected: false }),
  gateUnverifiedProfileAddress: (f: unknown) => f,
}))

import { updateCustomerFromIntake, writeCustomerCorrections } from './lookup'

beforeEach(() => {
  state.row = null
  state.updates = []
})

describe('updateCustomerFromIntake — U1 tenant-scoped write', () => {
  it('SKIPS the write when the row belongs to a different tenant', async () => {
    state.row = { id: 'c1', tenant_id: 'tenant-A', total_quotes: 5, full_name: null, first_name: null, email: null, address: null, suburb: null }
    await updateCustomerFromIntake({ customerId: 'c1', tenantId: 'tenant-B', intake: { caller: { name: 'Mark' }, suburb: 'Bondi' } })
    expect(state.updates).toHaveLength(0)
  })

  it('WRITES when the tenant matches', async () => {
    state.row = { id: 'c1', tenant_id: 'tenant-A', total_quotes: 5, full_name: null, first_name: null, email: null, address: null, suburb: null }
    await updateCustomerFromIntake({ customerId: 'c1', tenantId: 'tenant-A', intake: { caller: { name: 'Mark' }, suburb: 'Bondi' } })
    expect(state.updates).toHaveLength(1)
  })

  it('WRITES (heals) when the row has no tenant stamp', async () => {
    state.row = { id: 'c1', tenant_id: null, total_quotes: 0, full_name: null, first_name: null, email: null, address: null, suburb: null }
    await updateCustomerFromIntake({ customerId: 'c1', tenantId: 'tenant-B', intake: { caller: { name: 'Mark' }, suburb: 'Bondi' } })
    expect(state.updates).toHaveLength(1)
  })

  it('WRITES for a tenant-less intake (legacy/dev number)', async () => {
    state.row = { id: 'c1', tenant_id: 'tenant-A', total_quotes: 0, full_name: null, first_name: null, email: null, address: null, suburb: null }
    await updateCustomerFromIntake({ customerId: 'c1', tenantId: null, intake: { caller: { name: 'Mark' }, suburb: 'Bondi' } })
    expect(state.updates).toHaveLength(1)
  })
})

describe('writeCustomerCorrections — U1 tenant-scoped write', () => {
  it('SKIPS the eager write when the row belongs to a different tenant', async () => {
    state.row = { id: 'c1', tenant_id: 'tenant-A' }
    await writeCustomerCorrections({ customerId: 'c1', tenantId: 'tenant-B', fields: { first_name: 'Mark' } })
    expect(state.updates).toHaveLength(0)
  })

  it('WRITES the eager correction when the tenant matches', async () => {
    state.row = { id: 'c1', tenant_id: 'tenant-A' }
    await writeCustomerCorrections({ customerId: 'c1', tenantId: 'tenant-A', fields: { first_name: 'Mark' } })
    expect(state.updates).toHaveLength(1)
  })

  it('WRITES (heals) when the row has no tenant stamp', async () => {
    state.row = { id: 'c1', tenant_id: null }
    await writeCustomerCorrections({ customerId: 'c1', tenantId: 'tenant-B', fields: { first_name: 'Mark' } })
    expect(state.updates).toHaveLength(1)
  })
})
