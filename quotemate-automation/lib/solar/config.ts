// ════════════════════════════════════════════════════════════════════
// Solar — dated config + freshness validation (spec §5, §7).
//
// NO MAGIC NUMBERS IN CODE: every STC / FiT / rate input lives in a dated
// SolarConfig the whole engine reads. DEFAULT_SOLAR_CONFIG is the shipped
// v1 default; tenants override the rate card via pricing_book.overlays and
// QuoteMate admin can later swap the whole config for a DB-backed one.
//
// validateSolarConfig is the freshness gate: it runs before any publish
// and blocks (with an admin-actionable code) when the config is missing,
// the deeming year for the install year is past/zero (SRES wind-down),
// the STC price is unset, or the table is structurally invalid.
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type {
  SolarConfig,
  SolarConfigValidation,
  StcDeemingSchedule,
  StcZoneTable,
  StcZoneRange,
  SolarRateCard,
} from './types'

// ── STC deeming schedule: install year → deeming years remaining ──────
// SRES phases out by end-2030; 2031+ deems to 0 (no rebate).
const DEEMING_SCHEDULE: StcDeemingSchedule = {
  2026: 5,
  2027: 4,
  2028: 3,
  2029: 2,
  2030: 1,
  2031: 0,
}

// ── CER postcode → STC zone rating. A representative v1 slice across the
// two live electrical/plumbing states; NSW metro (2xxx) ≈ zone 3 (1.382),
// QLD metro (4xxx) ≈ zone 3 (1.382), inland/north higher. Admin extends
// this table; sizing/pricing NEVER state-default a missing postcode. ────
const ZONE_TABLE: StcZoneTable = {
  '2000': 1.382, // Sydney CBD
  '2570': 1.382, // Camden NSW
  '2650': 1.536, // Wagga Wagga NSW (zone 2)
  '4000': 1.382, // Brisbane CBD
  '4350': 1.382, // Toowoomba QLD
  '4870': 1.622, // Cairns QLD (zone 1)
}

// ── Postcode-RANGE zone fallback (config 2026-06-12) ──────────────────
// The exact table above is a hand-curated slice; a missing postcode used
// to silently price with 0 STCs (the 670 London Road, Chandler 4154 bug —
// the customer was quoted with NO rebate). These contiguous CER zone-3/2/1
// blocks are still postcode-based (never state-default); exact
// table entries always win. Extend per CER's published mapping.
const ZONE_RANGES: StcZoneRange[] = [
  // NSW zone 3 (coastal metro + regional)
  { from: 2000, to: 2249, rating: 1.382 }, // Sydney metro — zone 3
  { from: 2250, to: 2554, rating: 1.382 }, // NSW coastal — zone 3
  { from: 2555, to: 2574, rating: 1.382 }, // Macarthur/Camden NSW — zone 3
  { from: 2575, to: 2744, rating: 1.382 }, // South coast NSW — zone 3
  // NSW zone 2 (inland)
  { from: 2745, to: 2786, rating: 1.536 }, // Penrith/Blue Mtns — zone 2
  { from: 2787, to: 2899, rating: 1.536 }, // Southern inland NSW — zone 2
  // NSW zone 1 (far south)
  { from: 2900, to: 2999, rating: 1.622 }, // Far south coast — zone 1
  // QLD zone 3 (coastal metro + regional)
  { from: 4000, to: 4399, rating: 1.382 }, // Brisbane metro + SEQ — zone 3
  { from: 4400, to: 4499, rating: 1.382 }, // QLD inland — zone 3
  { from: 4500, to: 4599, rating: 1.382 }, // Moreton Bay/Sunshine Coast — zone 3
  // QLD zone 2 (inland)
  { from: 4600, to: 4799, rating: 1.536 }, // QLD inland north — zone 2
  // QLD zone 1 (far north)
  { from: 4800, to: 4999, rating: 1.622 }, // Far north QLD — zone 1
]

/**
 * PURE — resolve the CER STC zone rating for a postcode: exact table hit
 * first, then the first matching range, else 0 (no rebate — and the
 * stc_zone_missing guardrail flags the estimate for review rather than
 * letting a rebate-free price publish silently).
 */
export function resolveStcZoneRating(
  postcode: string,
  config: Pick<SolarConfig, 'zone_table' | 'zone_ranges'>,
): number {
  const exact = config.zone_table[postcode]
  if (typeof exact === 'number' && exact > 0) return exact
  const n = Number.parseInt(postcode, 10)
  if (!Number.isFinite(n)) return 0
  for (const r of config.zone_ranges ?? []) {
    if (n >= r.from && n <= r.to && r.rating > 0) return r.rating
  }
  return 0
}

// ── Shipped default solar rate card ($/kW DC installed, ex-GST) ────────
const DEFAULT_RATE_CARD: SolarRateCard = {
  install_rate_per_kw: {
    standard_panels: 1100,
    premium_panels: 1450,
    unknown: 0,
  },
  multi_storey_loading_pct: 0.15,
  complex_roof_loading_pct: 0.10,
  gst_registered: true,
  call_out_minimum_ex_gst: 3500,
}

export const DEFAULT_SOLAR_CONFIG: SolarConfig = {
  version: 'solar-config-2026-06-12',
  effective_date: '2026-06-12',
  deeming_schedule: DEEMING_SCHEDULE,
  zone_table: ZONE_TABLE,
  zone_ranges: ZONE_RANGES,
  stc_price_aud: 38,
  feed_in: {
    by_network: {
      Ausgrid: 0.08,
      Endeavour: 0.075,
      Essential: 0.07,
      Energex: 0.05,
      Ergon: 0.0858,
    },
    default_aud_per_kwh: 0.06,
  },
  export_limits: {
    default_kw_per_phase: 5,
    by_network: {
      Energex: 5,
      Ausgrid: 5,
    },
  },
  default_rate_card: DEFAULT_RATE_CARD,
  derate_factor: 0.81,
  self_consumption_pct: 0.40,
  retail_rate_aud_per_kwh: 0.32,
  // Optional fields — config becomes single source of truth for constants
  // that were previously hardcoded in individual modules.
  default_panel_capacity_watts: 400,          // was CONFIG_PANEL_BASELINE_WATTS / MANUAL_PANEL_CAPACITY_WATTS
  manual_benchmark_kwh_per_kw: 1400,          // was MANUAL_BENCHMARK_KWH_PER_KW
  area_per_panel_m2: 1.95,                    // was AREA_PER_PANEL_M2
  degradation_pct_per_year: 0.005,            // was DEGRADATION_PCT_PER_YEAR
  complex_roof_min_segments: 6,               // was the literal 6 in pricing.ts applicableLoadings
  // Manual-path volumetric grounding. State DC yields are CEC AC benchmark
  // × 0.95 (conservatism margin) ÷ derate 0.81, so a manual estimate's
  // implied AC/kW sits at 0.95×CEC before the orientation factor and at
  // worst 0.76×CEC (south, 0.80) — always inside the ±35% CEC guardrail.
  manual_benchmark_by_state: {
    NSW: 1621,
    VIC: 1499,
    QLD: 1670,
    SA: 1747,
    WA: 1784,
    TAS: 1325,
    ACT: 1621,
    NT: 1901,
  },
  // Southern-hemisphere declared-orientation yield factors. Flat roofs are
  // tilt-framed by the installer, so they carry no penalty; unknown is a
  // conservative middle until the installer confirms on site.
  manual_orientation_yield_factors: {
    north: 1.0,
    north_east: 0.97,
    north_west: 0.97,
    east: 0.92,
    west: 0.92,
    south_east: 0.85,
    south_west: 0.85,
    south: 0.80,
    flat: 1.0,
    unknown: 0.90,
  },
  // ── Premium-quote constants (spec 2026-06-12 §4.3) — versioned here
  //    like every other constant; consumers guard absent values. ──────
  price_escalation_pct_per_year: 0.03, // AEMC long-run residential trend
  discount_rate_pct: 0.05,             // conservative household discount rate
  string_max_panels: 14,               // typical residential MPPT string cap
  typical_household_kwh_per_year: 6000, // AER benchmark, 3-person AU home
  co2_equiv_trees_per_tonne: 15,       // tree-years per tonne CO₂e (DCCEEW)
  co2_equiv_km_driven_per_tonne: 4000, // km in an average AU petrol car/tonne
}

export function validateSolarConfig(
  config: SolarConfig | null,
  installYear: number,
): SolarConfigValidation {
  if (!config) {
    return { ok: false, code: 'config_missing', detail: 'No solar config is loaded.' }
  }

  const deeming = config.deeming_schedule[installYear]
  if (deeming === undefined) {
    return {
      ok: false,
      code: 'deeming_year_past',
      detail: `No deeming-years entry for install year ${installYear}; the config is stale and must be refreshed.`,
    }
  }
  if (deeming <= 0) {
    return {
      ok: false,
      code: 'deeming_year_past',
      detail: `Deeming years for ${installYear} is ${deeming} — the SRES rebate has ended; refresh required.`,
    }
  }

  if (!Number.isFinite(config.stc_price_aud) || config.stc_price_aud <= 0) {
    return {
      ok: false,
      code: 'stc_price_unset',
      detail: 'STC price is unset or non-positive; an estimate cannot subtract the rebate.',
    }
  }

  if (
    !config.zone_table ||
    typeof config.zone_table !== 'object' ||
    Object.keys(config.zone_table).length === 0
  ) {
    return {
      ok: false,
      code: 'config_invalid',
      detail: 'Zone table is empty; STC certificates cannot be computed without a postcode→zone mapping.',
    }
  }

  if (
    !Number.isFinite(config.derate_factor) ||
    config.derate_factor <= 0 ||
    config.derate_factor >= 1
  ) {
    return {
      ok: false,
      code: 'config_invalid',
      detail: 'derate_factor must be a fraction in (0,1).',
    }
  }

  if (
    !Number.isFinite(config.self_consumption_pct) ||
    config.self_consumption_pct <= 0 ||
    config.self_consumption_pct >= 1
  ) {
    return {
      ok: false,
      code: 'config_invalid',
      detail: 'self_consumption_pct must be a fraction in (0,1).',
    }
  }

  // Guard: retail_rate_aud_per_kwh is the $/kWh multiplier for self-consumed
  // kWh in economics.ts. A non-positive value would silently produce $0 bill
  // savings and an uncalculable (null) payback even when solar is genuinely
  // valuable — the same category of silent failure as a zero derate.
  if (
    !Number.isFinite(config.retail_rate_aud_per_kwh) ||
    config.retail_rate_aud_per_kwh <= 0
  ) {
    return {
      ok: false,
      code: 'config_invalid',
      detail: 'retail_rate_aud_per_kwh must be a positive number; found ' +
        String(config.retail_rate_aud_per_kwh) + '.',
    }
  }

  // Guard: feed_in.default_aud_per_kwh is the fallback $/kWh used when the
  // network cannot be resolved from the postcode. A non-positive value would
  // silently produce $0 export earnings and inflate payback years for every
  // uncovered-network customer — same category as a zero retail rate.
  if (
    !Number.isFinite(config.feed_in.default_aud_per_kwh) ||
    config.feed_in.default_aud_per_kwh <= 0
  ) {
    return {
      ok: false,
      code: 'config_invalid',
      detail: 'feed_in.default_aud_per_kwh must be a positive number; found ' +
        String(config.feed_in.default_aud_per_kwh) + '.',
    }
  }

  // Guard: this value is used as a divisor in sizing.ts (DC ceiling = AC limit / derate).
  // Zero or negative makes the ceiling 0 and silently marks every tier export_limited=true.
  if (
    !Number.isFinite(config.export_limits.default_kw_per_phase) ||
    config.export_limits.default_kw_per_phase <= 0
  ) {
    return {
      ok: false,
      code: 'config_invalid',
      detail: 'export_limits.default_kw_per_phase must be a positive number.',
    }
  }

  // Guard every by_network export limit the same way.
  for (const [network, kw] of Object.entries(config.export_limits.by_network)) {
    if (!Number.isFinite(kw) || kw <= 0) {
      return {
        ok: false,
        code: 'config_invalid',
        detail: `export_limits.by_network.${network} must be a positive number; found ${kw}.`,
      }
    }
  }

  // Guard: every non-'unknown' panel-type install rate must be positive.
  // 'unknown' is intentionally 0 — it is a sentinel that means "panel type
  // undetermined at quote time"; pricing.ts must guard this path separately.
  const rateCard = config.default_rate_card.install_rate_per_kw
  for (const [panelType, rate] of Object.entries(rateCard)) {
    if (panelType !== 'unknown' && (!Number.isFinite(rate) || rate <= 0)) {
      return {
        ok: false,
        code: 'config_invalid',
        detail: `install_rate_per_kw.${panelType} must be a positive number; found ${rate}.`,
      }
    }
  }

  return { ok: true, config }
}

export const __test_only__ = { DEEMING_SCHEDULE, ZONE_TABLE, ZONE_RANGES, DEFAULT_RATE_CARD }

// ── DB-backed config loader ──────────────────────────────────────────────────
// The route calls loadSolarConfig(supabase) to retrieve the active config.
// v1: returns DEFAULT_SOLAR_CONFIG (a future migration will add a
// solar_config table; the loader switches transparently). The supabase
// client arg is accepted for forward-compatibility so the route signature
// does not need to change when the DB-backed path ships.
export async function loadSolarConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _supabase: any,
): Promise<SolarConfig> {
  return DEFAULT_SOLAR_CONFIG
}
