// ════════════════════════════════════════════════════════════════════
// Server-side feature provenance writers + plan application.
//
// trades[] is the runtime gate; tenant_feature_sources (migration 138) records
// WHY each slug is on so the plan layer can strip only its own ('plan') grants.
// All writers are best-effort and non-fatal — a provenance write must never
// fail the user-facing action (admin toggle, onboarding, webhook) it rides on.
// Callers pass their own service-role SupabaseClient.
// ════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  computePlanFeatureUpdate,
  isPlanId,
  type FeatureSource,
  type PlanId,
  type ProvenanceMap,
} from './plan'

/** Upsert provenance rows for a set of feature slugs. Best-effort. */
export async function stampFeatureProvenance(
  supabase: SupabaseClient,
  opts: {
    tenantId: string
    features: string[]
    source: FeatureSource
    updatedBy?: string | null
  },
): Promise<void> {
  if (opts.features.length === 0) return
  const rows = opts.features.map((feature) => ({
    tenant_id: opts.tenantId,
    feature,
    source: opts.source,
    updated_by: opts.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  }))
  const { error } = await supabase
    .from('tenant_feature_sources')
    .upsert(rows, { onConflict: 'tenant_id,feature' })
  if (error) {
    console.warn('[features] stampFeatureProvenance failed (non-fatal)', error.message)
  }
}

/** Delete provenance rows (e.g. when a plan downgrade strips a slug). Best-effort. */
export async function clearFeatureProvenance(
  supabase: SupabaseClient,
  tenantId: string,
  features: string[],
): Promise<void> {
  if (features.length === 0) return
  const { error } = await supabase
    .from('tenant_feature_sources')
    .delete()
    .eq('tenant_id', tenantId)
    .in('feature', features)
  if (error) {
    console.warn('[features] clearFeatureProvenance failed (non-fatal)', error.message)
  }
}

/** Load a tenant's provenance map: slug → source. Empty on any read error. */
export async function loadProvenance(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ProvenanceMap> {
  const { data, error } = await supabase
    .from('tenant_feature_sources')
    .select('feature, source')
    .eq('tenant_id', tenantId)
  if (error) return {}
  const map: ProvenanceMap = {}
  for (const r of data ?? []) {
    const src = r.source as string
    if (src === 'manual' || src === 'plan' || src === 'onboarding') {
      map[r.feature as string] = src
    }
  }
  return map
}

/**
 * Apply the plan→features map for a tenant whose subscription_plan just
 * changed. Adds plan-granted slugs to trades[] (source='plan') and removes
 * plan-sourced slugs the new plan no longer grants. Manual/onboarding grants
 * and base trades always survive. Best-effort + idempotent.
 */
export async function applyPlanFeatures(
  supabase: SupabaseClient,
  tenantId: string,
  plan: string | null | undefined,
): Promise<{ ok: boolean; added: string[]; removed: string[]; reason?: string }> {
  if (!isPlanId(plan)) {
    return { ok: false, added: [], removed: [], reason: 'unknown_plan' }
  }
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id, trades')
    .eq('id', tenantId)
    .maybeSingle()
  if (error || !tenant) {
    return { ok: false, added: [], removed: [], reason: error?.message ?? 'tenant_not_found' }
  }

  const currentTrades: string[] = Array.isArray(tenant.trades) ? (tenant.trades as string[]) : []
  const provenance = await loadProvenance(supabase, tenantId)
  const { nextTrades, added, removed } = computePlanFeatureUpdate(
    currentTrades,
    provenance,
    plan as PlanId,
  )

  if (added.length === 0 && removed.length === 0) {
    return { ok: true, added, removed }
  }

  const { error: upErr } = await supabase
    .from('tenants')
    .update({ trades: nextTrades })
    .eq('id', tenantId)
  if (upErr) {
    return { ok: false, added: [], removed: [], reason: upErr.message }
  }

  if (added.length > 0) {
    await stampFeatureProvenance(supabase, { tenantId, features: added, source: 'plan' })
  }
  if (removed.length > 0) {
    await clearFeatureProvenance(supabase, tenantId, removed)
  }
  return { ok: true, added, removed }
}
