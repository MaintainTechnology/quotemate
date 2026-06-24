// ════════════════════════════════════════════════════════════════════
// SMS roofing receptionist — pure reply composer.
//
// Turns a priced MultiRoofQuote into the customer-facing SMS/MMS body:
//   • quotable job → the three combined tier prices (inc-GST, taken
//     VERBATIM from the deterministic pricer — never re-derived here) +
//     a one-line scope + the quote-page link.
//   • inspection-routed job → the on-site-inspection next step + reason,
//     no dollar figure.
//
// SMS-length-aware: short labels, no cents, one line per tier.
//
// PURE — no I/O. Fully unit-tested.
// ════════════════════════════════════════════════════════════════════

import type { MultiRoofQuote, RoofingPriceTier, RoofStructurePrice } from '@/lib/roofing/types'
import { asQuoteTierMode, resolveVisibleTiers, type QuoteTierMode } from '@/lib/quote/tier-visibility'

export type RoofingReplyContext = {
  quote: MultiRoofQuote
  /** The property address, for the message opener. */
  address: string
  /** Public quote-page URL (shows the roof on the Google Maps location). */
  quoteUrl: string
  /** Customer first name, when known. */
  firstName?: string | null
  /** Migration 105 — stable download URL for the Gotenberg quote PDF.
   *  Rendered on the priced estimate message only (never the inspection
   *  or confirm messages — no committed numbers to put in a document). */
  pdfUrl?: string | null
  /** Migration 142 — per-feature tier presentation mode. Controls WHICH tiers
   *  the estimate SMS lists. Omitted ⇒ 'good_better_best' (legacy all-tiers);
   *  the inbound route passes the tenant's roofing pricing_book mode. */
  tierMode?: QuoteTierMode
}

/** One best-effort MMS roof photo: a public image URL + a short caption. */
export type RoofPhotoMedia = { mediaUrl: string; caption: string }

/**
 * PURE — the roof-photo MMS attachments to send BEFORE the confirm SMS.
 * One image for a single building; one per building (capped) for multiple,
 * each centred on that structure via the static-map `?b=` param. Captions
 * are the structure labels (price-free). The SMS confirm + page link is the
 * canonical message; these MMS are a best-effort bonus for numbers that
 * support MMS, so the caller never blocks on them.
 */
export function buildRoofPhotoMedia(opts: {
  baseUrl: string
  token: string
  quote: MultiRoofQuote
  /** Max images to send (avoid fanning out into many texts). Default 3. */
  max?: number
}): RoofPhotoMedia[] {
  const { baseUrl, token, quote } = opts
  const max = Math.max(1, opts.max ?? 3)
  const base = `${baseUrl}/api/roofing/q/${token}/static-map`
  const structures = Array.isArray(quote?.structures) ? quote.structures : []
  if (structures.length <= 1) {
    return [{ mediaUrl: base, caption: 'Your roof' }]
  }
  return structures.slice(0, max).map((s, i) => ({
    mediaUrl: `${base}?b=${i + 1}`,
    caption: s.label,
  }))
}

/** PURE — whole-dollar AUD, no cents (SMS brevity). */
export function fmtAud(n: number): string {
  const safe = Number.isFinite(n) ? n : 0
  return '$' + Math.round(safe).toLocaleString('en-AU')
}

function greeting(firstName?: string | null): string {
  const f = (firstName ?? '').trim().split(/\s+/)[0]
  return f ? `Hi ${f}, ` : 'Hi, '
}

/** ", <name>" suffix for sign-offs, or "" when unknown. */
function nameSuffix(firstName?: string | null): string {
  const f = (firstName ?? '').trim().split(/\s+/)[0]
  return f ? ` ${f}` : ''
}

const ROOF_TIER_LABEL_BY_KEY: Record<'good' | 'better' | 'best', string> = {
  good: 'Patch / repair',
  better: 'Re-roof',
  best: 'Upgrade',
}

/**
 * PURE — the quotable estimate message. Uses quote.combined.tiers
 * inc-GST exactly. Mentions structure count when >1 so the customer
 * knows the shed is included.
 */
export function composeEstimateMessage(ctx: RoofingReplyContext): string {
  const { quote } = ctx
  const flagged = quote.inspection_structures ?? []
  // The combined total + count reflect the QUOTABLE structures only.
  const quotableCount = Math.max(1, quote.structures.length - flagged.length)
  const area = Math.round(quote.combined.area_m2)
  const scope =
    quotableCount > 1
      ? `${quotableCount} structures, ~${area} m² total`
      : `~${area} m² of roof`

  // Mig 142 — list only the tiers this feature's mode surfaces. Roofing has no
  // per-SMS selected tier; the resolver's better → good → best fallback picks
  // the recommended one for 'single' mode (matches save-as-quote's default).
  const visibleTierKeys = resolveVisibleTiers({
    mode: asQuoteTierMode(ctx.tierMode, 'good_better_best'),
    present: {
      good: quote.combined.tiers.some((t) => t.tier === 'good'),
      better: quote.combined.tiers.some((t) => t.tier === 'better'),
      best: quote.combined.tiers.some((t) => t.tier === 'best'),
    },
    selectedTier: null,
  })
  const lines = quote.combined.tiers
    .filter((t) => visibleTierKeys.includes(t.tier))
    .map((t) => `• ${ROOF_TIER_LABEL_BY_KEY[t.tier]}: ${fmtAud(t.inc_gst)}`)

  const out = [
    `${greeting(ctx.firstName)}here's your roofing estimate for ${ctx.address} (${scope}):`,
    ...lines,
    `Full breakdown + your roof image: ${ctx.quoteUrl}`,
  ]
  if (ctx.pdfUrl) out.push(`PDF copy: ${ctx.pdfUrl}`)
  if (flagged.length > 0) {
    out.push(
      `Note: ${flagged.join(', ')} need${flagged.length === 1 ? 's' : ''} a quick look on site, so we'll sort ${flagged.length === 1 ? 'that' : 'those'} separately.`,
    )
  }
  out.push('Prices inc GST. A roofer reviews every quote before we book anything.')
  return out.join('\n')
}

/**
 * PURE — the inspection-route message. No price; states the reason and
 * the next step. Still links the quote page so the customer sees their
 * roof + location.
 */
export function composeInspectionMessage(ctx: RoofingReplyContext): string {
  return [
    `${greeting(ctx.firstName)}for your roof at ${ctx.address} we'll need a quick inspection on site before we can quote accurately.`,
    ctx.quote.routing.reason,
    `See the roof and location here: ${ctx.quoteUrl}`,
    `Reply YES and we'll book a time that suits you.`,
  ].join('\n')
}

/**
 * PURE — pick the right message for the quote's routing decision.
 * inspection_required → inspection message; otherwise the tiered estimate.
 */
export function buildRoofingReplyMessage(ctx: RoofingReplyContext): string {
  if (ctx.quote.routing.decision === 'inspection_required') {
    return composeInspectionMessage(ctx)
  }
  return composeEstimateMessage(ctx)
}

/**
 * PURE — the "is this your roof?" confirmation message, sent with the
 * satellite photo (MMS) BEFORE the price. Single building → a simple
 * yes/no; multiple buildings → a numbered list so the customer can pick
 * one, with "none" handled by a NO reply. Always links the page so they
 * can see the roof(s).
 */
export function composeConfirmMessage(ctx: RoofingReplyContext): string {
  const structures = ctx.quote.structures
  if (structures.length <= 1) {
    return [
      `${greeting(ctx.firstName)}is this your roof at ${ctx.address}?`,
      `I've sent you a photo to check. Reply YES and I'll send your quote, or NO if it's the wrong building.`,
      `See it here too: ${ctx.quoteUrl}`,
    ].join('\n')
  }
  const list = structures.map((s, i) => {
    const area = s.metrics?.sloped_area_m2 != null ? ` (~${Math.round(s.metrics.sloped_area_m2)} m²)` : ''
    return `${i + 1}) ${s.label}${area}`
  })
  return [
    `${greeting(ctx.firstName)}I found ${structures.length} buildings at ${ctx.address} (I've sent photos to check):`,
    ...list,
    `Reply YES to quote all of them, the number for just one, or NO if none are right.`,
    `See them here too: ${ctx.quoteUrl}`,
  ].join('\n')
}

/** PURE — polite close when the customer asks to stop / cancel. */
export function composeCancelMessage(firstName?: string | null): string {
  return `No problem${nameSuffix(firstName)}. I've stopped there. Just text me anytime if you'd like a roofing quote.`
}

/** PURE — reply after the inspection "shall we book?" prompt. */
export function composeBookingMessage(firstName: string | null | undefined, confirmed: boolean): string {
  return confirmed
    ? `Great${nameSuffix(firstName)}. A roofer will be in touch shortly to lock in a time for the inspection.`
    : `No worries${nameSuffix(firstName)}. Just text us whenever you're ready and we'll sort the inspection.`
}

/** Local 2-dp round — mirrors lib/roofing/pricing.ts roundTo. */
function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

/**
 * PURE — narrow a multi-structure quote down to a chosen SUBSET of
 * structures (1-based indices), re-aggregating EXACTLY as priceMultiRoof
 * does: combined tiers + area sum over the QUOTABLE structures only, and
 * the job routes to inspection only when the PRIMARY in the subset needs
 * it or nothing in the subset is quotable — otherwise we quote what we can
 * and flag the rest. null => the quote unchanged (all). Out-of-range /
 * empty selection => the original quote unchanged. Used at confirm time
 * ("just number 1") and for warm follow-ups ("2 and 3").
 */
export function narrowQuoteToStructures(
  quote: MultiRoofQuote,
  indices1Based: number[] | null,
): MultiRoofQuote {
  if (indices1Based == null) return quote
  const chosen = indices1Based
    .map((i) => quote.structures[i - 1])
    .filter((s): s is RoofStructurePrice => Boolean(s))
  if (chosen.length === 0) return quote

  const isInspection = (s: RoofStructurePrice) => s.price.routing.decision === 'inspection_required'
  const quotable = chosen.filter((s) => !isInspection(s))
  const inspection_structures = chosen.filter(isInspection).map((s) => s.label)

  // Combined per-tier totals over the QUOTABLE structures only.
  const tiers = ([0, 1, 2] as const).map((i): RoofingPriceTier => {
    const tierName = (['good', 'better', 'best'] as const)[i]
    const labelWord = tierName === 'good' ? 'Patch / repair' : tierName === 'better' ? 'Re-roof' : 'Upgrade'
    return {
      tier: tierName,
      label: `${labelWord}, all structures`,
      ex_gst: round2(quotable.reduce((a, s) => a + s.price.tiers[i].ex_gst, 0)),
      inc_gst: round2(quotable.reduce((a, s) => a + s.price.tiers[i].inc_gst, 0)),
      scope: `${labelWord} priced across ${quotable.length} structure${quotable.length === 1 ? '' : 's'}.`,
    }
  }) as [RoofingPriceTier, RoofingPriceTier, RoofingPriceTier]

  const area_m2 = round2(quotable.reduce((a, s) => a + s.price.area_m2, 0))

  // Job routing — primary-in-subset needs inspection, or nothing quotable.
  const primary = chosen.find((s) => s.role === 'primary') ?? chosen[0]
  let routing
  if (primary && isInspection(primary)) {
    routing = { decision: 'inspection_required' as const, reason: primary.price.routing.reason }
  } else if (quotable.length === 0) {
    routing = {
      decision: 'inspection_required' as const,
      reason: `${inspection_structures.join(', ')} require${inspection_structures.length === 1 ? 's' : ''} an on-site inspection before we can quote.`,
    }
  } else {
    routing = {
      decision: 'tradie_review' as const,
      reason: 'Quotable structures auto-calculated from measurement. Every roofing quote requires tradie sign-off before customer send.',
    }
  }

  return {
    structures: chosen,
    combined: { area_m2, tiers },
    routing,
    inspection_structures,
  }
}

/**
 * PURE — back-compat single-structure narrow (1-based). Thin wrapper over
 * narrowQuoteToStructures so there is one source of truth.
 */
export function narrowQuoteToStructure(quote: MultiRoofQuote, index1Based: number): MultiRoofQuote {
  return narrowQuoteToStructures(quote, [index1Based])
}
