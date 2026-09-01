// Pure helpers used by app/api/roofing/save-as-quote — extracted so
// vitest can test them without dragging in Supabase / Next runtime.

import type { MultiRoofQuote, RoofingPriceTier } from './types'
import { applySolarToTiers, narrowQuoteToStructures } from '@/lib/sms/roofing-compose'

/** PURE — split "27 Smith Street, Penrith" → { street, suburb }. */
export function splitAddress(full: string): { street: string; suburb: string } {
  const idx = full.lastIndexOf(',')
  if (idx < 0) return { street: full.trim(), suburb: '' }
  return {
    street: full.slice(0, idx).trim(),
    suburb: full.slice(idx + 1).trim(),
  }
}

/** PURE — build the good/better/best jsonb tier objects the existing
 *  customer quote page (/q/[token]) expects. When a tier carries an
 *  itemised `line_items` breakdown (hip/valley edge works alongside the
 *  sqm labour line), render it verbatim; otherwise fall back to the
 *  single sqm line for back-compat with callers that don't decompose. */
export function buildTierObjects(price: {
  area_m2: number
  effective_rate_per_m2: number
  tiers: ReadonlyArray<{
    tier: 'good' | 'better' | 'best'
    label: string
    ex_gst: number
    inc_gst: number
    scope: string
    line_items?: ReadonlyArray<{
      unit: string
      quantity: number
      description: string
      unit_price_ex_gst: number
      total_ex_gst: number
      source: string
    }>
  }>
}) {
  const tierObj = (i: number) => {
    const t = price.tiers[i]
    // Itemised tiers (hip/valley edge works alongside the sqm line) render
    // verbatim — sum(line_items) === ex_gst by construction upstream.
    if (t.line_items && t.line_items.length > 0) {
      return {
        label: t.label,
        subtotal_ex_gst: t.ex_gst,
        total_inc_gst: t.inc_gst,
        line_items: t.line_items.map((li) => ({
          unit: li.unit,
          quantity: li.quantity,
          description: li.description,
          unit_price_ex_gst: li.unit_price_ex_gst,
          total_ex_gst: li.total_ex_gst,
          source: li.source,
        })),
      }
    }
    // Fallback single line — derive a PER-TIER unit price so
    // quantity × unit_price === total === subtotal, the identity the edit modal
    // and edit route recompute against. Using the shared full-reroof rate here
    // collapsed every tier's quantity × unit_price to the Better number.
    const area = Number(price.area_m2.toFixed(1))
    const qty = area > 0 ? area : 1
    const unit = Number((t.ex_gst / qty).toFixed(2))
    const total = Number((qty * unit).toFixed(2))
    // Keep inc-GST coherent with the (possibly cent-adjusted) ex total rather
    // than passing the pre-adjustment value through.
    const incFactor = t.ex_gst > 0 ? t.inc_gst / t.ex_gst : 1
    return {
      label: t.label,
      subtotal_ex_gst: total,
      total_inc_gst: Number((total * incFactor).toFixed(2)),
      line_items: [
        {
          unit: area > 0 ? 'sqm' : 'each',
          quantity: qty,
          description: t.scope,
          unit_price_ex_gst: unit,
          total_ex_gst: total,
          source: 'labour',
        },
      ],
    }
  }
  return { good: tierObj(0), better: tierObj(1), best: tierObj(2) }
}

/** The stored roofing_measurements fields the promotion flattening reads. */
type StoredMeasurementRow = {
  address: string | null
  postcode: string | null
  state: string | null
  quote: MultiRoofQuote | null
  included_indices: number[] | null
}

export type TrustedRoofPromotionSnapshot = {
  address: { address: string; postcode: string; state: string }
  inputs: MultiRoofQuote['structures'][number]['inputs']
  metrics: MultiRoofQuote['structures'][number]['metrics']
  price: MultiRoofQuote['structures'][number]['price']
}

/** PURE (spec tradie-onsite-quote-editing R6b) — flatten a stored
 *  roofing_measurements row into the exact body POST /api/roofing/save-as-quote
 *  accepts, so /m can promote a saved measurement to an editable quotes row
 *  after the fact. Mirrors the measure page's onSendAsQuote flattening:
 *  combined tiers + area over the included structures (1-based indices,
 *  defaulting to the primary structure), inputs/metrics from the primary,
 *  job routing from narrowQuoteToStructures (inspection when the primary
 *  in the selection needs it). Returns null when the row can't produce a
 *  valid request (no quote, no structures, unusable address). */
export function buildSaveAsQuoteRequest(
  row: StoredMeasurementRow,
): TrustedRoofPromotionSnapshot | null {
  const quote = row.quote
  if (!quote || !Array.isArray(quote.structures) || quote.structures.length === 0) return null
  const address = (row.address ?? '').trim()
  if (address.length < 3) return null

  // Selection: the stored 1-based include toggles; empty/null falls back to
  // the primary structure (same default the measure page starts from).
  const stored = (row.included_indices ?? []).filter(
    (i) => Number.isInteger(i) && i >= 1 && i <= quote.structures.length,
  )
  const primaryIdx1 =
    quote.structures.findIndex((s) => s.role === 'primary') + 1 || 1
  const indices = stored.length > 0 ? stored : [primaryIdx1]

  const narrowed = narrowQuoteToStructures(quote, indices)
  const included = indices
    .map((i) => quote.structures[i - 1])
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
  const primary = included.find((s) => s.role === 'primary') ?? included[0]

  return {
    address: {
      address,
      postcode: row.postcode ?? '',
      state: row.state ?? '',
    },
    inputs: {
      material: primary.inputs.material,
      pitch: primary.inputs.pitch,
      intent: primary.inputs.intent,
      building_year_built: primary.inputs.building_year_built ?? null,
    },
    metrics: {
      footprint_m2: primary.metrics.footprint_m2,
      sloped_area_m2: narrowed.combined.area_m2,
      storeys: primary.metrics.storeys,
      form: primary.metrics.form,
      hips: primary.metrics.hips,
      valleys: primary.metrics.valleys,
      ridge_lm: primary.metrics.ridge_lm ?? null,
      polygon_geojson: primary.metrics.polygon_geojson ?? null,
      capture_date: primary.metrics.capture_date ?? null,
    },
    price: {
      area_m2: narrowed.combined.area_m2,
      effective_rate_per_m2: primary.price.effective_rate_per_m2,
      tiers: applySolarToTiers(narrowed.combined.tiers, narrowed.solar) as [
        RoofingPriceTier,
        RoofingPriceTier,
        RoofingPriceTier,
      ],
      loadings_applied: primary.price.loadings_applied,
      routing: narrowed.routing,
    },
  }
}
