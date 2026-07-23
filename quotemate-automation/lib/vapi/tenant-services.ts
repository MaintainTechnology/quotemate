// fetchTenantVoiceServices — the supabase-js twin of the pg query in
// scripts/deploy-vapi-voice-prompt.mts.
//
// The account-settings routes (trades toggle / activate / reconcile) refresh
// the Vapi assistant when the portfolio changes; this gives them the tenant's
// ENABLED services + DB-authored MUST-ASK questions, filtered with the SAME
// resolveEnabledSharedAssembliesForDialog gate the SMS inbound route uses —
// so voice and SMS ask identical per-service questions.
//
// Best-effort by design: any query error returns [] and the prompt still
// ships with the code-only easy questions (a degraded prompt beats a failed
// settings save).

import {
  resolveEnabledSharedAssembliesForDialog,
  type SharedAssemblyScopeRow,
} from '../sms/service-scope'
import type { VoiceCustomService } from './voice-prompt'

// Chainable subset of SupabaseClient the queries need — keeps this testable
// without the supabase-js types and callable from any route's client.
type SupabaseLike = {
  from(table: string): any
}

type AssemblyRow = SharedAssemblyScopeRow & { always_inspection?: boolean | null }

const toService = (r: {
  name: string
  description?: string | null
  clarifying_questions?: unknown
  always_inspection?: boolean | null
}): VoiceCustomService => ({
  name: r.name,
  description: r.description ?? null,
  // jsonb column — keep only string entries (same defensive shape SMS uses).
  clarifying_questions: Array.isArray(r.clarifying_questions)
    ? r.clarifying_questions.filter((q): q is string => typeof q === 'string')
    : null,
  always_inspection: r.always_inspection ?? false,
})

export async function fetchTenantVoiceServices(
  supabase: SupabaseLike,
  tenantId: string,
  trades: readonly string[],
): Promise<VoiceCustomService[]> {
  try {
    const assemblies = await supabase
      .from('shared_assemblies')
      .select('id, name, description, default_enabled, category, clarifying_questions, always_inspection')
      .in('trade', [...trades])
    if (assemblies.error) {
      console.warn('[vapi/tenant-services] shared_assemblies query failed', assemblies.error.message)
      return []
    }

    const offerings = await supabase
      .from('tenant_service_offerings')
      .select('assembly_id, enabled')
      .eq('tenant_id', tenantId)
    if (offerings.error) {
      console.warn('[vapi/tenant-services] tenant_service_offerings query failed', offerings.error.message)
      return []
    }

    const enabled = resolveEnabledSharedAssembliesForDialog(
      (assemblies.data ?? []) as AssemblyRow[],
      offerings.data ?? [],
    ) as AssemblyRow[]

    // Tenant-owned custom assemblies (migration 023). `enabled is not false`
    // (null = enabled) — filtered in JS to keep the query simple. Trade-scoped
    // per the CLAUDE.md convention so a DROPPED trade's custom services are
    // never spoken (review finding 2026-07-23; the SMS route predates this
    // and does not filter — pre-existing, not widened here).
    const custom = await supabase
      .from('tenant_custom_assemblies')
      .select('name, description, clarifying_questions, always_inspection, enabled')
      .eq('tenant_id', tenantId)
      .in('trade', [...trades])
    const customRows = (custom.error ? [] : (custom.data ?? [])).filter(
      (r: { enabled?: boolean | null }) => r.enabled !== false,
    )

    return [...enabled.map(toService), ...customRows.map(toService)]
  } catch (e) {
    console.warn('[vapi/tenant-services] fetch threw (best-effort, returning [])', e)
    return []
  }
}
