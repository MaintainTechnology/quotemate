// Pure "why this number?" view models for the /q/solar/[token] hero
// stats (System size, Panels, Orientation, Yearly output). Each
// explainer answers the question a customer or installer asks when they
// see the headline figure, using ONLY values already persisted on the
// SolarEstimate — no recomputation of the money path, no invented
// numbers. Derived display figures (export DC ceiling, share-of-roof,
// area-per-panel, pre-derate DC energy) are arithmetic on persisted
// fields and are labelled as approximations where rounding applies.
//
// PURE — no I/O, no React. Rendered server-side by the quote page.

import type {
  SolarEstimate,
  SolarProductionResult,
  SolarRoofPlane,
  SolarSystemTier,
} from './types'
import { BAND_SPREAD } from './types'
import { kw, kwh, pct } from './quote-page-format'
import { orientationLabel } from './hero-overlay'

export type SolarExplainerFact = {
  label: string
  value: string
  note?: string
}

export type SolarStatExplainer = {
  key: 'system_size' | 'panels' | 'orientation' | 'yearly_output'
  /** Matches the hero overlay stat label. */
  statLabel: string
  /** Matches the hero overlay stat value. */
  statValue: string
  /** The question the panel opens with, e.g. "Why 6.0 kW?". */
  question: string
  /** One plain-English paragraph answering the question. */
  answer: string
  /** Labelled facts backing the answer (all from persisted fields). */
  facts: SolarExplainerFact[]
  /** Ordered derivation steps, measurement → displayed number. */
  steps: string[]
}

/** Whole-m² display, e.g. 87.4 → '87 m²'. */
function m2(n: number): string {
  if (!Number.isFinite(n)) return '0 m²'
  return `${Math.round(n)} m²`
}

/** Headline tier = last sizing tier (good→best ascending), as the page shows. */
function headlineTierOf(estimate: SolarEstimate): SolarSystemTier | null {
  const tiers = estimate.sizing.tiers
  return tiers[tiers.length - 1] ?? null
}

/** Headline production = last entry, aligned to the headline tier. */
function headlineProductionOf(estimate: SolarEstimate): SolarProductionResult | null {
  const prod = estimate.production
  return prod[prod.length - 1] ?? null
}

/** Top planes by area, largest first, for the orientation table. */
function topPlanes(planes: SolarRoofPlane[], limit: number): SolarRoofPlane[] {
  return [...planes].sort((a, b) => b.area_m2 - a.area_m2).slice(0, limit)
}

function roofMeasurementStep(estimate: SolarEstimate): string {
  const roof = estimate.roof
  if (roof.source === 'google') {
    const planes =
      roof.segment_count > 0
        ? ` across ${roof.segment_count} roof plane${roof.segment_count === 1 ? '' : 's'}`
        : ''
    return `Satellite analysis measured ${m2(roof.usable_area_m2)} of panel-ready roof${planes} at your address.`
  }
  return `You told us your roof size, giving roughly ${m2(roof.usable_area_m2)} of panel-ready area to work with.`
}

function buildSystemSizeExplainer(estimate: SolarEstimate): SolarStatExplainer {
  const roof = estimate.roof
  const sizing = estimate.sizing
  const tier = headlineTierOf(estimate)
  const prod = headlineProductionOf(estimate)

  const statValue = tier ? `${kw(tier.system_kw_dc)} kW` : 'To confirm'
  const question = tier ? `Why ${kw(tier.system_kw_dc)} kW?` : 'Why is the size still to confirm?'

  if (!tier) {
    return {
      key: 'system_size',
      statLabel: 'System size',
      statValue,
      question,
      answer:
        estimate.sizing.routing.reason ||
        'We could not size a system automatically from this roof, so an installer will confirm the right size on site.',
      facts: [
        { label: 'Roof capacity', value: `${kw(sizing.roof_capacity_kw_dc)} kW DC` },
        { label: 'Export limit', value: `${kw(sizing.export_limit_kw_ac)} kW AC`, note: estimate.context.network },
      ],
      steps: [roofMeasurementStep(estimate), 'An accredited installer will size the system during the site visit.'],
    }
  }

  const facts: SolarExplainerFact[] = [
    {
      label: 'Roof capacity',
      value: `${kw(sizing.roof_capacity_kw_dc)} kW DC`,
      note: `${roof.max_panels_count} × ${roof.panel_capacity_watts} W panels max`,
    },
    {
      label: 'Export limit',
      value: `${kw(sizing.export_limit_kw_ac)} kW AC`,
      note: `${estimate.context.network} network rule`,
    },
    {
      label: 'This system',
      value: `${kw(tier.system_kw_dc)} kW DC`,
      note: `${tier.panels_count} × ${roof.panel_capacity_watts} W panels`,
    },
    {
      label: 'Export / connection review',
      value: tier.export_limited ? 'Needed' : 'Not flagged',
      note: tier.export_limited
        ? 'Installer confirms phase, export limiting, battery or network approval'
        : 'Standard export allowance did not flag this size',
    },
  ]

  const steps: string[] = [roofMeasurementStep(estimate)]
  steps.push(
    `That area holds up to ${roof.max_panels_count} × ${roof.panel_capacity_watts} W panels — a physical ceiling of ${kw(sizing.roof_capacity_kw_dc)} kW DC.`,
  )
  if (prod && prod.derate_applied > 0) {
    steps.push(
      `Your electricity network (${estimate.context.network}) has a standard ${kw(sizing.export_limit_kw_ac)} kW AC export allowance — larger arrays can still be designed with export limiting, a battery, phase confirmation or network approval.`,
    )
  } else {
    steps.push(
      `Your electricity network (${estimate.context.network}) has a standard ${kw(sizing.export_limit_kw_ac)} kW AC export allowance, so larger arrays need installer confirmation.`,
    )
  }
  const share =
    roof.max_panels_count > 0 ? tier.panels_count / roof.max_panels_count : null
  steps.push(
    tier.export_limited
      ? `This option lands on ${kw(tier.system_kw_dc)} kW and is flagged for installer connection/export confirmation.`
      : `This option uses ${tier.panels_count} of those panels${share != null ? ` (${pct(share)} of the roof's maximum)` : ''} — ${kw(tier.system_kw_dc)} kW.`,
  )

  const answer = tier.export_limited
    ? `${kw(tier.system_kw_dc)} kW is the proposed DC array size. It is flagged for installer review because ${estimate.context.network}'s standard export allowance is ${kw(sizing.export_limit_kw_ac)} kW AC; the installer confirms phase, export limiting, battery or network approval before final design.`
    : `${kw(tier.system_kw_dc)} kW is what ${tier.panels_count} panels add up to on the usable part of your roof. The size comes from the measured roof, not from a one-size-fits-all package.`

  return {
    key: 'system_size',
    statLabel: 'System size',
    statValue,
    question,
    answer,
    facts,
    steps,
  }
}

function buildPanelsExplainer(estimate: SolarEstimate): SolarStatExplainer {
  const roof = estimate.roof
  const tier = headlineTierOf(estimate)

  const statValue = tier ? String(tier.panels_count) : 'To confirm'
  const question = tier ? `Why ${tier.panels_count} panels?` : 'Why is the panel count still to confirm?'

  const areaPerPanel =
    roof.max_panels_count > 0 ? roof.usable_area_m2 / roof.max_panels_count : null

  const facts: SolarExplainerFact[] = [
    {
      label: 'Usable roof area',
      value: m2(roof.usable_area_m2),
      note: roof.source === 'google' ? 'Measured from satellite imagery' : 'From the details you provided',
    },
    { label: 'Maximum panels that fit', value: String(roof.max_panels_count) },
    { label: 'Panel rating', value: `${roof.panel_capacity_watts} W each` },
  ]
  if (areaPerPanel != null && Number.isFinite(areaPerPanel)) {
    facts.push({
      label: 'Roof area per panel',
      value: `≈ ${areaPerPanel.toFixed(1)} m²`,
      note: 'Includes mounting gaps and edge setbacks',
    })
  }
  if (tier) {
    facts.push({ label: 'Panels in this option', value: String(tier.panels_count) })
  }

  const steps: string[] = [roofMeasurementStep(estimate)]
  steps.push(
    `After edge setbacks and obstructions, up to ${roof.max_panels_count} panels physically fit.`,
  )
  if (tier) {
    steps.push(
      tier.export_limited
        ? `${tier.panels_count} panels is the proposed layout; the installer confirms the export/connection design for this size.`
        : `This option places ${tier.panels_count} of them — the bigger options on this page step up toward the roof's maximum.`,
    )
  } else {
    steps.push('An installer will confirm the exact panel count on site.')
  }

  const answer = tier
    ? tier.export_limited
      ? `${tier.panels_count} panels is the proposed layout. Your roof could hold up to ${roof.max_panels_count}; the connection/export settings are confirmed before final design.`
      : `${tier.panels_count} panels is what this system size needs, out of a maximum of ${roof.max_panels_count} that physically fit on your measured roof.`
    : 'The roof could not be sized automatically, so an installer will confirm the panel count on site.'

  return {
    key: 'panels',
    statLabel: 'Panels',
    statValue,
    question,
    answer,
    facts,
    steps,
  }
}

function buildOrientationExplainer(estimate: SolarEstimate): SolarStatExplainer {
  const roof = estimate.roof
  const label = orientationLabel(roof.primary_orientation)

  const facts: SolarExplainerFact[] = []
  const planes = topPlanes(roof.planes, 6)
  for (const [i, p] of planes.entries()) {
    facts.push({
      label: `Roof plane ${i + 1}`,
      value: orientationLabel(p.orientation),
      note: `${m2(p.area_m2)} · ${Math.round(p.pitch_degrees)}° pitch${p.azimuth_degrees != null ? ` · ${Math.round(p.azimuth_degrees)}° azimuth` : ''}`,
    })
  }
  if (roof.mean_pitch_degrees != null) {
    facts.push({
      label: 'Average roof pitch',
      value: `${Math.round(roof.mean_pitch_degrees)}°`,
    })
  }

  const isManual = roof.source === 'manual'
  const northish =
    roof.primary_orientation === 'north' ||
    roof.primary_orientation === 'north_east' ||
    roof.primary_orientation === 'north_west'

  const sunNote = northish
    ? 'In Australia, north-facing panels collect the most sun over a day — this roof is well oriented.'
    : roof.primary_orientation === 'flat'
      ? 'Flat roofs use tilt frames, so the installer chooses the panel angle — orientation matters less here.'
      : roof.primary_orientation === 'unknown'
        ? 'The orientation could not be determined, so the installer will confirm it on site.'
        : `In Australia, north-facing panels collect the most sun; a ${label.toLowerCase()}-facing array produces less across the day, and the production figure on this page already accounts for that.`

  const answer = isManual
    ? `${label} is the main roof direction you told us. ${sunNote}`
    : `${label} is the direction of the largest panel-ready roof plane found in the satellite analysis. ${sunNote}`

  const steps: string[] = isManual
    ? [
        `You declared the main roof direction as ${label.toLowerCase()}.`,
        'The production estimate is adjusted for how much sun that direction receives.',
      ]
    : [
        `The satellite model split your roof into ${roof.segment_count} plane${roof.segment_count === 1 ? '' : 's'} and measured each one's compass direction and pitch.`,
        `The largest usable plane faces ${label.toLowerCase()}, so that drives the layout.`,
        'Sun exposure for each plane is built into the yearly output figure — no separate correction needed.',
      ]

  return {
    key: 'orientation',
    statLabel: 'Orientation',
    statValue: label,
    question: `Why ${label.toLowerCase()}?`,
    answer,
    facts,
    steps,
  }
}

function buildYearlyOutputExplainer(estimate: SolarEstimate): SolarStatExplainer {
  const prod = headlineProductionOf(estimate)
  const roof = estimate.roof

  if (!prod) {
    return {
      key: 'yearly_output',
      statLabel: 'Yearly output',
      statValue: 'To confirm',
      question: 'Why is the output still to confirm?',
      answer:
        'We could not estimate production automatically for this roof; an installer will model it during the site visit.',
      facts: [],
      steps: [roofMeasurementStep(estimate), 'Production will be modelled by the installer on site.'],
    }
  }

  const spread = BAND_SPREAD[prod.band]
  const dcApprox = prod.derate_applied > 0 ? prod.annual_kwh_ac / prod.derate_applied : 0

  const facts: SolarExplainerFact[] = [
    {
      label: 'Year-1 output',
      value: `${kwh(prod.annual_kwh_ac)} kWh`,
      note: 'Point estimate, AC (what your meter sees)',
    },
    {
      label: 'Likely range',
      value: `${kwh(prod.annual_kwh_low)}–${kwh(prod.annual_kwh_high)} kWh`,
      note: `±${Math.round(spread * 100)}% confidence band`,
    },
    {
      label: 'Inverter & wiring losses',
      value: `× ${prod.derate_applied}`,
      note: 'DC panel energy → AC household energy',
    },
    {
      label: 'Panel ageing',
      value: `${(prod.degradation_pct_per_year * 100).toFixed(1)}% per year`,
      note: 'Output declines slowly over the system’s life',
    },
    {
      label: 'Industry cross-check',
      value: prod.within_cec_benchmark ? 'Passed' : 'Flagged for review',
      note: `CEC benchmark for ${estimate.context.state}: ${kwh(prod.cec_benchmark_kwh_per_kw)} kWh per kW per year`,
    },
  ]

  const modelStep =
    roof.source === 'google'
      ? `Google’s sun-and-shade model for your actual roof estimates ≈ ${kwh(dcApprox)} kWh of raw DC energy a year for this layout.`
      : `A conservative yield benchmark for ${estimate.context.state}, adjusted for the ${orientationLabel(roof.primary_orientation).toLowerCase()} roof direction you declared, puts this layout at ≈ ${kwh(dcApprox)} kWh of raw DC energy a year.`

  const steps: string[] = [
    modelStep,
    `Multiplying by ${prod.derate_applied} for inverter and wiring losses gives ${kwh(prod.annual_kwh_ac)} kWh of usable AC energy a year.`,
    `That figure is cross-checked against the Clean Energy Council benchmark for ${estimate.context.state} (${kwh(prod.cec_benchmark_kwh_per_kw)} kWh/kW/yr) — ${prod.within_cec_benchmark ? 'it sits within the expected range' : 'it sits outside the expected range, so an installer reviews it before anything is final'}.`,
    `Because ${
      prod.band === 'tight'
        ? 'this estimate is built on high-quality satellite imagery'
        : roof.source === 'manual'
          ? 'this estimate is built on the details you provided rather than satellite measurement'
          : 'the available imagery for this roof is lower resolution'
    }, we show it as a ±${Math.round(spread * 100)}% range: ${kwh(prod.annual_kwh_low)}–${kwh(prod.annual_kwh_high)} kWh.`,
  ]

  const answer = `${kwh(prod.annual_kwh_ac)} kWh a year is the energy your meter would actually see: the roof’s modelled DC output with real-world inverter and wiring losses already removed, sanity-checked against the industry benchmark for ${estimate.context.state}.`

  return {
    key: 'yearly_output',
    statLabel: 'Yearly output',
    statValue: prod.annual_kwh_ac > 0 ? `${kwh(prod.annual_kwh_ac)} kWh` : 'To confirm',
    question: `Why ${kwh(prod.annual_kwh_ac)} kWh a year?`,
    answer,
    facts,
    steps,
  }
}

/**
 * Build the four hero-stat explainers in display order. Stat labels and
 * values match buildHeroOverlay so the expandable panel always agrees
 * with the number above it.
 */
export function buildSolarStatExplainers(estimate: SolarEstimate): SolarStatExplainer[] {
  return [
    buildSystemSizeExplainer(estimate),
    buildPanelsExplainer(estimate),
    buildOrientationExplainer(estimate),
    buildYearlyOutputExplainer(estimate),
  ]
}
