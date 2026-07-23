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
import type { SolarAllowance } from '@/lib/roofing/solar'
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
  /** Migration 142/146 — per-feature tier presentation mode. Controls WHICH
   *  tiers the estimate SMS lists. Omitted ⇒ 'single' (the platform default,
   *  mig 146); the inbound route passes the tenant's roofing pricing_book mode. */
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
  good: 'Patch',
  better: 'Full roof replacement',
  best: 'Upgraded roof replacement',
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
    mode: asQuoteTierMode(ctx.tierMode, 'single'),
    present: {
      good: quote.combined.tiers.some((t) => t.tier === 'good'),
      better: quote.combined.tiers.some((t) => t.tier === 'better'),
      best: quote.combined.tiers.some((t) => t.tier === 'best'),
    },
    selectedTier: null,
  })
  const lines = applySolarToTiers(quote.combined.tiers, quote.solar)
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
  const out = [
    `${greeting(ctx.firstName)}for your roof at ${ctx.address} we'll need a quick inspection on site before we can quote accurately.`,
    ctx.quote.routing.reason,
  ]
  // Indicative range — when the roof has real (non-zero) per-structure numbers
  // we show them as a ballpark, clearly labelled "confirmed on site", so the
  // customer never gets a price-free quote. A genuinely unpriceable roof
  // (asbestos / unknown material → $0 tiers) yields no lines and the message
  // stays price-free, as before.
  // Solar detach & reinstate is applied to the priced replacement tiers —
  // the SAME one code path the confirmed indicative page view uses, so the
  // SMS ballpark can never read lower than the page it links to. The $0-tier
  // guard keeps a genuinely unpriceable tier at $0 (no fabricated price).
  const indic = indicativeCombinedTiers(ctx.quote.structures ?? [])
  const tierLines = applySolarToTiers(indic.tiers, ctx.quote.solar)
    .filter((t) => t.inc_gst > 0)
    .map((t) => `• ${ROOF_TIER_LABEL_BY_KEY[t.tier]}: ${fmtAud(t.inc_gst)}`)
  if (tierLines.length > 0) {
    out.push('Indicative estimate (confirmed on site):', ...tierLines)
  }
  out.push(
    `See the roof and location here: ${ctx.quoteUrl}`,
    `Reply YES and we'll book a time that suits you.`,
  )
  return out.join('\n')
}

/**
 * PURE — pick the right message for the quote. Lead with a FIRM price whenever
 * any structure is quotable (the estimate message already lists the firm
 * secondaries and flags any inspection-needed structure as "needs a look on
 * site"). Only a job with NOTHING quotable — a whole-job on-site quote — uses
 * the inspection message (which now carries an indicative range when the roof
 * has real numbers). This mirrors the customer quote page: firm secondaries
 * when present, an indicative range when the whole job is on-site.
 */
export function buildRoofingReplyMessage(ctx: RoofingReplyContext): string {
  if (isInspectionOnlyQuote(ctx.quote)) {
    return composeInspectionMessage(ctx)
  }
  return composeEstimateMessage(ctx)
}

/**
 * PURE — nothing in the quote is firm-priced, so buildRoofingReplyMessage
 * sends composeInspectionMessage ("Reply YES and we'll book a time").
 * The route keys the persisted step on the SAME predicate so the state
 * can never disagree with the message that went out: an inspection-only
 * send parks at await_booking (the YES books), a priced send stays
 * 'quoted' (warm structure follow-ups). Live 2026-07-23: they disagreed,
 * and the customer's YES fell through to the electrical LLM, which
 * improvised a fake "you're all booked in".
 */
export function isInspectionOnlyQuote(quote: MultiRoofQuote): boolean {
  return !(quote.structures ?? []).some((s) => s.price.routing.decision !== 'inspection_required')
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

/**
 * PURE — fallback when the automatic measurement is unavailable (Geoscape
 * transient / down) but the customer has given us a complete roofing brief.
 * Instead of dead-ending the thread, we offer the on-site inspection so the
 * lead is never lost. The route parks the conversation at await_booking, so
 * a "yes" books it through the existing booking flow — the same safe path a
 * measured inspection-routed job takes.
 */
export function composeMeasureUnavailableMessage(
  firstName: string | null | undefined,
  address: string,
): string {
  return [
    `Thanks${nameSuffix(firstName)}. I couldn't pull an automatic measurement for ${address} just now, so we'll arrange a quick on-site inspection to quote it accurately.`,
    `Reply YES and we'll book a time that suits you.`,
  ].join('\n')
}

/**
 * PURE — the honest inspection message for a brief we deliberately chose
 * NOT to measure: asbestos-suspect material, an unknown material or
 * pitch, an unclear job. These are routed to an on-site visit by
 * nextRoofingStep BEFORE the pitch question is even asked, which leaves
 * the slot set incomplete — so toRoofingRequest() returns null and no
 * measurement is ever attempted.
 *
 * Until 2026-07-22 that case fell through to
 * composeMeasureUnavailableMessage, telling the customer "I couldn't pull
 * an automatic measurement for <address>". That was simply untrue: we
 * never tried. It also threw away the real reason, so a customer whose
 * roof might contain asbestos got the same words as one hitting a
 * provider outage, and the tradie lost the one detail that mattered.
 *
 * `reason` comes from nextRoofingStep and is phrased to follow "Because".
 */
export function composeInspectionReasonMessage(
  firstName: string | null | undefined,
  address: string,
  reason: string,
): string {
  const because = (reason ?? '').trim()
  const lead = because
    ? `Because ${because}, we'll arrange a quick on-site inspection of ${address} to quote it accurately.`
    : `We'll arrange a quick on-site inspection of ${address} to quote it accurately.`
  return [`Thanks${nameSuffix(firstName)}. ${lead}`, `Reply YES and we'll book a time that suits you.`].join('\n')
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
    solar: quote.solar,
  }
}

/** PURE — add the solar detach & reinstate allowance to the Re-roof + Upgrade
 *  tiers only (never Patch — a patch job doesn't detach panels). When a tier
 *  carries line_items, append a matching `each` line so Σ line_items === ex_gst.
 *  A $0 tier stays $0 — the allowance is an add-on to a priced re-roof, so an
 *  unpriced/inspection tier can never become a fabricated solar-only price. */
export function applySolarToTiers(
  tiers: RoofingPriceTier[],
  solar: { allowance: SolarAllowance | null } | null | undefined,
): RoofingPriceTier[] {
  const a = solar?.allowance
  if (!a || !a.applies || a.inc_gst <= 0) return tiers
  return tiers.map((t) => {
    if (t.tier === 'good' || t.ex_gst <= 0) return t
    const ex_gst = round2(t.ex_gst + a.ex_gst)
    const inc_gst = round2(t.inc_gst + a.inc_gst)
    if (!t.line_items) return { ...t, ex_gst, inc_gst }
    return {
      ...t,
      ex_gst,
      inc_gst,
      line_items: [
        ...t.line_items,
        {
          unit: 'each' as const,
          quantity: a.arrays,
          description: 'Solar detach & reinstate',
          unit_price_ex_gst: round2(a.ex_gst / Math.max(1, a.arrays)),
          total_ex_gst: round2(a.ex_gst),
          source: 'labour' as const,
        },
      ],
    }
  })
}

/**
 * PURE — back-compat single-structure narrow (1-based). Thin wrapper over
 * narrowQuoteToStructures so there is one source of truth.
 */
export function narrowQuoteToStructure(quote: MultiRoofQuote, index1Based: number): MultiRoofQuote {
  return narrowQuoteToStructures(quote, [index1Based])
}

/**
 * PURE — indicative combined tiers over ALL given structures, INCLUDING
 * inspection-routed ones, summed verbatim from the stored per-structure tier
 * numbers. Mirrors narrowQuoteToStructures' summation but WITHOUT the quotable
 * filter.
 *
 * Used ONLY when a roofing job has no firm-priced (quotable) structure at all
 * (a whole-job on-site quote): instead of the quotable-only headline — which is
 * $0 there — the customer sees a real INDICATIVE range, clearly labelled
 * "subject to on-site confirmation", so an on-site-flagged roof never reads as
 * blank/$0. Never re-derives prices. A genuinely unpriceable roof (asbestos /
 * unknown material → $0 tiers from the pricer) sums to all-zero tiers, which
 * the caller treats as "no indicative numbers" and falls back to the
 * inspection-only state rather than showing a $0 quote.
 */
export function indicativeCombinedTiers(
  structures: readonly RoofStructurePrice[],
): { area_m2: number; tiers: [RoofingPriceTier, RoofingPriceTier, RoofingPriceTier] } {
  const tiers = ([0, 1, 2] as const).map((i): RoofingPriceTier => {
    const tierName = (['good', 'better', 'best'] as const)[i]
    const labelWord = tierName === 'good' ? 'Patch / repair' : tierName === 'better' ? 'Re-roof' : 'Upgrade'
    return {
      tier: tierName,
      label: `${labelWord}, indicative`,
      ex_gst: round2(structures.reduce((a, s) => a + (s.price.tiers[i]?.ex_gst ?? 0), 0)),
      inc_gst: round2(structures.reduce((a, s) => a + (s.price.tiers[i]?.inc_gst ?? 0), 0)),
      scope: `${labelWord} indicative estimate across ${structures.length} structure${structures.length === 1 ? '' : 's'}, confirmed on site.`,
    }
  }) as [RoofingPriceTier, RoofingPriceTier, RoofingPriceTier]
  const area_m2 = round2(structures.reduce((a, s) => a + (s.price.area_m2 ?? 0), 0))
  return { area_m2, tiers }
}
