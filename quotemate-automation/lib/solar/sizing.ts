// ════════════════════════════════════════════════════════════════════
// Solar — system sizing (spec §3).
//
// Pick 2–3 HONEST system-size tiers from the roof's real panel configs,
// capped by BOTH the roof's physical capacity (max_panels_count) AND the
// DNSP export limit (default 5 kW/phase, derated DC→AC). The tiers are
// genuinely different sizes (good = smaller, best = roof-max), never a
// discount on one size. Every solar quote is tradie-reviewed — sizing
// only routes to inspection when the roof can't hold a single panel.
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type {
  SolarRoofFacts,
  SolarPanelType,
  SolarConfig,
  SolarEstimateContext,
  SolarSystemTier,
  SolarSizingResult,
  SolarPanelConfig,
  SolarRoutingDecision,
} from './types'

/** Target panel-count fractions of the roof max for the good/middle tier.
 *  The top tier is always the roof-or-export max. */
const GOOD_FRACTION = 0.55
const MIDDLE_FRACTION = 0.80

export function sizeSolarSystem(args: {
  roof: SolarRoofFacts
  panelType: SolarPanelType
  config: SolarConfig
  context: SolarEstimateContext
}): SolarSizingResult {
  const { roof, panelType, config, context } = args
  const wattsPerPanel = roof.panel_capacity_watts
  const roof_capacity_kw_dc = round2((roof.max_panels_count * wattsPerPanel) / 1000)

  // Export ceiling: kW AC limit per phase → an equivalent DC ceiling via
  // the derate (DC × derate = AC, so DC ceiling = AC limit / derate).
  const export_limit_kw_ac =
    config.export_limits.by_network[context.network] ??
    config.export_limits.default_kw_per_phase
  const exportDcCeiling = round2(export_limit_kw_ac / config.derate_factor)

  // No usable roof → inspection (the only sizing failure mode).
  if (roof.max_panels_count <= 0 || roof.panel_configs.length === 0) {
    return {
      tiers: [],
      roof_capacity_kw_dc,
      export_limit_kw_ac,
      routing: {
        decision: 'inspection_required',
        reason:
          'No usable roof area for panels was detected, so a site inspection is required before sizing a system.',
      },
    }
  }

  // Candidate panel counts, ascending, deduped, each capped by the roof.
  const maxPanels = roof.max_panels_count
  const targets = [
    Math.max(1, Math.round(maxPanels * GOOD_FRACTION)),
    Math.max(1, Math.round(maxPanels * MIDDLE_FRACTION)),
    maxPanels,
  ]
  const uniqueCounts = Array.from(new Set(targets))
    .filter((n) => n >= 1 && n <= maxPanels)
    .sort((a, b) => a - b)

  // A single unique count means the roof is too small to produce genuinely
  // different tiers (e.g. 1-panel roof: GOOD_FRACTION × 1 = 1 = MIDDLE = max).
  // This breaks the "always 2 or 3 tiers" guarantee in SolarSizingResult, so
  // treat it the same as the no-panel case: route to inspection.
  if (uniqueCounts.length < 2) {
    return {
      tiers: [],
      roof_capacity_kw_dc,
      export_limit_kw_ac,
      routing: {
        decision: 'inspection_required',
        reason:
          'The roof is too small to produce distinct system-size tiers; a site inspection is required before sizing a system.',
      },
    }
  }

  const tierNames = pickTierNames(uniqueCounts.length)

  const tiers: SolarSystemTier[] = uniqueCounts.map((count, i) => {
    const config_src = nearestConfig(roof.panel_configs, count)
    const panels_count = count
    const system_kw_dc = round2((panels_count * wattsPerPanel) / 1000)
    const export_limited = system_kw_dc > exportDcCeiling
    return {
      tier: tierNames[i],
      label: tierLabel(tierNames[i], system_kw_dc),
      system_kw_dc,
      panels_count,
      panel_type: panelType,
      source_config: config_src,
      export_limited,
    }
  })

  const routing: SolarRoutingDecision = {
    decision: 'tradie_review',
    reason:
      'System sized automatically from roof analysis. Every solar quote requires accredited-installer sign-off before customer send.',
  }

  return { tiers, roof_capacity_kw_dc, export_limit_kw_ac, routing }
}

/** PURE — name N tiers good→best (2 → [good,best]; 3 → [good,better,best]). */
function pickTierNames(n: number): Array<'good' | 'better' | 'best'> {
  if (n <= 1) return ['best']
  if (n === 2) return ['good', 'best']
  return ['good', 'better', 'best']
}

/** PURE — the precomputed config whose panel count is nearest the target. */
function nearestConfig(
  configs: SolarPanelConfig[],
  targetCount: number,
): SolarPanelConfig {
  return configs.reduce((best, c) =>
    Math.abs(c.panels_count - targetCount) < Math.abs(best.panels_count - targetCount)
      ? c
      : best,
  )
}

function tierLabel(tier: 'good' | 'better' | 'best', kw: number): string {
  if (tier === 'good') return `${kw.toFixed(1)} kW starter system`
  if (tier === 'better') return `${kw.toFixed(1)} kW full-size system`
  return `${kw.toFixed(1)} kW maximum-output system`
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

export const __test_only__ = { GOOD_FRACTION, MIDDLE_FRACTION, pickTierNames, nearestConfig }
