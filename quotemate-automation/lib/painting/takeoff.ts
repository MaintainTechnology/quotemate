// ════════════════════════════════════════════════════════════════════
// Painting — materials + labour take-off (pure maths, no I/O).
//
// Sibling of pricing.ts: from the SAME measured surfaces the tiers are
// priced from, derive per tier what the job physically consumes —
//   litres per product → whole AU retail packs (1/4/10/15 L) → $ ex-GST
//   labour hours (production rates × the pricing multipliers) → crew-days
//   margin = tier price − materials − labour   (TRADIE-ONLY display)
//
// It is display/ordering intelligence: calculatePaintingPrice NEVER reads
// anything here, so quoted customer numbers cannot move (enforced by the
// invariance test in takeoff.test.ts). AU units throughout — litres, not
// gallons; m² / lm; $ ex-GST.
//
// PURE + deterministic — no Date/randomness. Fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import { roundTo } from './area'
import {
  DEFAULT_PAINTING_HOURLY_RATE,
  DEFAULT_PAINTING_PRODUCTION_RATES,
  jobMultiplier,
} from './pricing'
import type {
  PaintMeasurement,
  PaintProduct,
  PaintScope,
  PaintSurfaceArea,
  PaintUserInputs,
  PaintingQuotePrice,
  PaintingRateCard,
  PaintingTakeoff,
  PaintingTakeoffCard,
  PaintingTakeoffProduct,
  PaintingTakeoffTier,
} from './types'

// ── Defaults ────────────────────────────────────────────────────────
// Coverage: Dulux-class spread rates per coat; trim is linear (a ~100mm
// profile band). Prices: AU trade $/L ex-GST, mid-range. Tenants override
// via pricing_book.overlays.painting_rate_card.takeoff.

export const DEFAULT_PAINTING_TAKEOFF_CARD: PaintingTakeoffCard = {
  coverage_per_litre: {
    wall_paint: 16, // m²/L per coat
    ceiling_paint: 16,
    exterior_paint: 14, // texture drinks more
    primer_sealer: 12,
    trim_enamel: 45, // lm/L per coat
  },
  price_per_litre: {
    wall_paint: 14,
    ceiling_paint: 12,
    trim_enamel: 20,
    exterior_paint: 16,
    primer_sealer: 12,
  },
  premium_price_uplift_pct: 0.25,
  sundries_pct: 0.08,
  crew_size: 2,
  hours_per_day: 7.6, // AU standard working day
}

/** AU retail pack sizes, largest first. */
export const PAINT_PACK_SIZES_L = [15, 10, 4, 1] as const

const SCOPE_PRODUCT: Record<PaintScope, PaintProduct> = {
  walls: 'wall_paint',
  ceilings: 'ceiling_paint',
  trim: 'trim_enamel',
  exterior: 'exterior_paint',
}

/** Products whose price carries the Best-tier premium (paint, not prep). */
const PREMIUM_PRODUCTS: ReadonlySet<PaintProduct> = new Set([
  'wall_paint',
  'ceiling_paint',
  'trim_enamel',
  'exterior_paint',
])

/** PURE — resolve the effective take-off card: tenant knobs over defaults,
 *  record-wise for the two per-product maps. */
export function resolveTakeoffCard(rateCard: PaintingRateCard): PaintingTakeoffCard {
  const t = rateCard.takeoff
  if (!t) return DEFAULT_PAINTING_TAKEOFF_CARD
  return {
    coverage_per_litre: { ...DEFAULT_PAINTING_TAKEOFF_CARD.coverage_per_litre, ...(t.coverage_per_litre ?? {}) },
    price_per_litre: { ...DEFAULT_PAINTING_TAKEOFF_CARD.price_per_litre, ...(t.price_per_litre ?? {}) },
    premium_price_uplift_pct: t.premium_price_uplift_pct ?? DEFAULT_PAINTING_TAKEOFF_CARD.premium_price_uplift_pct,
    sundries_pct: t.sundries_pct ?? DEFAULT_PAINTING_TAKEOFF_CARD.sundries_pct,
    crew_size: t.crew_size ?? DEFAULT_PAINTING_TAKEOFF_CARD.crew_size,
    hours_per_day: t.hours_per_day ?? DEFAULT_PAINTING_TAKEOFF_CARD.hours_per_day,
  }
}

/**
 * PURE — round litres UP into whole retail packs, greedy largest-first:
 * while more than 10 L remains take a 15 L; a 4–10 L remainder takes one
 * 10 L; a 1–4 L remainder one 4 L; anything left one (or more) 1 L.
 */
export function packsForLitres(litres: number): Array<{ size_l: number; count: number }> {
  if (!Number.isFinite(litres) || litres <= 0) return []
  const counts = new Map<number, number>()
  let r = litres
  // Closed-form 15 L count (a loop would be O(litres) — a pathological
  // tenant coverage value like 1e-7 must not block the event loop).
  const n15 = r > 10 ? Math.ceil((r - 10) / 15) : 0
  if (n15 > 0) {
    counts.set(15, n15)
    r -= 15 * n15
  }
  if (r > 4) {
    counts.set(10, (counts.get(10) ?? 0) + 1)
    r -= 10
  }
  if (r > 1) {
    counts.set(4, (counts.get(4) ?? 0) + 1)
    r -= 4
  }
  if (r > 0) {
    counts.set(1, (counts.get(1) ?? 0) + Math.ceil(r))
  }
  return PAINT_PACK_SIZES_L.filter((s) => counts.has(s)).map((s) => ({
    size_l: s,
    count: counts.get(s)!,
  }))
}

const packedLitres = (packs: Array<{ size_l: number; count: number }>): number =>
  packs.reduce((a, p) => a + p.size_l * p.count, 0)

// ── Derivation-note formatting (display-only strings, never parsed) ──

/** Number with trailing zeros stripped, max 2 dp ("1", "0.7", "47.5"). */
const fmtNum = (n: number): string => String(Math.round(n * 100) / 100)
/** $/L and $/hr — whole dollars bare, else 2 dp ("14", "17.50"). */
const fmtRate = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2))
/** Whole AU dollars with grouping ("14,879"). */
const aud = (n: number): string => Math.round(n).toLocaleString('en-AU')

/** The physical coat count each tier is built from: Good is the 1-coat
 *  refresh; Better and Best use the job's configured coats. */
function tierCoats(tier: 'good' | 'better' | 'best', inputs: PaintUserInputs): 1 | 2 | 3 {
  return tier === 'good' ? 1 : inputs.coats
}

type ProductQty = { product: PaintProduct; qty: number; low: number; high: number; coats: number }

/** PURE — quantities per product for one tier (paint per in-scope surface at
 *  the tier's coat count; primer one coat over the m² surfaces on 'bare'). */
function productQuantities(
  measurement: PaintMeasurement,
  inputs: PaintUserInputs,
  coats: number,
): ProductQty[] {
  const out: ProductQty[] = []
  for (const s of measurement.surfaces as PaintSurfaceArea[]) {
    out.push({
      product: SCOPE_PRODUCT[s.scope],
      qty: s.quantity,
      low: s.quantity_low,
      high: s.quantity_high,
      coats,
    })
  }
  // Primer: only a bare/new substrate gets a full priming coat over the m²
  // surfaces ('minor' patch-priming is covered by the sundries allowance).
  if (inputs.condition === 'bare') {
    const m2 = (measurement.surfaces as PaintSurfaceArea[]).filter((s) => s.unit === 'm2')
    if (m2.length > 0) {
      out.push({
        product: 'primer_sealer',
        qty: m2.reduce((a, s) => a + s.quantity, 0),
        low: m2.reduce((a, s) => a + s.quantity_low, 0),
        high: m2.reduce((a, s) => a + s.quantity_high, 0),
        coats: 1,
      })
    }
  }
  return out
}

/**
 * PURE — the full materials + labour take-off across the three tiers.
 * `price` supplies each tier's ex-GST figure for the margin strip; the
 * function never feeds anything back into pricing.
 */
export function computePaintingTakeoff(args: {
  measurement: PaintMeasurement
  inputs: PaintUserInputs
  price: PaintingQuotePrice
  rateCard: PaintingRateCard
}): PaintingTakeoff {
  const { measurement, price, rateCard } = args
  // 'poor' routes to inspection but the take-off still displays as an
  // indicative FLOOR — treat it as at-least-bare prep. (jobMultiplier maps
  // 'poor' to a 1.0 condition multiplier because it never reaches *pricing*;
  // unguarded, the worst substrate would show the cheapest labour and skip
  // the primer.)
  const inputs: PaintUserInputs =
    args.inputs.condition === 'poor' ? { ...args.inputs, condition: 'bare' } : args.inputs
  const card = resolveTakeoffCard(rateCard)
  const hourlyRate =
    (typeof rateCard.hourly_rate === 'number' && Number.isFinite(rateCard.hourly_rate)
      ? rateCard.hourly_rate
      : null) ?? DEFAULT_PAINTING_HOURLY_RATE
  const prodRates = rateCard.production_rate_per_unit ?? DEFAULT_PAINTING_PRODUCTION_RATES
  const doubleStorey =
    inputs.scopes.includes('exterior') && (measurement.storeys ?? 1) >= 2
      ? 1 + (rateCard.double_storey_loading_pct ?? 0)
      : 1.0

  const buildTier = (tier: 'good' | 'better' | 'best'): PaintingTakeoffTier => {
    const coats = tierCoats(tier, inputs)

    // ── Materials ──
    const products: PaintingTakeoffProduct[] = productQuantities(measurement, inputs, coats).map(
      (q) => {
        const coverage = card.coverage_per_litre[q.product] ?? 1
        const litres = roundTo((q.qty * q.coats) / coverage, 1)
        const packs = packsForLitres(litres)
        const isPremium = tier === 'best' && PREMIUM_PRODUCTS.has(q.product)
        const pricePerL =
          (card.price_per_litre[q.product] ?? 0) *
          (isPremium ? 1 + card.premium_price_uplift_pct : 1)
        const packed = packedLitres(packs)
        const isTrim = q.product === 'trim_enamel'
        const unit = isTrim ? 'lm' : 'm²'
        const premiumTag = isPremium
          ? ` (premium +${Math.round(card.premium_price_uplift_pct * 100)}%)`
          : ''
        const note =
          q.product === 'primer_sealer'
            ? `Bare substrate — 1 sealing coat: ${fmtNum(q.qty)} m² ÷ ${fmtNum(coverage)} m²/L = ${fmtNum(litres)} L → packed ${fmtNum(packed)} L × $${fmtRate(pricePerL)}/L`
            : `${fmtNum(q.qty)} ${unit} × ${q.coats} coat${q.coats === 1 ? '' : 's'} ÷ ${fmtNum(coverage)} ${unit}/L = ${fmtNum(litres)} L → packed ${fmtNum(packed)} L × $${fmtRate(pricePerL)}/L${premiumTag}`
        return {
          product: q.product,
          litres,
          litres_low: roundTo((q.low * q.coats) / coverage, 1),
          litres_high: roundTo((q.high * q.coats) / coverage, 1),
          packs,
          cost_ex_gst: roundTo(packed * pricePerL, 2),
          note,
        }
      },
    )
    const productSubtotal = products.reduce((a, p) => a + p.cost_ex_gst, 0)
    const sundries = roundTo(productSubtotal * card.sundries_pct, 2)
    const materials = roundTo(productSubtotal + sundries, 2)

    // ── Labour — reuse the pricing multipliers at the tier's coat count ──
    const mult = jobMultiplier({ ...inputs, coats }, rateCard)
    let hours = 0
    const segments: string[] = []
    for (const s of measurement.surfaces as PaintSurfaceArea[]) {
      const rate = prodRates[s.scope] ?? DEFAULT_PAINTING_PRODUCTION_RATES[s.scope]
      if (!rate || rate <= 0) continue
      hours += (s.quantity / rate) * mult * (s.scope === 'exterior' ? doubleStorey : 1)
      const u = s.unit === 'lm' ? 'lm' : 'm²'
      segments.push(`${s.scope} ${fmtNum(s.quantity)} ${u} ÷ ${fmtNum(rate)} ${u}/hr`)
    }
    const labourHours = roundTo(hours, 1)
    const labourCost = roundTo(labourHours * hourlyRate, 2)
    const days = Math.max(1, Math.ceil(labourHours / (card.crew_size * card.hours_per_day)))
    const dsTag =
      doubleStorey > 1 ? ` · exterior +${Math.round((doubleStorey - 1) * 100)}% access` : ''
    const labourNote =
      `${segments.join(' + ')} × ${fmtNum(mult)} (coats · prep · colour) = ${fmtNum(labourHours)} h ` +
      `@ $${fmtRate(hourlyRate)}/hr · ${card.crew_size} painters × ${fmtNum(card.hours_per_day)} h/day ` +
      `≈ ${days} day${days === 1 ? '' : 's'}${dsTag}`

    // ── Margin ──
    const tierPrice = price.tiers.find((t) => t.tier === tier)?.ex_gst ?? 0
    const margin = roundTo(tierPrice - materials - labourCost, 2)
    const tierWord = tier.charAt(0).toUpperCase() + tier.slice(1)

    return {
      tier,
      products,
      sundries_ex_gst: sundries,
      materials_ex_gst: materials,
      labour_hours: labourHours,
      labour_ex_gst: labourCost,
      crew_size: card.crew_size,
      days_on_site: days,
      margin_ex_gst: margin,
      margin_pct: tierPrice > 0 ? roundTo(margin / tierPrice, 4) : 0,
      sundries_note: `${fmtNum(card.sundries_pct * 100)}% of product cost — filler, caulk, tape, drop sheets`,
      labour_note: labourNote,
      margin_note: `${tierWord} $${aud(tierPrice)} ex GST − materials $${aud(materials)} − labour $${aud(labourCost)}`,
    }
  }

  return { tiers: [buildTier('good'), buildTier('better'), buildTier('best')] }
}
