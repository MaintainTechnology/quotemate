// Monthly usage counters for billing entitlements. Quotes are counted off
// quotes.tenant_id; voice minutes are derived via intakes.tenant_id →
// calls.duration_seconds because `calls` rows aren't reliably tenant-stamped
// (CLAUDE.md: legacy calls have tenant_id NULL). Fails soft (zeros) on any
// query error so the gate errs toward allowing, never wrongly blocking.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Usage } from './entitlements'

/** UTC start of the current calendar month — the reset cadence for quote +
 *  voice allowances regardless of billing interval. */
export function monthStartIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

export async function getMonthlyUsage(
  sb: SupabaseClient,
  tenantId: string,
): Promise<Usage> {
  const since = monthStartIso()
  try {
    const [quotesRes, voiceIntakesRes] = await Promise.all([
      sb
        .from('quotes')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .gte('created_at', since),
      sb
        .from('intakes')
        .select('call_id')
        .eq('tenant_id', tenantId)
        .not('call_id', 'is', null)
        .gte('created_at', since),
    ])

    const quotesUsed = quotesRes.count ?? 0

    const callIds = (voiceIntakesRes.data ?? [])
      .map((r) => r.call_id as string | null)
      .filter((id): id is string => !!id)

    let seconds = 0
    if (callIds.length > 0) {
      const { data: callRows } = await sb
        .from('calls')
        .select('duration_seconds')
        .in('id', callIds)
      for (const c of callRows ?? []) {
        seconds += (c.duration_seconds as number | null) ?? 0
      }
    }

    return { quotesUsed, voiceMinutesUsed: Math.round(seconds / 60) }
  } catch {
    return { quotesUsed: 0, voiceMinutesUsed: 0 }
  }
}
