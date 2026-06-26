// ════════════════════════════════════════════════════════════════════
// Painting — run the estimate + persist a saved job, for the non-dashboard
// callers (the SMS receptionist and the public self-serve form). Both need
// the SAME thing the dashboard does: resolve the tenant's rate-card overlay,
// run estimatePainting, and insert a painting_measurements row with a public
// token — but WITHOUT an authenticated user (created_by is null for a lead).
//
// Factored here so the SMS route branch and the /paint-request form POST
// share one code path instead of drifting. I/O glue over already-tested pure
// units (estimatePainting, buildSavedPaintingRow, the rate-card overlay).
// ════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js'
import { estimatePainting } from './measure'
import { buildSavedPaintingRow } from './save-row'
import { effectivePaintingRateCardFromOverlay } from './rate-card-overlay'
import type { EstimateRequest } from './request-schema'
import type { PaintingEstimate, PaintingRateCard } from './types'
import { createPaintingCheckoutSessions } from '@/lib/stripe/painting-checkout'
import type { StripeLinks } from '@/lib/stripe/checkout'
import { ensurePaintingPdf, signQuotePdfUrl } from '@/lib/quote/pdf'
import { buildPaintingInspectionSms, buildPaintingQuoteSms } from '@/lib/sms/painting-compose'
import { asQuoteTierMode, type QuoteTierMode } from '@/lib/quote/tier-visibility'

export type PaintingQuoteDispatch =
  | {
      ok: true
      /** painting_measurements.public_token — the customer quote page. */
      token: string
      /** painting_measurements.estimate_token — the tradie review page (/p). */
      estimateToken: string
      estimate: PaintingEstimate
      inspection: boolean
      /** Per-tier Stripe deposit Checkout URLs (empty when none could be
       *  created — no Stripe key, an inspection quote, or a Stripe error). */
      stripeLinks: StripeLinks
    }
  | { ok: false; reason: string }

/** Best-effort — the per-tenant painting rate-card overlay, resolved exactly
 *  like app/api/painting/estimate (prefer the painting pricing_book row's
 *  card, then the primary-trade row's, then any row that carries one). */
async function loadPaintingRateCard(
  supabase: SupabaseClient,
  tenantId: string,
  primaryTrade: string | null,
): Promise<PaintingRateCard | undefined> {
  try {
    const { data } = await supabase
      .from('pricing_book')
      .select('trade, overlays')
      .eq('tenant_id', tenantId)
    if (!Array.isArray(data) || data.length === 0) return undefined
    const cardOf = (row: { overlays?: unknown } | undefined): unknown => {
      const overlays = (row?.overlays as Record<string, unknown> | null | undefined) ?? null
      return overlays?.painting_rate_card ?? null
    }
    const byTrade = (t: string) => data.find((r) => (r as { trade?: string }).trade === t)
    const overlayJson =
      cardOf(byTrade('painting')) ??
      (primaryTrade ? cardOf(byTrade(primaryTrade)) : null) ??
      cardOf(data.find((r) => cardOf(r) != null)) ??
      null
    return overlayJson != null ? effectivePaintingRateCardFromOverlay(overlayJson) : undefined
  } catch {
    return undefined
  }
}

/**
 * Run the painting estimate for a gathered request and persist it as a
 * painting_measurements row, returning the public token + estimate. Never
 * throws on operational failure — a provider miss or save error surfaces as
 * { ok: false, reason } so the caller can fall back to an inspection / retry
 * message. `inspection` is true when the estimate routed to an on-site measure.
 */
export async function runAndSavePaintingQuote(args: {
  supabase: SupabaseClient
  tenantId: string | null
  primaryTrade?: string | null
  customerPhone?: string | null
  customerName?: string | null
  request: EstimateRequest
  /** Base URL for the Stripe success/cancel pages. When omitted, no
   *  per-tier deposit sessions are created (the SMS still sends, link-free). */
  appUrl?: string
  depositPct?: number
}): Promise<PaintingQuoteDispatch> {
  const rateCard = args.tenantId
    ? await loadPaintingRateCard(args.supabase, args.tenantId, args.primaryTrade ?? null)
    : undefined

  const est = await estimatePainting(args.request.address, args.request.inputs, {
    source: args.request.source ?? 'auto',
    useMock: args.request.use_mock_provider ?? false,
    rateCard,
  })
  if (!est.ok) return { ok: false, reason: est.detail }

  const estimate = est.estimate
  const row = buildSavedPaintingRow({
    tenantId: args.tenantId,
    userId: null,
    data: {
      address: args.request.address,
      source: estimate.provider,
      inputs: args.request.inputs,
      estimate,
      customer_name: args.customerName ?? null,
      customer_phone: args.customerPhone ?? null,
    },
  })

  const { data, error } = await args.supabase
    .from('painting_measurements')
    .insert(row)
    .select('public_token, estimate_token')
    .single()
  if (error || !data) {
    return { ok: false, reason: error?.message ?? 'painting save failed' }
  }

  const saved = data as { public_token: string; estimate_token: string }
  const token = saved.public_token
  const estimateToken = saved.estimate_token
  const inspection = estimate.price.routing.decision === 'inspection_required'

  // Priced quotes only: mint per-tier Stripe deposit sessions and store them
  // so /r/paint/[token]/[tier] resolves. Best-effort — a missing Stripe key
  // or a Stripe error leaves stripe_links null and the SMS sends link-free.
  let stripeLinks: StripeLinks = {}
  if (!inspection && args.appUrl) {
    try {
      stripeLinks = await createPaintingCheckoutSessions({
        estimate,
        token,
        address: args.request.address.address,
        appUrl: args.appUrl,
        depositPct: args.depositPct,
      })
      if (Object.keys(stripeLinks).length > 0) {
        await args.supabase
          .from('painting_measurements')
          .update({ stripe_links: stripeLinks })
          .eq('public_token', token)
      }
    } catch (e) {
      console.warn('[painting] Stripe deposit sessions not created (non-fatal)', e instanceof Error ? e.message : e)
      stripeLinks = {}
    }
  }

  return { ok: true, token, estimateToken, estimate, inspection, stripeLinks }
}

/**
 * Best-effort — ensure the painting quote PDF exists and return a short-lived
 * signed URL suitable for an MMS attachment. Returns undefined on any miss
 * (no PDF, signing failed) so the caller just sends the plain SMS, whose body
 * already carries the PDF download link. Never throws.
 */
export async function resolvePaintingPdfMms(token: string): Promise<string | undefined> {
  try {
    const path = await ensurePaintingPdf(token)
    if (!path) return undefined
    return await signQuotePdfUrl(path, 60 * 60)
  } catch (e) {
    console.warn('[painting] PDF MMS sign failed (non-fatal)', e instanceof Error ? e.message : e)
    return undefined
  }
}

/**
 * Build the customer-facing painting quote delivery — the SMS body plus the
 * best-effort PDF MMS URL — for a successful dispatch. ONE place both the SMS
 * Q&A path (handlePaintingTurn) and the self-serve form POST call, so the two
 * never drift:
 *   • priced     → G/B/B + per-tier Stripe deposit links + quote-page link +
 *                  PDF link, with the PDF attached as an MMS.
 *   • inspection → the on-site-measure message (no price / Stripe / PDF).
 * The caller decides where to send (the tenant's number) and how to persist.
 */
export async function composePaintingQuoteDelivery(args: {
  supabase: SupabaseClient
  disp: Extract<PaintingQuoteDispatch, { ok: true }>
  address: string
  appUrl: string
  tenantId: string | null
  firstName?: string | null
}): Promise<{ text: string; mmsUrl?: string }> {
  const { supabase, disp, address, appUrl, tenantId, firstName } = args
  const quoteUrl = `${appUrl}/q/paint/${disp.token}`

  if (disp.inspection) {
    return {
      text: buildPaintingInspectionSms({
        firstName,
        address,
        reason: disp.estimate.price.routing.reason,
        quoteUrl,
      }),
    }
  }

  // Mig 142/146 — per-tenant painting tier presentation mode (which tiers,
  // and therefore which Stripe links, appear).
  let tierMode: QuoteTierMode = 'single'
  if (tenantId) {
    const { data: rb } = await supabase
      .from('pricing_book')
      .select('quote_tier_mode')
      .eq('tenant_id', tenantId)
      .eq('trade', 'painting')
      .maybeSingle()
    tierMode = asQuoteTierMode((rb as { quote_tier_mode?: string | null } | null)?.quote_tier_mode ?? null)
  }

  const pdfUrl = `${appUrl}/api/q/paint/${disp.token}/pdf`
  const mmsUrl = await resolvePaintingPdfMms(disp.token)
  const text = buildPaintingQuoteSms({
    estimate: disp.estimate,
    address,
    quoteUrl,
    pdfUrl,
    firstName,
    tierMode,
    token: disp.token,
    appUrl,
    stripeLinks: disp.stripeLinks,
  })
  return { text, mmsUrl }
}
