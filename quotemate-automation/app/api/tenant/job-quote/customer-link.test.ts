import { describe, it, expect } from 'vitest'
import { normaliseAuMobile } from '@/lib/phone/au'
import { customerMemoryAllowed } from '@/lib/customers/memory-scope'

// ════════════════════════════════════════════════════════════════════
// The two rules the job-quote route applies to a tradie-typed mobile. The route
// itself can't be exercised without a live Supabase, so these assert the exact
// composition it performs — the shape the route's own lines mirror.
// ════════════════════════════════════════════════════════════════════

/** What the route stores on intake.caller.phone (route.ts). */
const callerPhone = (raw: string) => normaliseAuMobile(raw) ?? (raw || null)

/** What the route stamps as customer_id (route.ts). */
const stampedCustomerId = (
  cust: { id: string; tenant_id: string | null } | null,
  tenantId: string,
) => (cust && customerMemoryAllowed(cust.tenant_id, tenantId) ? cust.id : null)

describe('the mobile that reaches intake.caller.phone', () => {
  it("normalises what a tradie actually types into the E.164 Twilio needs", () => {
    // findOrCreateCustomer matches on EXACT phone_number equality and every live
    // row is +61-prefixed, so storing the raw string would mint a record nothing
    // ever matches — and recipient source #1 for Send reads this field.
    expect(callerPhone('0400 123 456')).toBe('+61400123456')
    expect(callerPhone('0400123456')).toBe('+61400123456')
    expect(callerPhone('+61 400 123 456')).toBe('+61400123456')
    expect(callerPhone('(04) 0012 3456')).toBe('+61400123456')
  })

  it('falls back to the raw string rather than dropping a number it cannot parse', () => {
    // A landline or an overseas number is still worth showing a human on the
    // quote page, even though Send cannot use it.
    expect(callerPhone('02 9999 8888')).toBe('02 9999 8888')
    expect(callerPhone('not a phone')).toBe('not a phone')
  })

  it('is null when the tradie left it blank', () => {
    expect(callerPhone('')).toBeNull()
  })
})

describe('the cross-tenant customer guard', () => {
  const TENANT_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  const TENANT_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'

  it("does NOT stamp another tenant's customer row", () => {
    // customers is GLOBALLY phone-keyed and findOrCreateCustomer returns the
    // matched row unchanged, so without this gate a tradie typing a mobile that
    // belongs to another tradie's customer would link — and surface that
    // customer's contact details on their own dashboard.
    const other = { id: 'cust-1', tenant_id: TENANT_A }
    expect(stampedCustomerId(other, TENANT_B)).toBeNull()
  })

  it('stamps our own customer', () => {
    expect(stampedCustomerId({ id: 'cust-1', tenant_id: TENANT_A }, TENANT_A)).toBe('cust-1')
  })

  it('adopts a legacy row with no tenant stamped', () => {
    // First-writer-wins on unattributed rows — the same rule the SMS route uses.
    expect(stampedCustomerId({ id: 'cust-1', tenant_id: null }, TENANT_A)).toBe('cust-1')
  })

  it('is null when no customer resolved at all', () => {
    expect(stampedCustomerId(null, TENANT_A)).toBeNull()
  })
})
