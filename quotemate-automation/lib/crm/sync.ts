// Pure helper: turn raw CRM contacts into normalised, deduped rows ready to
// upsert into crm_contacts. Emails are normalised (trimmed + lowercased) so the
// (tenant_id, email) unique index dedups correctly across re-syncs and across
// providers. Invalid addresses are dropped. Kept pure so it's unit-testable.

import { isValidEmail, normalizeEmail } from '@/lib/email/recipients'
import type { CrmContact } from '@/lib/crm/provider'

export type ContactUpsertRow = {
  tenant_id: string
  connection_id: string
  email: string
  first_name: string | null
  last_name: string | null
  external_id: string | null
}

export function prepareContactRows(
  tenantId: string,
  connectionId: string,
  contacts: CrmContact[],
): ContactUpsertRow[] {
  const seen = new Set<string>()
  const rows: ContactUpsertRow[] = []
  for (const c of contacts) {
    const email = normalizeEmail(c.email)
    if (!isValidEmail(email)) continue
    if (seen.has(email)) continue
    seen.add(email)
    rows.push({
      tenant_id: tenantId,
      connection_id: connectionId,
      email,
      first_name: c.firstName?.trim() || null,
      last_name: c.lastName?.trim() || null,
      external_id: c.externalId ?? null,
    })
  }
  return rows
}
