// Solar dashboard — Pylon pipeline stage read-back (supplements build
// 2026-06-13). For estimates whose confirm-time lead push recorded a
// Pylon opportunity id, resolve where that lead now sits in the
// tenant's Pylon pipeline ("Qualified", "Won", …) so the dashboard card
// closes the loop. Read-only, best-effort, capped — a Pylon outage just
// means no chip on the card.

import {
  fetchPylonOpportunity,
  fetchPylonStageName,
  pylonEnabled,
  type PylonClientOpts,
} from '../pylon/client'

/** Most dashboards have a handful of pushed leads; cap upstream calls. */
export const STAGE_LOOKUP_CAP = 8

export type PylonStageInfo = {
  /** Display label, e.g. "Qualified · Residential" or a lead status. */
  stage: string
  /** Deep link to the lead in Pylon's web app. */
  url: string | null
}

/**
 * Resolve pipeline stages for up to STAGE_LOOKUP_CAP opportunities.
 * Returns a map keyed by the caller's own key (estimate token). Stage /
 * status names are cached per call — a tenant's leads share stages.
 */
export async function resolvePylonStages(
  lookups: Array<{ key: string; opportunityId: string }>,
  env: { PYLON_ENABLED?: string; PYLON_API_KEY?: string } = {
    PYLON_ENABLED: process.env.PYLON_ENABLED,
    PYLON_API_KEY: process.env.PYLON_API_KEY,
  },
  opts: PylonClientOpts = {},
): Promise<Record<string, PylonStageInfo>> {
  if (!pylonEnabled(env) || lookups.length === 0) return {}
  const clientOpts: PylonClientOpts = { apiKey: env.PYLON_API_KEY, ...opts }

  const nameCache = new Map<string, string | null>()
  const resolveName = async (
    kind: 'pipeline_stage' | 'lead_status',
    id: string,
  ): Promise<string | null> => {
    const cacheKey = `${kind}:${id}`
    if (nameCache.has(cacheKey)) return nameCache.get(cacheKey) ?? null
    const res = await fetchPylonStageName(kind, id, clientOpts)
    const name = res.ok ? res.data : null
    nameCache.set(cacheKey, name)
    return name
  }

  const out: Record<string, PylonStageInfo> = {}
  // Sequential keeps the name cache effective and the call count low —
  // the cap bounds total latency.
  for (const { key, opportunityId } of lookups.slice(0, STAGE_LOOKUP_CAP)) {
    const opp = await fetchPylonOpportunity(opportunityId, clientOpts)
    if (!opp.ok) continue
    let label: string | null = null
    if (opp.data.pipeline_stage_id) {
      const stage = await resolveName('pipeline_stage', opp.data.pipeline_stage_id)
      if (stage) {
        label = opp.data.current_pipeline_name ? `${stage} · ${opp.data.current_pipeline_name}` : stage
      }
    }
    if (!label && opp.data.lead_status_id) {
      label = await resolveName('lead_status', opp.data.lead_status_id)
    }
    if (!label && opp.data.current_pipeline_name) label = opp.data.current_pipeline_name
    if (!label) continue
    out[key] = { stage: label, url: opp.data.in_app_url }
  }
  return out
}
