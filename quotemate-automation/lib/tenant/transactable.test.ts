// US-001 — a provisioned number whose tenant is not ACTIVE must not
// transact. Audit 2026-07-23: tenants.status was selected and logged but
// never gated, so a suspended or still-onboarding tenant's number ran the
// full AI pipeline and issued priced quotes.

import { describe, it, expect } from 'vitest'
import { isTransactableTenantStatus } from './lookup'

describe('isTransactableTenantStatus', () => {
  it('allows only active tenants to transact', () => {
    expect(isTransactableTenantStatus('active')).toBe(true)
  })

  it('blocks every non-active lifecycle state', () => {
    expect(isTransactableTenantStatus('suspended')).toBe(false)
    expect(isTransactableTenantStatus('onboarding')).toBe(false)
    expect(isTransactableTenantStatus('pending')).toBe(false)
    expect(isTransactableTenantStatus('cancelled')).toBe(false)
  })

  it('blocks null/undefined/garbage — fail closed', () => {
    expect(isTransactableTenantStatus(null)).toBe(false)
    expect(isTransactableTenantStatus(undefined)).toBe(false)
    expect(isTransactableTenantStatus('')).toBe(false)
    expect(isTransactableTenantStatus('ACTIVE ')).toBe(true) // case/space tolerant
  })
})
