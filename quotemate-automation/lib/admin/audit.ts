// admin_audit_log writer/reader for the admin customer console
// (migration 135). Append-only: the console only ever INSERTs a row after
// a mutation has SUCCEEDED, so a failed action never leaves a "success"
// audit row (spec R18). There is deliberately no update/delete path.

import type { SupabaseClient } from '@supabase/supabase-js'

export type AdminAuditAction =
  | 'suspend'
  | 'reactivate'
  | 'set_billing_exempt'
  | 'update_trades'
  | 'change_plan'
  | 'start_subscription'

export type AdminAuditEntry = {
  adminUserId: string
  tenantId: string
  action: AdminAuditAction
  before: Record<string, unknown>
  after: Record<string, unknown>
}

export type AdminAuditRow = {
  id: string
  admin_user_id: string
  tenant_id: string
  action: AdminAuditAction
  before: Record<string, unknown>
  after: Record<string, unknown>
  created_at: string
}

/**
 * Append one immutable row to admin_audit_log. Call ONLY after the
 * underlying mutation succeeded. Returns the result so a caller can log a
 * failed write without failing the (already-committed) mutation.
 */
export async function writeAuditLog(
  supabase: SupabaseClient,
  entry: AdminAuditEntry,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from('admin_audit_log').insert({
    admin_user_id: entry.adminUserId,
    tenant_id: entry.tenantId,
    action: entry.action,
    before: entry.before,
    after: entry.after,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** A tenant's audit history, newest first. Empty array on any read error. */
export async function listAuditForTenant(
  supabase: SupabaseClient,
  tenantId: string,
  limit = 100,
): Promise<AdminAuditRow[]> {
  const { data, error } = await supabase
    .from('admin_audit_log')
    .select('id, admin_user_id, tenant_id, action, before, after, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return []
  return (data ?? []) as AdminAuditRow[]
}
