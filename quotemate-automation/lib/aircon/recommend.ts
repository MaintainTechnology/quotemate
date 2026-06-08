// ════════════════════════════════════════════════════════════════════
// Air-conditioning — recommendation + indicative pricing.
//
// sizing → ducted + split options (both always shown), a best-fit flag,
// and a routing decision. Indicative posture: every result routes to a
// site assessment. PURE. Mirrors lib/painting/pricing.ts.
// ════════════════════════════════════════════════════════════════════

import { CONFIDENCE_BAND, roundTo, roundUpHalf, roundUpToUnit } from './sizing'
import type {
  AcOption,
  AcPriceRange,
  AcPropertyInputs,
  AcRateCard,
  AcRecommendation,
  AcRoutingDecision,
  AcSizing,
} from './types'

export const DEFAULT_AC_RATE_CARD: AcRateCard = {
  split: {
    per_head: { '2.5': 1100, '3.5': 1400, '5': 1900, '7': 2600, '8': 3000 },
    multi_head_discount_pct: 0.08,
  },
  ducted: { rate_per_kw: 1100, base_ex_gst: 4000, per_zone: 350, min_ex_gst: 8000 },
  gst_registered: true,
}

/** PURE — round a dollar figure to the nearest $100 (indicative). */
function roundMoney(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n / 100) * 100
}

/** PURE — ex-GST point → inc-GST low/high band. */
function priceRange(exGst: number, band: number, gstRegistered: boolean): AcPriceRange {
  const gst = gstRegistered ? 1.1 : 1.0
  return {
    low: roundMoney(exGst * (1 - band) * gst),
    high: roundMoney(exGst * (1 + band) * gst),
  }
}

function buildSplitOption(sizing: AcSizing, rateCard: AcRateCard, band: number): AcOption {
  let exGst = 0
  let capacity = 0
  for (const room of sizing.rooms) {
    const headKw = roundUpToUnit(room.kw)
    capacity += headKw
    exGst += rateCard.split.per_head[String(headKw)] ?? rateCard.split.per_head['8'] ?? 0
  }
  if (sizing.rooms.length >= 2) exGst *= 1 - rateCard.split.multi_head_discount_pct
  return {
    system_type: 'split',
    capacity_kw: roundTo(capacity, 1),
    price: priceRange(exGst, band, rateCard.gst_registered),
    best_fit: false,
    pros: ['Lower upfront cost', 'Independent per-room control', 'Can be installed in stages'],
    cons: ['A visible indoor head in each room', 'Less tidy than ducted for whole-home cooling'],
  }
}

function buildDuctedOption(sizing: AcSizing, rateCard: AcRateCard, band: number): AcOption {
  const capacity = roundUpHalf(sizing.ducted_kw)
  const zones = sizing.conditioned_zones
  // No conditioned rooms → no system, so no phantom min-price floor.
  const exGst =
    zones === 0 || sizing.connected_kw === 0
      ? 0
      : Math.max(
          rateCard.ducted.min_ex_gst,
          rateCard.ducted.base_ex_gst +
            rateCard.ducted.rate_per_kw * capacity +
            rateCard.ducted.per_zone * zones,
        )
  return {
    system_type: 'ducted',
    capacity_kw: capacity,
    price: priceRange(exGst, band, rateCard.gst_registered),
    best_fit: false,
    pros: ['Whole-home climate control', 'Hidden ductwork — tidy finish', 'One system for the house'],
    cons: ['Higher upfront cost', 'Needs roof/ceiling space for ducts', 'Best installed in one go'],
  }
}

function decideRouting(
  sizing: AcSizing,
  inputs: AcPropertyInputs,
  options: { ducted: AcOption; split: AcOption },
): AcRoutingDecision {
  if (inputs.ceiling_height === 'raked') {
    return {
      decision: 'book_assessment',
      reason:
        'Raked/cathedral ceilings change the load and duct routing — confirm on site before ordering.',
    }
  }
  if (sizing.confidence === 'low') {
    return {
      decision: 'book_assessment',
      reason:
        'Sizing is a rough estimate from limited inputs — a site assessment will confirm capacity and price.',
    }
  }
  if (sizing.connected_kw >= 14) {
    return {
      decision: 'book_assessment',
      reason:
        'The estimated load is large enough to likely need 3-phase power — confirm the supply on site.',
    }
  }
  const cheapest = Math.min(options.ducted.price.low, options.split.price.low)
  if (typeof inputs.budget === 'number' && inputs.budget > 0 && inputs.budget < cheapest) {
    return {
      decision: 'book_assessment',
      reason:
        'Your budget is below the indicative range for either system — a site visit can find the best option for your budget.',
    }
  }
  return {
    decision: 'book_assessment',
    reason:
      'Indicative sizing and pricing — every AC install needs a site assessment to confirm capacity, access and a firm quote.',
  }
}

export function recommendAircon(args: {
  sizing: AcSizing
  inputs: AcPropertyInputs
  rateCard?: AcRateCard
}): AcRecommendation {
  const rateCard = args.rateCard ?? DEFAULT_AC_RATE_CARD
  const { sizing, inputs } = args
  const band = CONFIDENCE_BAND[sizing.confidence]

  const ducted = buildDuctedOption(sizing, rateCard, band)
  const split = buildSplitOption(sizing, rateCard, band)

  const preferDucted =
    sizing.conditioned_zones >= 4 ||
    sizing.total_floor_area_m2 >= 150 ||
    (sizing.conditioned_zones >= 3 &&
      typeof inputs.budget === 'number' &&
      inputs.budget >= ducted.price.low)
  ducted.best_fit = preferDucted
  split.best_fit = !preferDucted

  const routing = decideRouting(sizing, inputs, { ducted, split })

  return { sizing, options: [ducted, split], routing, confidence: sizing.confidence }
}

/** PURE — shallow-merge a pricing_book overlay onto the default card. */
export function mergeAcRateCard(overlay: unknown): AcRateCard {
  const base = DEFAULT_AC_RATE_CARD
  if (!overlay || typeof overlay !== 'object') return base
  const o = overlay as Partial<AcRateCard>
  return {
    split: {
      per_head: { ...base.split.per_head, ...(o.split?.per_head ?? {}) },
      multi_head_discount_pct:
        typeof o.split?.multi_head_discount_pct === 'number'
          ? o.split.multi_head_discount_pct
          : base.split.multi_head_discount_pct,
    },
    ducted: { ...base.ducted, ...(o.ducted ?? {}) },
    gst_registered:
      typeof o.gst_registered === 'boolean' ? o.gst_registered : base.gst_registered,
  }
}
