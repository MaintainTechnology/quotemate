// Pure view models for the transparent Assumptions panel on
// /q/solar/[token]. Every row answers four questions a customer or
// installer asks of an assumption: what value did you use, where did it
// come from, what does it mean, and which way does it move my numbers?
// All values come from fields already persisted on the SolarEstimate —
// the money path is never recomputed here.
//
// PURE — no I/O, no React. Rendered server-side by the quote page.

import type { SolarEstimate, SolarPriceTier, SolarProductionResult } from './types'
import { BAND_SPREAD } from './types'
import { kw, kwh, pct, perKwh } from './quote-page-format'

export type SolarAssumptionRow = {
  key:
    | 'self_consumption'
    | 'retail_rate'
    | 'feed_in_tariff'
    | 'stc_rebate'
    | 'derate'
    | 'degradation'
    | 'confidence_band'
  label: string
  /** The value actually used, formatted. */
  value: string
  /** Where the number comes from (config version, network, CER zone…). */
  source: string
  /** One plain sentence: what this assumption means. */
  meaning: string
  /** Which way it moves savings/payback if reality differs. */
  sensitivity: string
}

export type SolarAssumptionsView = {
  rows: SolarAssumptionRow[]
  /** Closing line: dated-config provenance. */
  footnote: string
}

/** Headline (largest) price tier, aligned with the page's headline tier. */
function headlinePriceTier(estimate: SolarEstimate): SolarPriceTier | null {
  const tiers = estimate.price.tiers
  return tiers[tiers.length - 1] ?? null
}

function headlineProduction(estimate: SolarEstimate): SolarProductionResult | null {
  const prod = estimate.production
  return prod[prod.length - 1] ?? null
}

export function buildSolarAssumptionsView(estimate: SolarEstimate): SolarAssumptionsView {
  const a = estimate.economics.assumptions
  const priceTier = headlinePriceTier(estimate)
  const prod = headlineProduction(estimate)
  const configSrc = `Dated rate file ${estimate.config_version}`

  const rows: SolarAssumptionRow[] = []

  rows.push({
    key: 'self_consumption',
    label: 'Self-consumption',
    value: pct(a.self_consumption_pct),
    source: configSrc,
    meaning:
      'The share of your solar energy we assume you use at home as it is generated, rather than exporting it.',
    sensitivity:
      'Using more power during daylight (or adding a battery) raises this — bigger bill savings and a faster payback.',
  })

  rows.push({
    key: 'retail_rate',
    label: 'Retail electricity rate',
    value: perKwh(a.retail_rate_aud_per_kwh),
    source: configSrc,
    meaning: 'What you pay your retailer for each kWh you buy from the grid.',
    sensitivity:
      'If your actual rate is higher, every self-consumed kWh saves you more — payback gets faster.',
  })

  rows.push({
    key: 'feed_in_tariff',
    label: 'Feed-in tariff',
    value: perKwh(a.feed_in_tariff_aud_per_kwh),
    source: a.feed_in_network
      ? `${a.feed_in_network} network benchmark`
      : 'Default network benchmark',
    meaning: 'What you are paid for each kWh your system exports to the grid.',
    sensitivity:
      'Feed-in rates vary by retailer and have been falling — savings rely more on self-consumption than on exports.',
  })

  if (priceTier) {
    rows.push({
      key: 'stc_rebate',
      label: 'STC rebate',
      value: `${priceTier.stc.certificates} certificates × $${priceTier.stc.stc_price_aud} = $${Math.round(priceTier.stc.rebate_aud).toLocaleString('en-AU')}`,
      source: `CER zone rating ${priceTier.stc.zone_rating} for postcode ${estimate.context.postcode} · ${priceTier.stc.deeming_years} deeming years for a ${estimate.context.install_year} install`,
      meaning: `The federal small-scale certificate rebate, already subtracted from the ${kw(priceTier.system_kw_dc)} kW option's price (certificates = kW × zone rating × deeming years).`,
      sensitivity:
        'Deeming years shrink every calendar year until the scheme ends in 2030 — the same system attracts a smaller rebate the longer you wait.',
    })
  }

  if (prod) {
    rows.push({
      key: 'derate',
      label: 'DC → AC conversion',
      value: `× ${prod.derate_applied}`,
      source: configSrc,
      meaning:
        'Panels are rated in DC; your home runs on AC. This factor removes inverter and wiring losses from the production figure.',
      sensitivity:
        'A premium inverter or short cable runs can do slightly better; shading or long runs slightly worse.',
    })

    rows.push({
      key: 'degradation',
      label: 'Panel ageing',
      value: `${(prod.degradation_pct_per_year * 100).toFixed(1)}% per year`,
      source: configSrc,
      meaning: 'Solar panels slowly lose output as they age; year-1 production is the figure shown.',
      sensitivity: 'After 10 years a panel still produces roughly 95% of its day-one output at this rate.',
    })

    const spread = BAND_SPREAD[prod.band]
    rows.push({
      key: 'confidence_band',
      label: 'Confidence range',
      value: `±${Math.round(spread * 100)}%`,
      source:
        estimate.coverage_source === 'manual'
          ? 'Roof details you provided (no satellite measurement)'
          : estimate.roof.imagery_quality === 'HIGH'
            ? 'High-quality satellite imagery of your roof'
            : 'Medium-quality satellite imagery of your roof',
      meaning: `Production is shown as a range (${kwh(prod.annual_kwh_low)}–${kwh(prod.annual_kwh_high)} kWh) rather than a single promise.`,
      sensitivity:
        'An on-site inspection narrows this range — your installer confirms shading, wiring and the meter board before anything is final.',
    })
  }

  return {
    rows,
    footnote: `Every rate above comes from the dated configuration file ${estimate.config_version} — nothing is tuned per quote. Your installer reviews all of it before the estimate becomes a contract.`,
  }
}
