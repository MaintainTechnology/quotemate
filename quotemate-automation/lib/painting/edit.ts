// ════════════════════════════════════════════════════════════════════
// Painting — apply a tradie's manual quote edits to a PaintingEstimate.
//
// The painting price is deterministic (lib/painting/pricing.ts), but a
// painter reviewing the held quote at /p/[estimate_token] before sending it
// to the customer often wants the final say on the customer-visible numbers
// and wording — a round figure, a sharper scope line, a tweaked tier name.
// This is consistent with how the app already treats tradie-authored trades
// (see app/api/quote/[id]/edit: "tradie-authored trades (solar/roof/paint)
// have no catalogue, so the tradie owns the prices and the gate is skipped").
//
// We let the tradie override each tier's label, scope text, and inc-GST
// headline. ex-GST is recomputed from the estimate's own GST factor; the
// inc-GST band (low/high) scales proportionally to the new headline so the
// customer still sees a believable range rather than a stale one. The edit
// stamps price.manual_override so the UI can flag that the tiers are now
// tradie-set rather than the raw derivation.
//
// PURE — no I/O, no SDK. Fully unit-tested. The route (app/api/painting/
// edit/[token]) does the load + persist around this.
// ════════════════════════════════════════════════════════════════════

import type { PaintingEstimate, PaintingPriceTier } from './types'

export type PaintingTierEdit = {
  tier: 'good' | 'better' | 'best'
  /** New customer-visible tier name. Blank/whitespace is ignored. */
  label?: string
  /** New customer-visible scope sentence. */
  scope?: string
  /** New inc-GST headline the customer sees. ex-GST + band derive from it. */
  inc_gst?: number
}

export type ApplyTierEditsResult = {
  /** A NEW estimate with the edits applied (input is never mutated). */
  estimate: PaintingEstimate
  /** New better-tier inc-GST — the denormalised headline column. */
  betterIncGst: number | null
  /** Whether anything actually changed (a no-op edit returns false). */
  changed: boolean
  /** Whether a tier PRICE changed — the route re-mints Stripe deposit sessions
   *  only in this case (a label/scope-only edit leaves the amounts intact). */
  priceChanged: boolean
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * PURE — the GST multiplier (e.g. 1.1 when registered) used to derive ex-GST
 * from an inc-GST headline. Prefer the breakdown's recorded factor; otherwise
 * recover it from any tier with positive ex/inc; default 1.1.
 */
export function resolveGstFactor(estimate: PaintingEstimate): number {
  const bf = estimate.price?.breakdown?.gst_factor
  if (typeof bf === 'number' && bf > 0) return bf
  const t = estimate.price?.tiers?.find((x) => x.ex_gst > 0 && x.inc_gst > 0)
  if (t) return t.inc_gst / t.ex_gst
  return 1.1
}

function betterInc(tiers: readonly PaintingPriceTier[] | undefined): number | null {
  return numOrNull(tiers?.find((t) => t.tier === 'better')?.inc_gst)
}

/**
 * PURE — apply tradie tier overrides to a painting estimate. Returns a new
 * estimate, the new better-tier inc-GST, and whether anything changed.
 */
export function applyTierEdits(
  estimate: PaintingEstimate,
  edits: PaintingTierEdit[],
): ApplyTierEditsResult {
  // Cast off the static 3-tuple type: the tiers come from jsonb and may be
  // malformed at runtime, so the length/array guards are real, not dead.
  const tiers = estimate.price?.tiers as PaintingPriceTier[] | undefined
  if (!Array.isArray(tiers) || tiers.length === 0 || edits.length === 0) {
    return { estimate, betterIncGst: betterInc(tiers), changed: false, priceChanged: false }
  }

  const gstFactor = resolveGstFactor(estimate)
  const editByTier = new Map(edits.map((e) => [e.tier, e]))
  let changed = false
  let priceChanged = false

  const nextTiers = tiers.map((t) => {
    const e = editByTier.get(t.tier)
    if (!e) return t
    const next: PaintingPriceTier = { ...t }

    if (typeof e.label === 'string' && e.label.trim() && e.label.trim() !== t.label) {
      next.label = e.label.trim()
      changed = true
    }
    // Like the label, a scope edit only applies when it's non-empty — so a
    // blank/whitespace submission can't wipe the customer-visible scope line.
    if (typeof e.scope === 'string' && e.scope.trim() && e.scope.trim() !== t.scope) {
      next.scope = e.scope.trim()
      changed = true
    }
    // A price override must be strictly positive — $0 (a fat-finger or a
    // cleared field) is rejected, not persisted as a $0 customer headline.
    if (typeof e.inc_gst === 'number' && Number.isFinite(e.inc_gst) && e.inc_gst > 0) {
      const newInc = round2(e.inc_gst)
      if (newInc !== round2(t.inc_gst)) {
        const oldInc = t.inc_gst
        const ratio = oldInc > 0 ? newInc / oldInc : 1
        next.inc_gst = newInc
        next.ex_gst = round2(newInc / gstFactor)
        // Scale the band proportionally; if the old headline was non-positive
        // (degenerate tier) fall back to a small symmetric band so the customer
        // still sees a range rather than a zero-width point.
        next.inc_gst_low = oldInc > 0 ? round2(t.inc_gst_low * ratio) : round2(newInc * 0.92)
        next.inc_gst_high = oldInc > 0 ? round2(t.inc_gst_high * ratio) : round2(newInc * 1.08)
        changed = true
        priceChanged = true
      }
    }
    return next
  })

  if (!changed) {
    return { estimate, betterIncGst: betterInc(tiers), changed: false, priceChanged: false }
  }

  const nextEstimate: PaintingEstimate = {
    ...estimate,
    price: {
      ...estimate.price,
      tiers: nextTiers as [PaintingPriceTier, PaintingPriceTier, PaintingPriceTier],
      manual_override: true,
    },
  }
  return { estimate: nextEstimate, betterIncGst: betterInc(nextTiers), changed: true, priceChanged }
}
