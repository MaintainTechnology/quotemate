// ════════════════════════════════════════════════════════════════════
// Solar — system sizing (spec §3).
//
// Pick 2–3 HONEST system-size tiers from the roof's real panel configs,
// capped by the roof's physical capacity (max_panels_count). When the
// customer does not request a size, the DNSP export limit keeps the auto-sized
// option conservative. When the customer requests a preferred size, that
// request becomes the design target and the export limit is flagged for
// installer/connection review instead of silently shrinking the system. The tiers are
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
  SolarPhase,
} from './types'

/** Target panel-count fractions of the roof max for the good/middle tier.
 *  The top tier is always the roof-or-export max. */
const GOOD_FRACTION = 0.55
const MIDDLE_FRACTION = 0.80
const MAX_REQUESTED_SYSTEM_KW = 40

export function sizeSolarSystem(args: {
  roof: SolarRoofFacts
  panelType: SolarPanelType
  config: SolarConfig
  context: SolarEstimateContext
}): SolarSizingResult {
  const { roof, panelType, config, context } = args

  // Phase multiplier on the export ceiling. A single-phase service is capped
  // at the per-phase DNSP limit; a three-phase service may export across all
  // three phases (≈3× the ceiling), enlarging the largest system the engine
  // can size automatically. 'single' and 'unknown' stay at ×1 (conservative).
  const phase: SolarPhase = context.phase ?? 'unknown'
  const phaseMultiplier = phase === 'three' ? 3 : 1

  // Guard: a non-finite or non-positive derate_factor means the DC ceiling
  // calculation (AC limit / derate) would produce infinity or a negative
  // result, silently marking every tier export_limited. Route to inspection
  // so the tradie knows the config needs attention.
  if (!Number.isFinite(config.derate_factor) || config.derate_factor <= 0) {
    const roof_capacity_kw_dc_guard = round2(
      (roof.max_panels_count * roof.panel_capacity_watts) / 1000,
    )
    const perPhaseLimitGuard =
      config.export_limits.by_network[context.network] ??
      config.export_limits.default_kw_per_phase
    const export_limit_kw_ac_guard = perPhaseLimitGuard * phaseMultiplier
    return {
      tiers: [],
      roof_capacity_kw_dc: roof_capacity_kw_dc_guard,
      export_limit_kw_ac: export_limit_kw_ac_guard,
      phase,
      requested_size_kw: requestedSizeKw(context),
      routing: {
        decision: 'inspection_required',
        reason:
          'Solar config has an invalid derate_factor; a site inspection is required until the config is corrected.',
      },
    }
  }

  const wattsPerPanel = roof.panel_capacity_watts
  const roof_capacity_kw_dc = round2((roof.max_panels_count * wattsPerPanel) / 1000)

  // Export ceiling: per-phase kW AC limit × phase count → the DC array we will
  // auto-size up to. The inverter is sized to the AC export limit; the DC array
  // may be oversized against it by config.dc_oversize_factor (the standard CEC
  // DC:AC allowance, ~1.33) — so a single-phase 5 kW service quotes ~6.6 kW DC
  // rather than the old `5 / derate ≈ 6.2 kW`. When the factor is absent we
  // fall back to `1 / derate` (the prior behaviour, so existing configs are
  // byte-identical). Everything downstream (exportCeilPanels, export_limited
  // flags, the large-roof fallback) uses this ceiling, which scales with phase.
  //
  // NOTE (money path): production.ts still models AC as DC × derate with no
  // hard clip at the inverter, so an export-limited top tier overstates AC by
  // ~(oversize × derate − 1) ≈ 8% at 1.33. That sits inside the ±20–30%
  // confidence band the quote already shows, and self-consumed kWh (40%) are
  // not export-bound. To be stricter, lower dc_oversize_factor toward 1.0.
  const perPhaseLimit =
    config.export_limits.by_network[context.network] ??
    config.export_limits.default_kw_per_phase
  const export_limit_kw_ac = perPhaseLimit * phaseMultiplier
  const oversizeFactor =
    Number.isFinite(config.dc_oversize_factor) &&
    (config.dc_oversize_factor as number) >= 1
      ? (config.dc_oversize_factor as number)
      : 1 / config.derate_factor
  const exportDcCeiling = round2(export_limit_kw_ac * oversizeFactor)

  const reqKw = requestedSizeKw(context)

  // No usable roof → inspection (the only sizing failure mode).
  if (roof.max_panels_count <= 0 || roof.panel_configs.length === 0) {
    return {
      tiers: [],
      roof_capacity_kw_dc,
      export_limit_kw_ac,
      phase,
      requested_size_kw: reqKw,
      routing: {
        decision: 'inspection_required',
        reason:
          'No usable roof area for panels was detected, so a site inspection is required before sizing a system.',
      },
    }
  }

  // Compute the export-ceiling panel count once (floor so we never exceed AC limit).
  const exportCeilPanels = Math.floor((exportDcCeiling * 1000) / wattsPerPanel)
  if (exportCeilPanels <= 0) {
    return {
      tiers: [],
      roof_capacity_kw_dc,
      export_limit_kw_ac,
      phase,
      requested_size_kw: reqKw,
      routing: {
        decision: 'inspection_required',
        reason:
          'The DNSP export limit leaves no safe system size to quote automatically; a site inspection is required to confirm the installation design.',
      },
    }
  }

  // Anchor for the tier targets. Default = the roof's physical max. When the
  // customer asked for a preferred size, convert it to a panel count and use
  // the SMALLER of {requested, configured max, roof max} as the anchor — so the
  // top tier targets the customer's preference, never beyond a sane public
  // quote size or the roof. The DNSP/phase export ceiling is NOT used to
  // shrink a stated preference; instead those tiers are marked
  // export_limited so the quote explains that phase/export approval must be
  // confirmed by the installer.
  const maxPanels = roof.max_panels_count
  const requestedTargetKw = reqKw !== null ? Math.min(reqKw, MAX_REQUESTED_SYSTEM_KW) : null
  const anchorPanels =
    requestedTargetKw !== null
      ? Math.min(Math.round((requestedTargetKw * 1000) / wattsPerPanel), maxPanels)
      : maxPanels

  // Candidate panel counts, ascending, deduped, each capped by the anchor.
  const targets = [
    Math.max(1, Math.round(anchorPanels * GOOD_FRACTION)),
    Math.max(1, Math.round(anchorPanels * MIDDLE_FRACTION)),
    anchorPanels,
  ]
  const uniqueCounts = Array.from(new Set(targets))
    .filter((n) => n >= 1 && n <= anchorPanels)
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
      phase,
      requested_size_kw: reqKw,
      routing: {
        decision: 'inspection_required',
        reason:
          'The roof is too small to produce distinct system-size tiers; a site inspection is required before sizing a system.',
      },
    }
  }

  // Apply the DNSP export-limit cap: pair each candidate count with whether the
  // export limit actually reduced it. Track the original (pre-cap) count so the
  // export_limited flag reflects the original intent, not the clamped value.
  type TierCandidate = { original: number; panels: number }
  const hasExplicitPreferredSize = reqKw !== null
  const candidates: TierCandidate[] = uniqueCounts.map((count) => {
    const exceedsLimit = (count * wattsPerPanel) / 1000 > exportDcCeiling
    return {
      original: count,
      panels: exceedsLimit && !hasExplicitPreferredSize ? exportCeilPanels : count,
    }
  })

  // Deduplicate by final panels count (ascending). When two candidate counts
  // map to the same clamped value, keep the entry with the larger original
  // count (the most export-limited one) so the flag is correctly set.
  const seenPanels = new Map<number, TierCandidate>()
  for (const c of candidates) {
    const existing = seenPanels.get(c.panels)
    if (!existing || c.original > existing.original) {
      seenPanels.set(c.panels, c)
    }
  }
  let dedupedCandidates = Array.from(seenPanels.values()).sort(
    (a, b) => a.panels - b.panels,
  )

  // On very large roofs (or a large preferred size), every anchor-fraction
  // target can exceed the DNSP cap and collapse to the same export-limited
  // panel count. That is still a quoteable residential system: regenerate
  // distinct tiers inside the capped maximum instead of returning an empty
  // estimate. The cap is the smaller of the anchor and the export ceiling.
  if (dedupedCandidates.length < 2 && anchorPanels > exportCeilPanels) {
    const cappedMaxPanels = Math.min(anchorPanels, exportCeilPanels)
    const fallbackCounts = Array.from(
      new Set([
        Math.max(1, Math.round(cappedMaxPanels * GOOD_FRACTION)),
        Math.max(1, Math.round(cappedMaxPanels * MIDDLE_FRACTION)),
        cappedMaxPanels,
      ]),
    )
      .filter((n) => n >= 1 && n <= cappedMaxPanels)
      .sort((a, b) => a - b)

    if (fallbackCounts.length >= 2) {
      dedupedCandidates = fallbackCounts.map((panels, i) => ({
        original: targets[Math.min(i, targets.length - 1)] ?? maxPanels,
        panels,
      }))
    }
  }

  // After capping, if fewer than 2 distinct sizes remain, route to inspection
  // (the same guarantee as the pre-cap uniqueCounts check).
  if (dedupedCandidates.length < 2) {
    return {
      tiers: [],
      roof_capacity_kw_dc,
      export_limit_kw_ac,
      phase,
      requested_size_kw: reqKw,
      routing: {
        decision: 'inspection_required',
        reason:
          'The DNSP export limit reduces all size tiers to the same system size; a site inspection is required to confirm the installation design.',
      },
    }
  }

  const tierNames = pickTierNames(dedupedCandidates.length)

  const tiers: SolarSystemTier[] = dedupedCandidates.map(({ original, panels: panels_count }, i) => {
    const export_limited = (original * wattsPerPanel) / 1000 > exportDcCeiling
    const system_kw_dc = round2((panels_count * wattsPerPanel) / 1000)
    const config_src = nearestConfig(roof.panel_configs, panels_count)
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

  return {
    tiers,
    roof_capacity_kw_dc,
    export_limit_kw_ac,
    phase,
    requested_size_kw: reqKw,
    routing,
  }
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
  if (configs.length === 0) {
    // Synthetic fallback so callers never receive undefined from reduce().
    // This path is unreachable in normal flow (the no-panel guard above fires
    // first) but protects against unexpected empty arrays from test fixtures.
    return { panels_count: targetCount, yearly_energy_dc_kwh: 0 }
  }
  return configs.reduce(
    (best, c) =>
      Math.abs(c.panels_count - targetCount) < Math.abs(best.panels_count - targetCount)
        ? c
        : best,
    configs[0],
  )
}

function tierLabel(tier: 'good' | 'better' | 'best', kw: number): string {
  if (tier === 'good') return `${kw.toFixed(1)} kW starter system`
  if (tier === 'better') return `${kw.toFixed(1)} kW recommended system`
  return `${kw.toFixed(1)} kW maximum-output system`
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

/** PURE — the customer's preferred size in kW DC, or null when none / invalid.
 *  Only a finite positive value anchors the tiers; anything else degrades to
 *  null (tiers anchor to the roof max). */
function requestedSizeKw(context: SolarEstimateContext): number | null {
  const v = context.requested_size_kw
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

export const __test_only__ = {
  GOOD_FRACTION,
  MIDDLE_FRACTION,
  pickTierNames,
  nearestConfig,
  requestedSizeKw,
  MAX_REQUESTED_SYSTEM_KW,
}
