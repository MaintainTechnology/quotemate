// ════════════════════════════════════════════════════════════════════
// Solar — manual-roof fallback (spec §3, §7).
//
// When an address is uncovered (no Google imagery / 404 / LOW quality) we
// NEVER lose the lead. The customer declares 2–3 facts — dominant roof
// direction, a rough size bucket and storeys — and we synthesise the SAME
// SolarRoofFacts shape that roof.ts produces from Google, differing only
// in source='manual' and a wider confidence band downstream.
//
// The area→panels heuristic is deliberately conservative: ~1.95 m² of
// roof per panel (a 1.879 × 1.045 m panel + setbacks/obstruction discount
// baked into the size buckets).
//
// VOLUMETRIC GROUNDING: the DC yield is no longer one flat AU-wide
// number. The benchmark resolves state-first (config.manual_benchmark_by_
// state — Hobart ≠ Darwin), then flat manual_benchmark_kwh_per_kw, then
// the module default; the declared orientation applies a yield factor
// (config.manual_orientation_yield_factors — north 1.0 … south 0.80).
// And the synthetic panel_configs are a LINEAR LADDER (1..max panels),
// not a single max-roof config: sizing.ts picks the nearest config per
// tier, so a 55%-of-roof tier must find a 55%-sized config — a single
// max config would hand every tier the full roof's energy and blow the
// CEC ±35% cross-check on anything but the top tier.
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type {
  AuState,
  SolarManualRoofInput,
  SolarRoofFacts,
  SolarPanelConfig,
  SolarConfig,
} from './types'

type ManualFallbackConfig = Pick<
  SolarConfig,
  | 'default_panel_capacity_watts'
  | 'manual_benchmark_kwh_per_kw'
  | 'area_per_panel_m2'
  | 'manual_benchmark_by_state'
  | 'manual_orientation_yield_factors'
>

/** Declared size bucket → usable (panel-placeable) roof area, m².
 *  Already discounted for obstructions/setbacks — these are NET areas. */
export const MANUAL_AREA_M2: Record<SolarManualRoofInput['roof_size'], number> = {
  small: 45,
  medium: 90,
  large: 150,
}

/** Roof area consumed by one panel incl. setbacks, m². */
const AREA_PER_PANEL_M2 = 1.95
/** Per-panel DC rating assumed on the manual path, W. */
const MANUAL_PANEL_CAPACITY_WATTS = 400
/** Conservative DC specific yield, kWh per kW DC per year. */
const MANUAL_BENCHMARK_KWH_PER_KW = 1400
/** Orientation factor used when the config carries none (no adjustment). */
const DEFAULT_ORIENTATION_FACTOR = 1.0
/** Sanity ceiling on a configured orientation factor. */
const MAX_ORIENTATION_FACTOR = 1.2

export function buildManualRoofFacts(
  input: SolarManualRoofInput,
  config?: ManualFallbackConfig,
  state?: AuState,
): SolarRoofFacts {
  const usable_area_m2 = MANUAL_AREA_M2[input.roof_size]

  // Guard: a 0 or non-finite panel capacity would produce a zero-kW system
  // silently — fall back to the module default so the estimate is always valid.
  const panel_capacity_watts =
    config?.default_panel_capacity_watts != null &&
    config.default_panel_capacity_watts > 0
      ? config.default_panel_capacity_watts
      : MANUAL_PANEL_CAPACITY_WATTS

  // Benchmark resolution, most-specific first: per-state → flat config →
  // module default. Each step guards 0/NaN the same way so a corrupt entry
  // degrades to the next tier instead of zeroing the estimate.
  const stateBenchmark =
    state != null ? config?.manual_benchmark_by_state?.[state] : undefined
  const flatBenchmark = config?.manual_benchmark_kwh_per_kw
  const benchmark_kwh_per_kw =
    stateBenchmark != null && stateBenchmark > 0
      ? stateBenchmark
      : flatBenchmark != null && flatBenchmark > 0
        ? flatBenchmark
        : MANUAL_BENCHMARK_KWH_PER_KW

  // Declared-orientation yield factor (north 1.0 … south ~0.80). Invalid or
  // missing entries mean "no adjustment", never a zeroed estimate.
  const configuredFactor = config?.manual_orientation_yield_factors?.[input.orientation]
  const orientation_factor =
    configuredFactor != null &&
    Number.isFinite(configuredFactor) &&
    configuredFactor > 0 &&
    configuredFactor <= MAX_ORIENTATION_FACTOR
      ? configuredFactor
      : DEFAULT_ORIENTATION_FACTOR

  // Read area_per_panel_m2 from config so a panel-size model-year change is
  // config-driven; fall back to the module constant when absent or invalid.
  const area_per_panel_m2 =
    config?.area_per_panel_m2 != null && config.area_per_panel_m2 > 0
      ? config.area_per_panel_m2
      : AREA_PER_PANEL_M2

  const max_panels_count = Math.max(0, Math.floor(usable_area_m2 / area_per_panel_m2))

  // Linear config ladder 1..max: yearly DC energy is proportional to the
  // panel count, so whichever count sizing.ts clamps a tier to (export
  // limit, roof fraction), nearestConfig finds an honestly-sized config.
  const kwhPerPanel =
    (panel_capacity_watts / 1000) * benchmark_kwh_per_kw * orientation_factor
  const panel_configs: SolarPanelConfig[] = Array.from(
    { length: max_panels_count },
    (_, i) => ({
      panels_count: i + 1,
      yearly_energy_dc_kwh: round1((i + 1) * kwhPerPanel),
    }),
  )

  return {
    source: 'manual',
    usable_area_m2,
    planes: [],
    segment_count: 0,
    primary_orientation: input.orientation,
    mean_pitch_degrees: null,
    max_panels_count,
    panel_capacity_watts,
    panel_configs,
    storeys: input.storeys,
    polygon_geojson: null,
    imagery_quality: null,
    imagery_date: null,
    // Premium-quote fields: no per-panel geometry exists on the manual
    // path — layout/string overlays and the environmental section are
    // omitted downstream (degradation matrix §4.6).
    panels: [],
    panel_size_m: null,
    carbon_offset_factor_kg_per_mwh: null,
    whole_roof_area_m2: null,
    // Sun & shade fields: no Google data exists on the manual path.
    max_sunshine_hours_per_year: null,
    max_array_area_m2: null,
    panel_lifetime_years: null,
    whole_roof_sunshine_quantiles: null,
  }
}

function round1(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 10) / 10
}

export const __test_only__ = {
  AREA_PER_PANEL_M2,
  MANUAL_PANEL_CAPACITY_WATTS,
  MANUAL_BENCHMARK_KWH_PER_KW,
  DEFAULT_ORIENTATION_FACTOR,
  MAX_ORIENTATION_FACTOR,
}
