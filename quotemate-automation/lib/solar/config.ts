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
  version: 'solar-config-2026-06-08',
  effective_date: '2026-06-08',
  deeming_schedule: DEEMING_SCHEDULE,
  zone_table: ZONE_TABLE,
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

export const __test_only__ = { DEEMING_SCHEDULE, ZONE_TABLE, DEFAULT_RATE_CARD }
