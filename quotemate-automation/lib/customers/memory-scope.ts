// US-004: tenant-scoped customer memory (2026-07-23 audit).
//
// customers.phone_number is GLOBALLY unique — one profile per handset,
// shared by every tenant that number ever texts. The profile (name,
// suburb, address, email, total_quotes) must only be replayed to the
// tenant it belongs to; tenant B greeting tenant A's customer by name
// with A's history in the prompt is a cross-tenant leak.
//
// PURE — separate from lookup.ts because that module creates a supabase
// client at import time; these decisions are unit-tested without it.

import type { CustomerProfile } from './lookup'

/** PURE — may this customer's remembered profile be shown to this tenant?
 *  Blocked only when BOTH sides are known and different. Legacy rows
 *  (tenant_id null — first-writer-wins will stamp them) and the shared/dev
 *  number (no tenant resolved) keep memory. */
export function customerMemoryAllowed(
  customerTenantId: string | null | undefined,
  tenantId: string | null | undefined,
): boolean {
  if (!customerTenantId || !tenantId) return true
  return customerTenantId === tenantId
}

/** PURE — the same customer with the remembered profile withheld: identity
 *  (id, phone) is kept so intake/quote linking still works; everything a
 *  prompt or greeting could leak is nulled. */
export function stripCustomerMemory(c: CustomerProfile | null): CustomerProfile | null {
  if (!c) return null
  return {
    ...c,
    first_name: null,
    full_name: null,
    email: null,
    address: null,
    suburb: null,
    notes: null,
    total_quotes: 0,
    total_bookings: 0,
  }
}
