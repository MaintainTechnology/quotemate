// Quote PDF service (migration 105) — generate, store and link the
// Gotenberg-rendered customer quote PDFs for all three SMS quote flows:
//
//   electrical + plumbing  → quotes row (G/B/B jsonb) → quotes.pdf_path
//   roofing                → roofing_measurements row → .pdf_path
//
// Storage: private `quote-pdfs` bucket
//   quotes/<quoteId>.pdf   ·   roofs/<token>.pdf
//
// Customers download via the stable token routes (/api/q/[token]/pdf,
// /api/q/roof/[token]/pdf — lazy-generate on first hit); the MMS attach
// uses a short-lived signed URL. Everything here is best-effort from the
// callers' perspective: a PDF failure must never block the quote SMS.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { renderPdfFromHtml, gotenbergConfigured } from '@/lib/pdf/gotenberg'
import { buildQuoteReportHtml, type QuoteReportTier } from './report-html'
import { asQuoteTierMode, resolveVisibleTiers, type QuoteTierMode } from './tier-visibility'
import { buildRoofQuoteReportHtml } from '@/lib/roofing/report-html'
import type { MultiRoofQuote } from '@/lib/roofing/types'
import type { RoofDisplayRow } from '@/lib/roofing/selection'
import { buildSolarQuoteReportHtml } from '@/lib/solar/report-html'
import {
  buildSolarPremiumQuote,
  solarPremiumQuoteEnabled,
  type SolarPremiumQuote,
} from '@/lib/solar/premium-quote'
import { loadSolarConfig } from '@/lib/solar/config'
import type { SolarEstimate } from '@/lib/solar/types'
import { buildPaintingQuoteReportHtml } from '@/lib/painting/report-html'
import type { PaintingEstimate } from '@/lib/painting/types'
import { loadTenantBranding } from '@/lib/pdf/branding'
import { prepareImage } from '@/lib/pdf/image'

const BUCKET = 'quote-pdfs'
const APP_URL = (process.env.APP_URL ?? 'https://quote-mate-rho.vercel.app').replace(/\/$/, '')

let _client: SupabaseClient | null = null
function supabase(): SupabaseClient {
  if (_client) return _client
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  return _client
}

/** Stable customer download URL for a trade (G/B/B) quote PDF. */
export function quotePdfUrl(shareToken: string): string {
  return `${APP_URL}/api/q/${shareToken}/pdf`
}

/** Stable customer download URL for a roofing quote PDF. */
export function roofQuotePdfUrl(publicToken: string): string {
  return `${APP_URL}/api/q/roof/${publicToken}/pdf`
}

/** Stable customer download URL for a solar quote PDF. */
export function solarQuotePdfUrl(publicToken: string): string {
  return `${APP_URL}/api/q/solar/${publicToken}/pdf`
}

/** Stable customer download URL for a residential painting quote PDF. */
export function paintQuotePdfUrl(publicToken: string): string {
  return `${APP_URL}/api/q/paint/${publicToken}/pdf`
}


async function storePdf(path: string, data: Buffer): Promise<string> {
  const { error } = await supabase()
    .storage.from(BUCKET)
    .upload(path, data, { contentType: 'application/pdf', upsert: true })
  if (error) throw new Error(`quote-pdf upload failed: ${error.message}`)
  return path
}

/**
 * Store an arbitrary asset (e.g. a raw uploaded invoice image) in the same
 * private `quote-pdfs` bucket. Used by the per-tenant file-store archive
 * (spec 2026-06-19, R10) so the FULL invoice document lives in access-controlled
 * Supabase Storage — the KB only ever receives the PII-minimized text.
 */
export async function storeQuoteAsset(
  path: string,
  data: Buffer,
  contentType: string,
): Promise<string> {
  const { error } = await supabase()
    .storage.from(BUCKET)
    .upload(path, data, { contentType, upsert: true })
  if (error) throw new Error(`quote-asset upload failed: ${error.message}`)
  return path
}

export async function downloadQuotePdf(path: string): Promise<Buffer> {
  const { data, error } = await supabase().storage.from(BUCKET).download(path)
  if (error || !data) throw new Error(`quote-pdf download failed: ${error?.message ?? 'no data'}`)
  return Buffer.from(await data.arrayBuffer())
}

/** Short-lived public URL (for the Twilio MMS media fetch). */
export async function signQuotePdfUrl(path: string, ttlSeconds = 60 * 60): Promise<string> {
  const { data, error } = await supabase().storage.from(BUCKET).createSignedUrl(path, ttlSeconds)
  if (error || !data?.signedUrl) throw new Error(`quote-pdf sign failed: ${error?.message ?? 'no url'}`)
  return data.signedUrl
}

type QuotePdfRow = {
  id: string
  tenant_id: string | null
  intake_id: string | null
  share_token: string
  good: QuoteReportTier
  better: QuoteReportTier
  best: QuoteReportTier
  selected_tier: 'good' | 'better' | 'best' | null
  scope_of_works: string | null
  assumptions: string[] | null
  estimated_timeframe: string | null
  needs_inspection: boolean | null
  pdf_path: string | null
}

type RoofPdfRow = {
  public_token: string
  tenant_id: string | null
  address: string | null
  quote: MultiRoofQuote | null
  routing: string | null
  pdf_path: string | null
}

type SolarPdfRow = {
  public_token: string
  tenant_id: string | null
  address: string | null
  estimate: SolarEstimate | null
  routing: string | null
  pdf_path: string | null
  /** Felt tab (spec 2026-06-13): variant + map record + grounded brief. */
  quote_variant?: string | null
  felt?: { thumbnail_url?: string | null; map_url?: string | null; status?: string | null } | null
  ai_brief?: import('@/lib/solar/ai-brief').SolarAiBriefRecord | null
}

type PaintingPdfRow = {
  public_token: string
  tenant_id: string | null
  address: string | null
  estimate: PaintingEstimate | null
  routing: string | null
  pdf_path: string | null
}

type IntakePdfRow = {
  job_type: string | null
  caller: { name?: string } | null
  trade: string | null
}

/**
 * Render HTML → PDF, enforcing the 5 MB MMS hard cap (spec
 * specs/quote-pdf-branding.md R11/D5). If the first render is over cap,
 * re-render with <img> tags stripped and log it — the SMS still gets a
 * (lighter) PDF rather than one Twilio would reject for size.
 */
const PDF_HARD_CAP_BYTES = 5 * 1024 * 1024
async function renderQuotePdfCapped(html: string, label: string): Promise<Buffer> {
  const pdf = await renderPdfFromHtml(html)
  if (pdf.length <= PDF_HARD_CAP_BYTES) return pdf
  const stripped = html.replace(/<img\b[^>]*>/gi, '')
  const fallback = await renderPdfFromHtml(stripped)
  console.warn('[quote-pdf] over 5MB cap — re-rendered without images', {
    label,
    firstBytes: pdf.length,
    strippedBytes: fallback.length,
  })
  return fallback.length < pdf.length ? fallback : pdf
}

/**
 * Generate (or reuse) the PDF for an electrical/plumbing quote.
 * Returns the storage path, or null when generation isn't possible
 * (Gotenberg unconfigured, inspection-only quote, quote not found).
 * Never throws — callers treat the PDF as a bonus on top of the SMS.
 */
export async function ensureQuotePdf(
  quoteId: string,
  opts: { regenerate?: boolean } = {},
): Promise<string | null> {
  try {
    if (!gotenbergConfigured()) return null
    const { data: quote } = await supabase()
      .from('quotes')
      .select(
        'id, tenant_id, intake_id, share_token, good, better, best, selected_tier, scope_of_works, assumptions, estimated_timeframe, needs_inspection, pdf_path',
      )
      .eq('id', quoteId)
      .maybeSingle<QuotePdfRow>()
    if (!quote) return null
    // Inspection-routed quotes carry no committable prices — a "quote PDF"
    // would put indicative numbers in a document that reads as final.
    if (quote.needs_inspection) return null
    if (quote.pdf_path && !opts.regenerate) return quote.pdf_path

    const intakeRes = quote.intake_id
      ? await supabase()
          .from('intakes')
          .select('job_type, caller, trade')
          .eq('id', quote.intake_id)
          .maybeSingle<IntakePdfRow>()
      : { data: null as IntakePdfRow | null }
    const intake = intakeRes.data

    // Mig 142 — render only the tier(s) this feature's mode surfaces. The full
    // good/better/best stays persisted; the PDF mirrors the customer page.
    const intakeTrade = (intake?.trade as string | null) ?? 'electrical'
    let tierMode: QuoteTierMode = 'single'
    if (quote.tenant_id) {
      const { data: pb } = await supabase()
        .from('pricing_book')
        .select('quote_tier_mode')
        .eq('tenant_id', quote.tenant_id)
        .eq('trade', intakeTrade)
        .maybeSingle<{ quote_tier_mode: string | null }>()
      tierMode = asQuoteTierMode(pb?.quote_tier_mode ?? null)
    }
    const visibleTierKeys = resolveVisibleTiers({
      mode: tierMode,
      present: { good: !!quote.good, better: !!quote.better, best: !!quote.best },
      selectedTier: quote.selected_tier,
    })
    const visibleTierSet = new Set(visibleTierKeys)
    const showRecommended = visibleTierKeys.length > 1

    const branding = await loadTenantBranding(supabase(), quote.tenant_id, intakeTrade)
    const html = buildQuoteReportHtml({
      businessName: branding.businessName,
      branding,
      customerName: intake?.caller?.name ?? null,
      jobType: intake?.job_type ?? 'job',
      scopeOfWorks: quote.scope_of_works,
      assumptions: quote.assumptions,
      estimatedTimeframe: quote.estimated_timeframe,
      good: visibleTierSet.has('good') ? quote.good : null,
      better: visibleTierSet.has('better') ? quote.better : null,
      best: visibleTierSet.has('best') ? quote.best : null,
      selectedTier: showRecommended ? quote.selected_tier : null,
      quoteViewUrl: `${APP_URL}/q/${quote.share_token}`,
    })
    const pdf = await renderQuotePdfCapped(html, `quote:${quoteId}`)
    const path = await storePdf(`quotes/${quoteId}.pdf`, pdf)
    await supabase().from('quotes').update({ pdf_path: path }).eq('id', quoteId)
    return path
  } catch (e) {
    console.error('[quote-pdf] ensureQuotePdf failed (non-fatal)', {
      quoteId,
      message: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}

/**
 * Generate (or reuse) the PDF for a roofing quote. Pass `quote` to render
 * a narrowed (structure-subset) version — the stored row keeps the full
 * quote. Never throws.
 */
export async function ensureRoofQuotePdf(
  publicToken: string,
  opts: { regenerate?: boolean; quote?: MultiRoofQuote; displayRows?: RoofDisplayRow[] } = {},
): Promise<string | null> {
  try {
    if (!gotenbergConfigured()) return null
    const { data: row } = await supabase()
      .from('roofing_measurements')
      .select('public_token, tenant_id, address, quote, routing, pdf_path')
      .eq('public_token', publicToken)
      .maybeSingle<RoofPdfRow>()
    if (!row) return null
    // Inspection-routed roofs carry no committable price — no quote PDF
    // (mirrors the paint/solar guard; defense-in-depth behind the UI gate).
    if (row.routing === 'inspection_required') return null
    if (row.pdf_path && !opts.regenerate && !opts.quote) return row.pdf_path

    const quote = opts.quote ?? row.quote
    if (!quote) return null
    const branding = await loadTenantBranding(supabase(), row.tenant_id, 'roofing')
    // Aerial/outline image — fetched + compressed to a compact data URI
    // (spec R6/R11); null (e.g. Gotenberg/dev or no imagery) omits the figure.
    const mapImageSrc = await prepareImage(
      `${APP_URL}/api/roofing/q/${publicToken}/static-map`,
    )

    const html = buildRoofQuoteReportHtml({
      businessName: branding.businessName,
      branding,
      address: row.address ?? '',
      quote,
      displayRows: opts.displayRows,
      mapImageSrc,
      quoteViewUrl: `${APP_URL}/q/roof/${publicToken}`,
    })
    const pdf = await renderQuotePdfCapped(html, `roof:${publicToken}`)
    const path = await storePdf(`roofs/${publicToken}.pdf`, pdf)
    await supabase().from('roofing_measurements').update({ pdf_path: path }).eq('public_token', publicToken)
    return path
  } catch (e) {
    console.error('[quote-pdf] ensureRoofQuotePdf failed (non-fatal)', {
      publicToken: publicToken.slice(0, 8) + '…',
      message: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}

/**
 * Generate (or reuse) the PDF for a solar quote (migration 106). Reads the
 * full persisted SolarEstimate from solar_estimates.estimate, so no
 * recomputation. Inspection-routed estimates carry no committable price and
 * return null. Stored at solar/<publicToken>.pdf in the same quote-pdfs
 * bucket. Never throws.
 */
export async function ensureSolarQuotePdf(
  publicToken: string,
  opts: { regenerate?: boolean } = {},
): Promise<string | null> {
  try {
    if (!gotenbergConfigured()) return null
    const { data: row } = await supabase()
      .from('solar_estimates')
      .select('public_token, tenant_id, address, estimate, routing, pdf_path, quote_variant, felt, ai_brief')
      .eq('public_token', publicToken)
      .maybeSingle<SolarPdfRow>()
    if (!row) return null
    if (row.routing === 'inspection_required') return null
    if (row.pdf_path && !opts.regenerate) return row.pdf_path

    const estimate = row.estimate
    if (!estimate) return null
    const branding = await loadTenantBranding(supabase(), row.tenant_id, 'solar')

    // Premium proposal sections (spec 2026-06-12 §4.4), behind the same
    // SOLAR_PREMIUM_QUOTE flag the page uses. theme 'light' = print
    // palette. The PDF only generates for confirmed, non-inspection
    // estimates, so the money sections are safely renderable.
    let premium: SolarPremiumQuote | null = null
    if (solarPremiumQuoteEnabled(process.env.SOLAR_PREMIUM_QUOTE)) {
      const config = await loadSolarConfig(supabase())
      premium = buildSolarPremiumQuote({ estimate, config, theme: 'light' })
    }

    const html = buildSolarQuoteReportHtml({
      businessName: branding.businessName,
      branding,
      address: row.address ?? '',
      estimate,
      quoteViewUrl: `${APP_URL}/q/solar/${publicToken}`,
      premium,
      staticMapUrl: `${APP_URL}/api/solar/q/${publicToken}/static-map`,
      // Sun & shade heatmap (build 2026-06-13) — only referenced when the
      // cached asset exists, so the PDF never embeds a 404.
      fluxImageUrl: estimate.context.sun?.flux_image_path
        ? `${APP_URL}/api/solar/q/${publicToken}/flux-heatmap`
        : null,
      // Felt variant (spec 2026-06-13 §4.7-8): the PDF carries the map
      // thumbnail + live link (an iframe can't print) and the grounded
      // AI brief. Instant rows pass null and render identically to today.
      feltMap:
        row.quote_variant === 'felt' && row.felt?.thumbnail_url
          ? {
              thumbnailUrl: row.felt.thumbnail_url ?? null,
              mapUrl: row.felt.map_url ?? null,
            }
          : null,
      aiBrief: row.quote_variant === 'felt' ? (row.ai_brief ?? null) : null,
    })
    const pdf = await renderQuotePdfCapped(html, `solar:${publicToken}`)
    const path = await storePdf(`solar/${publicToken}.pdf`, pdf)
    await supabase().from('solar_estimates').update({ pdf_path: path }).eq('public_token', publicToken)
    return path
  } catch (e) {
    console.error('[quote-pdf] ensureSolarQuotePdf failed (non-fatal)', {
      publicToken: publicToken.slice(0, 8) + '…',
      message: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}

/**
 * Generate (or reuse) the PDF for a residential painting quote (migration
 * 115). Reads the full persisted PaintingEstimate from
 * painting_measurements.estimate, so no recomputation. Inspection-routed
 * jobs carry no committable price and return null. Stored at
 * paint/<publicToken>.pdf in the same quote-pdfs bucket. Never throws.
 */
export async function ensurePaintingPdf(
  publicToken: string,
  opts: { regenerate?: boolean } = {},
): Promise<string | null> {
  try {
    if (!gotenbergConfigured()) return null
    const { data: row } = await supabase()
      .from('painting_measurements')
      .select('public_token, tenant_id, address, estimate, routing, pdf_path')
      .eq('public_token', publicToken)
      .maybeSingle<PaintingPdfRow>()
    if (!row) return null
    if (row.routing === 'inspection_required') return null
    if (row.pdf_path && !opts.regenerate) return row.pdf_path

    const estimate = row.estimate
    if (!estimate) return null
    const branding = await loadTenantBranding(supabase(), row.tenant_id, 'painting')

    const html = buildPaintingQuoteReportHtml({
      businessName: branding.businessName,
      branding,
      address: row.address ?? '',
      estimate,
      // No /q/paint/[token] customer page exists yet — omit the live link
      // so the PDF footer never points at a 404.
      quoteViewUrl: null,
    })
    const pdf = await renderQuotePdfCapped(html, `paint:${publicToken}`)
    const path = await storePdf(`paint/${publicToken}.pdf`, pdf)
    await supabase().from('painting_measurements').update({ pdf_path: path }).eq('public_token', publicToken)
    return path
  } catch (e) {
    console.error('[quote-pdf] ensurePaintingPdf failed (non-fatal)', {
      publicToken: publicToken.slice(0, 8) + '…',
      message: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}
