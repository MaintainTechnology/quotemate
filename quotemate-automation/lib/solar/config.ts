// ════════════════════════════════════════════════════════════════════
// Solar — dated config + freshness validation (spec §5, §7).
//
// NO MAGIC NUMBERS IN CODE: every STC / FiT / rate input lives in a dated
// SolarConfig the whole engine reads. DEFAULT_SOLAR_CONFIG is the shipped
// v1 default; tenants override the rate card via pricing_book.overlays and
// QuoteMax admin can later swap the whole config for a DB-backed one.
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

// ── CER postcode → STC zone rating (exact anchors). ──────────────────
// A small set of KNOWN-CORRECT cross-zone anchors; the comprehensive
// ZONE_RANGES below carry the bulk of the mapping. Exact entries win over
// ranges. Fixed CER ratings: zone 1 = 1.622, 2 = 1.536, 3 = 1.382, 4 = 1.185.
// sizing/pricing NEVER state-default a missing postcode (→ 0 → guardrail).
const ZONE_TABLE: StcZoneTable = {
  '2000': 1.382, // Sydney CBD — zone 3
  '2880': 1.536, // Broken Hill (far-west NSW) — zone 2
  '2548': 1.185, // Merimbula (far south coast NSW) — zone 4
  '4000': 1.382, // Brisbane CBD — zone 3
  '4825': 1.536, // Mount Isa (NW QLD inland) — zone 2
}

// ── Postcode-RANGE zone map (authoritative, verified 2026-06-15) ──────
// Source of truth: the Clean Energy Regulator "Postcode zone ratings and
// zones for solar (photovoltaic) systems" schedule (Renewable Energy
// (Electricity) (Zone Ratings and Zones for Solar (Photovoltaic) Systems)
// Instrument 2019, as of 1 Jan 2020). These NSW (2000-2999, incl. ACT) and
// QLD (4000-4999) ranges are transcribed from that schedule and were
// adversarially cross-checked against the CER PDF, the Solargain/energymatters
// mirrors, and independent STC calculators (every spot-check matched).
// Both bands are CONTIGUOUS and gap-free, so no in-state postcode silently
// resolves to 0 (the 670 London Road, Chandler 4154 bug). Exact ZONE_TABLE
// entries still win. Other states resolve to 0 → stc_zone_missing guardrail.
//
// Corrections vs prior config (both were over-crediting customers):
//   • Cairns 4870 / the whole QLD coast Brisbane→Cairns is ZONE 3 (1.382),
//     NOT zone 1 — zone 1 in QLD is only far-western outback pockets.
//   • Penrith 2750 & Wagga 2650 are ZONE 3 (1.382), not zone 2.
//   • Canberra/ACT 2900-2999 is ZONE 3 (1.382), not zone 1.
//   • Far-west NSW (Broken Hill 2878-2889) is genuinely ZONE 2 (1.536);
//     far-south-coast (2545-2554) & Snowy alpine (2628, 2630-2639) are ZONE 4.
const ZONE_RANGES: StcZoneRange[] = [
  // ── NSW + ACT (2000-2999) — CER Instrument 2019 ──
  { from: 2000, to: 2355, rating: 1.382 }, // Sydney, Central Coast, Hunter, Illawarra, lower North Coast — zone 3
  { from: 2356, to: 2357, rating: 1.536 }, // NW inland pocket (Bingara) — zone 2
  { from: 2358, to: 2384, rating: 1.382 }, // New England / NW slopes — zone 3
  { from: 2385, to: 2389, rating: 1.536 }, // NW inland pocket (Manilla) — zone 2
  { from: 2390, to: 2395, rating: 1.382 }, // NW slopes (Gunnedah) — zone 3
  { from: 2396, to: 2397, rating: 1.536 }, // NW inland pocket — zone 2
  { from: 2398, to: 2399, rating: 1.382 }, // NW slopes — zone 3
  { from: 2400, to: 2400, rating: 1.536 }, // Narrabri — zone 2
  { from: 2401, to: 2404, rating: 1.382 }, // NW slopes — zone 3
  { from: 2405, to: 2407, rating: 1.536 }, // Far NW inland (Wee Waa) — zone 2
  { from: 2408, to: 2544, rating: 1.382 }, // North/NW, Wollongong/Illawarra, Southern Highlands, South Coast — zone 3
  { from: 2545, to: 2554, rating: 1.185 }, // Far South Coast (Merimbula, Bega, Eden) — zone 4
  { from: 2555, to: 2627, rating: 1.382 }, // SW Sydney (Camden), Goulburn, Queanbeyan, ACT-central (2600-2619), Cooma fringe — zone 3
  { from: 2628, to: 2628, rating: 1.185 }, // Jindabyne alpine — zone 4
  { from: 2629, to: 2629, rating: 1.382 }, // Adaminaby — zone 3
  { from: 2630, to: 2639, rating: 1.185 }, // Cooma / Snowy-Monaro alpine — zone 4
  { from: 2640, to: 2816, rating: 1.382 }, // Albury, Wagga, Penrith, Bathurst, Central West — zone 3
  { from: 2817, to: 2817, rating: 1.536 }, // Central-west inland pocket — zone 2
  { from: 2818, to: 2820, rating: 1.382 }, // Central West (Gilgandra/Warren) — zone 3
  { from: 2821, to: 2829, rating: 1.536 }, // Warren-Nyngan-Coonamble belt — zone 2
  { from: 2830, to: 2830, rating: 1.382 }, // Narromine/Dubbo direction — zone 3
  { from: 2831, to: 2841, rating: 1.536 }, // Walgett-Brewarrina-Bourke direction — zone 2
  { from: 2842, to: 2872, rating: 1.382 }, // Wellington, Parkes, Forbes, Condobolin — zone 3
  { from: 2873, to: 2873, rating: 1.536 }, // Nymagee/Hermidale pocket — zone 2
  { from: 2874, to: 2877, rating: 1.382 }, // Lachlan (Tullamore/Trundle) — zone 3
  { from: 2878, to: 2889, rating: 1.536 }, // FAR WEST: Broken Hill, Wilcannia, Menindee — zone 2
  { from: 2890, to: 2999, rating: 1.382 }, // Upper NSW band incl. Canberra/Tuggeranong (2900-2920, ACT) — zone 3
  // ── QLD (4000-4999) — CER Instrument 2019 ──
  { from: 4000, to: 4416, rating: 1.382 }, // Brisbane, Gold Coast, Sunshine Coast, Toowoomba, SEQ + S inland — zone 3
  { from: 4417, to: 4417, rating: 1.536 }, // Wandoan island — zone 2
  { from: 4418, to: 4427, rating: 1.382 }, // Miles/Chinchilla — zone 3
  { from: 4428, to: 4473, rating: 1.536 }, // Western Darling Downs / Maranoa (Roma) — zone 2
  { from: 4474, to: 4476, rating: 1.622 }, // Far-western inland pocket — zone 1
  { from: 4477, to: 4478, rating: 1.536 }, // Charleville area — zone 2
  { from: 4479, to: 4485, rating: 1.622 }, // Far-western outback (Quilpie/Cunnamulla direction) — zone 1
  { from: 4486, to: 4491, rating: 1.536 }, // Western inland — zone 2
  { from: 4492, to: 4492, rating: 1.622 }, // Far-western outback island — zone 1
  { from: 4493, to: 4493, rating: 1.536 }, // Western inland — zone 2
  { from: 4494, to: 4494, rating: 1.382 }, // Zone-3 island within the western mix — zone 3
  { from: 4495, to: 4497, rating: 1.536 }, // Western inland — zone 2
  { from: 4498, to: 4719, rating: 1.382 }, // Wide Bay (Bundaberg, Hervey Bay), Gladstone, Rockhampton — zone 3
  { from: 4720, to: 4722, rating: 1.536 }, // Emerald/Capella — zone 2
  { from: 4723, to: 4723, rating: 1.382 }, // Zone-3 island — zone 3
  { from: 4724, to: 4734, rating: 1.536 }, // Barcaldine/Longreach approach — zone 2
  { from: 4735, to: 4736, rating: 1.622 }, // Longreach area — zone 1
  { from: 4737, to: 4822, rating: 1.382 }, // Mackay, Whitsundays, Townsville + coast/inland — zone 3
  { from: 4823, to: 4823, rating: 1.536 }, // Hughenden island — zone 2
  { from: 4824, to: 4824, rating: 1.382 }, // Julia Creek island — zone 3
  { from: 4825, to: 4827, rating: 1.536 }, // Mount Isa + NW inland — zone 2
  { from: 4828, to: 4828, rating: 1.382 }, // Zone-3 island — zone 3
  { from: 4829, to: 4829, rating: 1.622 }, // Camooweal far-NW island — zone 1
  { from: 4830, to: 4999, rating: 1.382 }, // Far North QLD incl. Cairns (4870) + Cape — zone 3 (NOT zone 1)
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
  // DC:AC oversize lever (opt-in). LEFT ABSENT by default so live quotes are
  // unchanged — sizing.ts falls back to `1 / derate ≈ 1.23`, the prior ceiling.
  // Set to ~1.33 (the CEC inverter-oversize allowance) to quote larger DC
  // arrays on export-limited supplies; see the money-path NOTE in sizing.ts
  // before enabling (AC is not clipped, so it overstates ~8% at 1.33).
  // dc_oversize_factor: 1.33,
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

  // Guard: dc_oversize_factor (optional) sizes the DC ceiling above the AC
  // export limit. Must be in [1, 2] — below 1 would under-size the array
  // beneath the inverter; above 2 is an implausible DC:AC ratio. Absent is
  // valid (sizing.ts falls back to 1/derate, the prior behaviour).
  if (
    config.dc_oversize_factor != null &&
    (!Number.isFinite(config.dc_oversize_factor) ||
      config.dc_oversize_factor < 1 ||
      config.dc_oversize_factor > 2)
  ) {
    return {
      ok: false,
      code: 'config_invalid',
      detail: 'dc_oversize_factor must be a number in [1, 2]; found ' +
        String(config.dc_oversize_factor) + '.',
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
