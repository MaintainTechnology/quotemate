// Pure helper for seeding tenant_service_offerings — used by BOTH:
//   • /api/onboard/activate (one new tenant)
//   • scripts/backfill-tenant-service-offerings.mjs (existing tenants
//     activated before this helper existed, or whose seed didn't complete)
//
// Why one helper instead of duplicating the SQL: the seed semantics
// (which assemblies get an `enabled=true` row for this trade) must be
// IDENTICAL between the live activate path and the backfill, otherwise
// backfilled tenants drift from new-tenant baseline. Pre-v7 this logic
// was inline in route.ts:180-194; v7 Phase 1 lifts it out so the two
// callers can't diverge.
//
// Idempotent: the upsert keys on (tenant_id, assembly_id) so re-running
// the backfill is safe. Existing rows keep their stored `enabled` value
// (so a tradie's manual OFF toggle is NEVER re-enabled by a backfill).

import type { SupabaseClient } from '@supabase/supabase-js'

export interface SeedTenantDefaultsArgs {
  /** Supabase service-role client. */
  supabase: SupabaseClient
  /** Tenant whose offerings rows are being seeded. */
  tenantId: string
  /** Trades the tenant operates in (matches tenants.trades). One row per
   *  shared_assembly in any of these trades gets a seed entry. */
  trades: string[]
}

export interface SeedTenantDefaultsResult {
  /** Number of shared_assemblies that matched the tenant's trades. */
  candidates: number
  /** Number of rows actually upserted (= candidates, unless the read failed). */
  upserted: number
  /** Per-assembly enabled state that was seeded — useful for dry-run
   *  inspection and the backfill script's report. */
  rows: Array<{ assembly_id: string; enabled: boolean }>
}

export async function seedTenantServiceOfferings({
  supabase,
  tenantId,
  trades,
}: SeedTenantDefaultsArgs): Promise<SeedTenantDefaultsResult> {
  if (!tenantId) {
    throw new Error('seedTenantServiceOfferings: tenantId is required')
  }
  if (!Array.isArray(trades) || trades.length === 0) {
    return { candidates: 0, upserted: 0, rows: [] }
  }

  const { data: assemblies, error } = await supabase
    .from('shared_assemblies')
    .select('id, default_enabled')
    .in('trade', trades)

  if (error) {
    throw new Error(`shared_assemblies read failed: ${error.message}`)
  }
  if (!assemblies || assemblies.length === 0) {
    return { candidates: 0, upserted: 0, rows: [] }
  }

  // Core easy-5 assemblies (default_enabled = true in shared_assemblies)
  // land enabled so a newly-onboarded tradie sees their wedge live
  // immediately. Opt-in extras (default_enabled = false — aircon, EV
  // charger, leak detection, etc. from migration 021) land disabled;
  // the tradie ticks them on from the Services tab if they perform
  // that work. The `?? true` is the legacy guard for pre-021
  // shared_assemblies rows where default_enabled is null.
  const rows = assemblies.map((a) => ({
    tenant_id: tenantId,
    assembly_id: a.id as string,
    enabled: ((a as { default_enabled: boolean | null }).default_enabled ?? true) as boolean,
  }))

  const { error: upsertErr } = await supabase
    .from('tenant_service_offerings')
    .upsert(rows, { onConflict: 'tenant_id,assembly_id', ignoreDuplicates: true })

  if (upsertErr) {
    throw new Error(`tenant_service_offerings upsert failed: ${upsertErr.message}`)
  }

  return {
    candidates: assemblies.length,
    upserted: rows.length,
    rows: rows.map((r) => ({ assembly_id: r.assembly_id, enabled: r.enabled })),
  }
}
