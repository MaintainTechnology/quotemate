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
import { buildRoofQuoteReportHtml } from '@/lib/roofing/report-html'
import type { MultiRoofQuote } from '@/lib/roofing/types'
import { buildSolarQuoteReportHtml } from '@/lib/solar/report-html'
import { buildPylonProposalHtml } from '@/lib/pylon/proposal-html'
import { buildPylonModelled } from '@/lib/pylon/modelled'
import {
  buildPylonQuoteTable,
  type PylonProposalCustomer,
  type PylonProposalDesign,
  type PylonProposalSite,
} from '@/lib/pylon/proposal'
import { buildOpenSolarProposalHtml } from '@/lib/opensolar/proposal-html'
import { buildOpenSolarModelled } from '@/lib/opensolar/modelled'
import {
  buildOpenSolarQuoteTable,
  type OpenSolarProposalCustomer,
  type OpenSolarProposalDesign,
  type OpenSolarProposalSite,
} from '@/lib/opensolar/proposal'
import {
  buildSolarPremiumQuote,
  solarPremiumQuoteEnabled,
  type SolarPremiumQuote,
} from '@/lib/solar/premium-quote'
import { loadSolarConfig } from '@/lib/solar/config'
import type { SolarEstimate } from '@/lib/solar/types'

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

/** Stable customer download URL for a Pylon proposal PDF. */
export function pylonProposalPdfUrl(publicToken: string): string {
  return `${APP_URL}/api/q/pylon/${publicToken}/pdf`
}

/** Stable customer download URL for an OpenSolar proposal PDF. */
export function openSolarProposalPdfUrl(publicToken: string): string {
  return `${APP_URL}/api/q/opensolar/${publicToken}/pdf`
}

async function storePdf(path: string, data: Buffer): Promise<string> {
  const { error } = await supabase()
    .storage.from(BUCKET)
    .upload(path, data, { contentType: 'application/pdf', upsert: true })
  if (error) throw new Error(`quote-pdf upload failed: ${error.message}`)
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
  pdf_path: string | null
}

type SolarPdfRow = {
  public_token: string
  tenant_id: string | null
  address: string | null
  estimate: SolarEstimate | null
  routing: string | null
  pdf_path: string | null
}

type IntakePdfRow = {
  job_type: string | null
  caller: { name?: string } | null
}

async function tenantBusinessName(tenantId: string | null): Promise<string> {
  if (!tenantId) return 'QuoteMate'
  const { data } = await supabase()
    .from('tenants')
    .select('business_name')
    .eq('id', tenantId)
    .maybeSingle<{ business_name: string | null }>()
  return data?.business_name ?? 'QuoteMate'
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

    const [intakeRes, businessName] = await Promise.all([
      quote.intake_id
        ? supabase()
            .from('intakes')
            .select('job_type, caller')
            .eq('id', quote.intake_id)
            .maybeSingle<IntakePdfRow>()
        : Promise.resolve({ data: null as IntakePdfRow | null }),
      tenantBusinessName(quote.tenant_id),
    ])
    const intake = intakeRes.data

    const html = buildQuoteReportHtml({
      businessName,
      customerName: intake?.caller?.name ?? null,
      jobType: intake?.job_type ?? 'job',
      scopeOfWorks: quote.scope_of_works,
      assumptions: quote.assumptions,
      estimatedTimeframe: quote.estimated_timeframe,
      good: quote.good,
      better: quote.better,
      best: quote.best,
      selectedTier: quote.selected_tier,
      quoteViewUrl: `${APP_URL}/q/${quote.share_token}`,
    })
    const pdf = await renderPdfFromHtml(html)
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
  opts: { regenerate?: boolean; quote?: MultiRoofQuote } = {},
): Promise<string | null> {
  try {
    if (!gotenbergConfigured()) return null
    const { data: row } = await supabase()
      .from('roofing_measurements')
      .select('public_token, tenant_id, address, quote, pdf_path')
      .eq('public_token', publicToken)
      .maybeSingle<RoofPdfRow>()
    if (!row) return null
    if (row.pdf_path && !opts.regenerate && !opts.quote) return row.pdf_path

    const quote = opts.quote ?? row.quote
    if (!quote) return null
    const businessName = await tenantBusinessName(row.tenant_id)

    const html = buildRoofQuoteReportHtml({
      businessName,
      address: row.address ?? '',
      quote,
      quoteViewUrl: `${APP_URL}/q/roof/${publicToken}`,
    })
    const pdf = await renderPdfFromHtml(html)
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
type PylonPdfRow = {
  public_token: string
  tenant_id: string | null
  title: string | null
  address_text: string | null
  customer: PylonProposalCustomer | null
  site: PylonProposalSite | null
  design: PylonProposalDesign | null
  assets: Record<string, string | null> | null
  confirmed_at: string | null
  pdf_path: string | null
}

/**
 * Generate (or reuse) the PDF for an imported Pylon proposal. Only renders
 * post-confirm (the document carries the full verbatim quote table) and
 * embeds the CACHED design artefacts via the token-gated asset routes.
 * Never throws.
 */
export async function ensurePylonProposalPdf(
  publicToken: string,
  opts: { regenerate?: boolean } = {},
): Promise<string | null> {
  try {
    if (!gotenbergConfigured()) return null
    const { data: row } = await supabase()
      .from('pylon_proposals')
      .select(
        'public_token, tenant_id, title, address_text, customer, site, design, assets, confirmed_at, pdf_path',
      )
      .eq('public_token', publicToken)
      .maybeSingle<PylonPdfRow>()
    if (!row) return null
    if (!row.confirmed_at) return null
    if (row.pdf_path && !opts.regenerate) return row.pdf_path

    const design = row.design
    if (!design) return null
    const businessName = await tenantBusinessName(row.tenant_id)

    const config = await loadSolarConfig(supabase())
    const state = row.site?.address?.state ?? null
    const modelled = buildPylonModelled({ design, state, config, theme: 'light' })

    const assets = row.assets ?? {}
    const assetUrl = (kind: string, key: string) =>
      assets[key] ? `${APP_URL}/api/pylon/q/${publicToken}/asset/${kind}` : null

    const html = buildPylonProposalHtml({
      businessName,
      title: row.title,
      address: row.address_text,
      customerName: row.customer?.name ?? null,
      design,
      table: buildPylonQuoteTable(design),
      modelled,
      snapshotUrl: assetUrl('snapshot', 'snapshot_path'),
      sldUrl: assetUrl('sld', 'sld_path'),
      siteInfoUrl: assetUrl('site-info', 'site_info_path'),
      quoteViewUrl: `${APP_URL}/q/pylon/${publicToken}`,
    })
    const pdf = await renderPdfFromHtml(html)
    const path = await storePdf(`pylon/${publicToken}.pdf`, pdf)
    await supabase().from('pylon_proposals').update({ pdf_path: path }).eq('public_token', publicToken)
    return path
  } catch (e) {
    console.error('[quote-pdf] ensurePylonProposalPdf failed (non-fatal)', {
      publicToken: publicToken.slice(0, 8) + '…',
      message: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}

type OpenSolarPdfRow = {
  public_token: string
  tenant_id: string | null
  title: string | null
  address_text: string | null
  customer: OpenSolarProposalCustomer | null
  site: OpenSolarProposalSite | null
  design: OpenSolarProposalDesign | null
  assets: Record<string, string | null> | null
  confirmed_at: string | null
  pdf_path: string | null
}

/**
 * Generate (or reuse) the PDF for an imported OpenSolar proposal. Only
 * renders post-confirm (the document carries the full verbatim quote
 * table) and embeds the CACHED artefacts (system image, shade report,
 * energy yield report, PV site plan) via token-gated asset routes.
 * Never throws.
 */
export async function ensureOpenSolarProposalPdf(
  publicToken: string,
  opts: { regenerate?: boolean } = {},
): Promise<string | null> {
  try {
    if (!gotenbergConfigured()) return null
    const { data: row } = await supabase()
      .from('opensolar_proposals')
      .select(
        'public_token, tenant_id, title, address_text, customer, site, design, assets, confirmed_at, pdf_path',
      )
      .eq('public_token', publicToken)
      .maybeSingle<OpenSolarPdfRow>()
    if (!row) return null
    if (!row.confirmed_at) return null
    if (row.pdf_path && !opts.regenerate) return row.pdf_path

    const design = row.design
    if (!design) return null
    const businessName = await tenantBusinessName(row.tenant_id)

    const config = await loadSolarConfig(supabase())
    const state = row.site?.state ?? null
    const modelled = buildOpenSolarModelled({ design, state, config, theme: 'light' })

    const assets = row.assets ?? {}
    const assetUrl = (kind: string, key: string) =>
      assets[key] ? `${APP_URL}/api/opensolar/q/${publicToken}/asset/${kind}` : null

    const html = buildOpenSolarProposalHtml({
      businessName,
      title: row.title,
      address: row.address_text,
      customerName: row.customer?.name ?? null,
      design,
      table: buildOpenSolarQuoteTable(design),
      modelled,
      systemImageUrl: assetUrl('system-image', 'system_image_path'),
      shadeReportUrl: assetUrl('shade-report', 'shade_report_path'),
      energyYieldUrl: assetUrl('energy-yield', 'energy_yield_path'),
      sitePlanUrl: assetUrl('site-plan', 'site_plan_path'),
      quoteViewUrl: `${APP_URL}/q/opensolar/${publicToken}`,
    })
    const pdf = await renderPdfFromHtml(html)
    const path = await storePdf(`opensolar/${publicToken}.pdf`, pdf)
    await supabase()
      .from('opensolar_proposals')
      .update({ pdf_path: path })
      .eq('public_token', publicToken)
    return path
  } catch (e) {
    console.error('[quote-pdf] ensureOpenSolarProposalPdf failed (non-fatal)', {
      publicToken: publicToken.slice(0, 8) + '…',
      message: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}

export async function ensureSolarQuotePdf(
  publicToken: string,
  opts: { regenerate?: boolean } = {},
): Promise<string | null> {
  try {
    if (!gotenbergConfigured()) return null
    const { data: row } = await supabase()
      .from('solar_estimates')
      .select('public_token, tenant_id, address, estimate, routing, pdf_path')
      .eq('public_token', publicToken)
      .maybeSingle<SolarPdfRow>()
    if (!row) return null
    if (row.routing === 'inspection_required') return null
    if (row.pdf_path && !opts.regenerate) return row.pdf_path

    const estimate = row.estimate
    if (!estimate) return null
    const businessName = await tenantBusinessName(row.tenant_id)

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
      businessName,
      address: row.address ?? '',
      estimate,
      quoteViewUrl: `${APP_URL}/q/solar/${publicToken}`,
      premium,
      staticMapUrl: `${APP_URL}/api/solar/q/${publicToken}/static-map`,
    })
    const pdf = await renderPdfFromHtml(html)
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
