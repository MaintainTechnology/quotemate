// Quote PDF service (migration 105) — generate, store and link the
// Gotenberg-rendered customer quote PDFs for all three SMS quote flows:
//
//   electrical + plumbing  → quotes row (G/B/B jsonb) → quotes.pdf_path
//   roofing                → roofing_measurements row → .pdf_path
//
// Storage: private `quote-pdfs` bucket
//   quotes/<quoteId>.pdf   ·   roofs/<token>-v2.pdf
//
// Customers download via the stable token routes (/api/q/[token]/pdf,
// /api/q/roof/[token]/pdf — lazy-generate on first hit); the MMS attach
// uses a short-lived signed URL. Everything here is best-effort from the
// callers' perspective: a PDF failure must never block the quote SMS.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { renderPdfFromHtml, gotenbergConfigured } from '@/lib/pdf/gotenberg'
import {
  buildQuoteReportHtml,
  buildQuoteReportHtmlFromBody,
  REPORT_TEMPLATE_VERSION,
  type QuoteReportTier,
  type QuoteReportInput,
} from './report-html'
import { asQuoteTierMode, resolveVisibleTiers, type QuoteTierMode } from './tier-visibility'
import { quotePropertyVisuals } from './property-visuals'
import { hasPropertyVisuals, propertyVisualsImagePath } from './visuals-image-path'
import { quotePdfIsStale, quotePdfSignature, hashReportContent } from './pdf-signature'
import { serializeReportDoc } from './report-doc/serialize'
import type { ReportDoc } from './report-doc/types'
import { buildRoofQuoteReportHtml } from '@/lib/roofing/report-html'
import { roofOutlineImageSrc, type RoofOutlineStructure } from '@/lib/roofing/roof-outline-svg'
import { structureImageRefs, structureStaticMapPath } from '@/lib/roofing/structure-images'
import {
  combinedLayoutMetrics,
  layoutMaterials,
  type LayoutPlan,
} from '@/lib/roofing/layout-plan'
import {
  layoutMapView,
  layoutOverlayImageSrc,
  type LayoutOverlayStructure,
} from '@/lib/roofing/layout-overlay-svg'
import type { MultiRoofQuote } from '@/lib/roofing/types'
import { resolveEffectiveIndices, type RoofDisplayRow } from '@/lib/roofing/selection'
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
const APP_URL = (process.env.APP_URL ?? 'https://www.quotemax.com.au').replace(/\/$/, '')

// Storage-path revision markers (spec quote-visual-parity): painting/solar/
// roofing rows have no pdf_signature column, so the path itself marks which
// template era a cached PDF came from — pre-marker paths regenerate once.
// Bumped 2026-07-10 (roofing introduced at -v2): PDFs now render as ONE
// continuous page rather than A4 page-by-page, so every cached paginated PDF
// regenerates exactly once on its next download.
// -v4 (2026-07-11): + aerial figure and the customer Materials & time table.
// -v5 (2026-07-11): imagery reorganised — photos row + before/after repaint
// pair; the cached AI render's timestamp joins the path marker so a
// customer recolour regenerates the PDF (see ensurePaintingPdf).
// -v6 (2026-07-11): + price-build derivation tail and "How we measured"
// notes (customer-safe detail parity with /q/paint).
// -v7 (2026-07-11): price-build shows per-surface COST (no false rate
// equation / double-counted multiplier rows); PDF honours the tenant's
// quote_tier_mode so a single-price tenant no longer reveals hidden tiers.
const PAINT_PDF_REV = '-v7'
const SOLAR_PDF_REV = '-v3'
// Bump WHENEVER the layout figure's view/compositing maths change, or cached
// PDFs keep serving a figure whose aerial and zone overlay were projected by
// different code (the misaligned-borders report).
//   -v3 (2026-07-11): selection-aware layout-map framing.
//   -v4 (2026-07-11): fixed-metre ring offsets (fractional scaling pushed the
//   far wings of large L-shaped roofs metres off the roofline).
const ROOF_PDF_REV = '-v4'

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
  pdf_signature: string | null
  report_doc: unknown | null
  report_style: unknown | null
}

type RoofPdfRow = {
  public_token: string
  tenant_id: string | null
  address: string | null
  quote: MultiRoofQuote | null
  routing: string | null
  pdf_path: string | null
  /** AI layout plan cache (migration 170) — embed ONLY when 'ready'. */
  layout_status: string | null
  layout_plan: LayoutPlan | null
  /** Tradie selection — the layout map frames ONLY these structures. */
  included_indices: number[] | null
  confirmed_structure: number | null
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
  /** Cached "roof with panels" AI render — embed ONLY when status is 'ready'. */
  panels_image_status?: string | null
  panels_image_path?: string | null
}

type PaintingPdfRow = {
  public_token: string
  tenant_id: string | null
  address: string | null
  estimate: PaintingEstimate | null
  routing: string | null
  pdf_path: string | null
  /** Cached AI repaint (migration 169) — embed ONLY when status is 'ready'. */
  preview_status: string | null
  preview_image_path: string | null
}

type IntakePdfRow = {
  job_type: string | null
  caller: { name?: string } | null
  trade: string | null
  address: string | null
  scope: unknown
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

/** Resolved basis for a quote's report — the quotes row, its intake, and which
 *  tier(s) the tenant's mode surfaces. Shared by the PDF (ensureQuotePdf) and
 *  the inline HTML report (renderQuoteReportHtml) so the two can never drift. */
type QuoteReportContext = {
  quote: QuotePdfRow
  intake: IntakePdfRow | null
  intakeTrade: string
  tierMode: QuoteTierMode
  visibleTierKeys: Array<'good' | 'better' | 'best'>
  visibleTierSet: Set<'good' | 'better' | 'best'>
  recommendedTier: 'good' | 'better' | 'best' | null
}

/**
 * Load a quotes row + its intake and resolve the tenant's visible tiers.
 * Returns null when the quote is missing OR inspection-routed (an inspection
 * quote carries no committable prices — the same guard ensureQuotePdf has always
 * applied). Pure read, never throws to the caller's expectations beyond supabase.
 */
async function loadQuoteReportContext(quoteId: string): Promise<QuoteReportContext | null> {
  const { data: quote } = await supabase()
    .from('quotes')
    .select(
      'id, tenant_id, intake_id, share_token, good, better, best, selected_tier, scope_of_works, assumptions, estimated_timeframe, needs_inspection, pdf_path, pdf_signature, report_doc, report_style',
    )
    .eq('id', quoteId)
    .maybeSingle<QuotePdfRow>()
  if (!quote) return null
  if (quote.needs_inspection) return null

  const intakeRes = quote.intake_id
    ? await supabase()
        .from('intakes')
        .select('job_type, caller, trade, address, scope')
        .eq('id', quote.intake_id)
        .maybeSingle<IntakePdfRow>()
    : { data: null as IntakePdfRow | null }
  const intake = intakeRes.data

  // Mig 142 — render only the tier(s) this feature's mode surfaces. The full
  // good/better/best stays persisted; the report mirrors the customer page.
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
  const recommendedTier = visibleTierKeys.length > 1 ? quote.selected_tier : null

  return { quote, intake, intakeTrade, tierMode, visibleTierKeys, visibleTierSet, recommendedTier }
}

/**
 * Resolve the root-relative property-visuals image path for a quote. Roofing
 * quotes linked to a saved measurement centre on the MEASURED building polygon
 * (matching the customer page's RoofHeroStrip) — geocoding the street-only
 * intake address lands on the wrong building on large/rural parcels. Non-roofing
 * trades skip the DB read. Null when the trade has no property visuals.
 */
async function resolveVisualsImagePath(
  trade: string,
  shareToken: string,
  address: string | null,
): Promise<string | null> {
  if (!hasPropertyVisuals(trade)) return null
  let linkedRoofPublicToken: string | null = null
  if (trade === 'roofing') {
    const { data } = await supabase()
      .from('roofing_measurements')
      .select('public_token')
      .eq('quote_share_token', shareToken)
      .maybeSingle<{ public_token: string | null }>()
    linkedRoofPublicToken = data?.public_token ?? null
  }
  return propertyVisualsImagePath({ trade, shareToken, address, linkedRoofPublicToken })
}

/** Shape the QuoteReportInput both the PDF and the inline HTML render from —
 *  identical output guarantees the on-screen HTML matches the downloaded PDF.
 *  `visualsImageSrc` is the pre-resolved property image (data URI for the PDF,
 *  token-gated proxy URL for the live preview, null when unavailable). */
function buildQuoteReportInput(
  ctx: QuoteReportContext,
  branding: Awaited<ReturnType<typeof loadTenantBranding>>,
  visualsImageSrc: string | null = null,
): QuoteReportInput {
  const { quote, intake, intakeTrade, visibleTierSet, recommendedTier } = ctx
  return {
    businessName: branding.businessName,
    branding,
    customerName: intake?.caller?.name ?? null,
    jobType: intake?.job_type ?? 'job',
    scopeOfWorks: quote.scope_of_works,
    assumptions: quote.assumptions,
    estimatedTimeframe: quote.estimated_timeframe,
    propertyVisuals: quotePropertyVisuals(intakeTrade, intake?.scope ?? null, visualsImageSrc),
    good: visibleTierSet.has('good') ? quote.good : null,
    better: visibleTierSet.has('better') ? quote.better : null,
    best: visibleTierSet.has('best') ? quote.best : null,
    selectedTier: recommendedTier,
    quoteViewUrl: `${APP_URL}/q/${quote.share_token}`,
  }
}

/**
 * Flag-gated (FULL_QUOTE_DOC): render the customer document body from report_doc
 * (via the deterministic serializer) inside the SAME chrome the PDF uses, else
 * today's template. The doc's pricing node renders from the same
 * tier-visibility-filtered good/better/best on `input`, so prices stay grounded,
 * tier-gated, and Stripe-consistent — free text never becomes a price.
 */
function renderQuoteDocumentHtml(input: QuoteReportInput, reportDoc: unknown | null): string {
  if (process.env.FULL_QUOTE_DOC === 'true' && reportDoc && typeof reportDoc === 'object') {
    const body = serializeReportDoc(reportDoc as ReportDoc, {
      good: input.good,
      better: input.better,
      best: input.best,
      selectedTier: input.selectedTier,
    })
    return buildQuoteReportHtmlFromBody(input, body)
  }
  return buildQuoteReportHtml(input)
}

/**
 * The report as self-contained HTML (the exact document Gotenberg renders to
 * PDF), for the dashboard quote viewer's inline, editable preview. Returns null
 * for a missing or inspection-routed quote (mirrors ensureQuotePdf). Reads the
 * live quotes row every call, so it reflects a structured edit the instant it
 * saves — no PDF regeneration needed for the preview to update.
 */
export async function renderQuoteReportHtml(quoteId: string): Promise<string | null> {
  const ctx = await loadQuoteReportContext(quoteId)
  if (!ctx) return null
  const branding = await loadTenantBranding(supabase(), ctx.quote.tenant_id, ctx.intakeTrade)
  // Live preview: reference the token-gated satellite proxy directly (relative
  // URL — the preview renders on the app origin), exactly like the customer
  // page's RoofHeroStrip (roofing centres on the measured polygon, not the
  // geocoded address). The PDF path embeds a data URI instead.
  const visualsImageSrc = await resolveVisualsImagePath(
    ctx.intakeTrade,
    ctx.quote.share_token,
    ctx.intake?.address ?? null,
  )
  return renderQuoteDocumentHtml(
    buildQuoteReportInput(ctx, branding, visualsImageSrc),
    ctx.quote.report_doc,
  )
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
    // Inspection-routed quotes carry no committable prices — a "quote PDF"
    // would put indicative numbers in a document that reads as final —
    // loadQuoteReportContext returns null for them (and for a missing quote).
    const ctx = await loadQuoteReportContext(quoteId)
    if (!ctx) return null
    const { quote, intakeTrade, tierMode, visibleTierKeys, recommendedTier } = ctx

    // Mig 146 — self-heal: serve the cached PDF only when it was rendered from
    // the SAME template version + tier mode + visible tiers + recommended tier.
    // A tradie flipping the Pricing-settings tier mode (or a template bump)
    // changes the signature, so the next download/send regenerates instead of
    // serving a stale Good/Better/Best PDF.
    // Fold the document content hash into the signature ONLY when the doc render
    // is active, so a report_doc/report_style edit regenerates the PDF. Flag off
    // ⇒ docHash '' ⇒ signature byte-identical to the pre-Phase-1 format (no
    // spurious regeneration of existing cached PDFs).
    const docHash =
      process.env.FULL_QUOTE_DOC === 'true'
        ? hashReportContent(quote.report_doc, quote.report_style)
        : ''
    const freshSignature = quotePdfSignature({
      templateVersion: REPORT_TEMPLATE_VERSION,
      tierMode,
      visibleTierKeys,
      recommendedTier,
      docHash,
    })
    if (
      !quotePdfIsStale({
        pdfPath: quote.pdf_path,
        storedSignature: quote.pdf_signature,
        freshSignature,
        regenerate: opts.regenerate,
      })
    ) {
      return quote.pdf_path
    }

    const branding = await loadTenantBranding(supabase(), quote.tenant_id, intakeTrade)
    // Property visuals image (roofing / commercial painting) — fetched via the
    // same token-gated satellite proxy the customer page uses, embedded as a
    // data URI (mirrors ensureRoofQuotePdf). Roofing centres on the measured
    // polygon (not the geocoded street address). Best-effort: prepareImage never
    // throws; null just renders the stats-only block.
    const visualsPath = await resolveVisualsImagePath(
      intakeTrade,
      quote.share_token,
      ctx.intake?.address ?? null,
    )
    const visualsImageSrc = visualsPath
      ? await prepareImage(`${APP_URL}${visualsPath}`, { maxEdge: 640 })
      : null
    const html = renderQuoteDocumentHtml(
      buildQuoteReportInput(ctx, branding, visualsImageSrc),
      quote.report_doc,
    )
    const pdf = await renderQuotePdfCapped(html, `quote:${quoteId}`)
    const path = await storePdf(`quotes/${quoteId}.pdf`, pdf)
    await supabase()
      .from('quotes')
      .update({ pdf_path: path, pdf_signature: freshSignature })
      .eq('id', quoteId)
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
      .select(
        'public_token, tenant_id, address, quote, routing, pdf_path, layout_status, layout_plan, included_indices, confirmed_structure',
      )
      .eq('public_token', publicToken)
      .maybeSingle<RoofPdfRow>()
    if (!row) return null
    // Inspection-routed roofs carry no committable price — no quote PDF
    // (mirrors the paint/solar guard; defense-in-depth behind the UI gate).
    if (row.routing === 'inspection_required') return null
    // Path rev marker (see ROOF_PDF_REV) — a cached PDF from an older figure/
    // template era regenerates once on the next download. A cached PDF is
    // valid even for narrowed (opts.quote) calls: the narrowed quote derives
    // from the persisted selection, and the selection-update route NULLS
    // pdf_path on change (app/api/roofing/measurement/[token]/route.ts), so a
    // surviving pdf_path always reflects the current selection.
    if (row.pdf_path && row.pdf_path.includes(ROOF_PDF_REV) && !opts.regenerate) {
      return row.pdf_path
    }

    const quote = opts.quote ?? row.quote
    if (!quote) return null

    // Mig 148 — honour the tenant's roofing tier mode (dashboard Pricing
    // settings) so a single-price roofer's PDF shows one option, not the full
    // Good/Better/Best layout. Mirrors the roofing SMS path
    // (app/api/sms/inbound/route.ts) and ensureQuotePdf for electrical/plumbing.
    let roofTierMode: QuoteTierMode = 'single'
    if (row.tenant_id) {
      const { data: rb } = await supabase()
        .from('pricing_book')
        .select('quote_tier_mode')
        .eq('tenant_id', row.tenant_id)
        .eq('trade', 'roofing')
        .maybeSingle<{ quote_tier_mode: string | null }>()
      roofTierMode = asQuoteTierMode(rb?.quote_tier_mode ?? null)
    }
    const visibleTierKeys = resolveVisibleTiers({
      mode: roofTierMode,
      present: {
        good: quote.combined.tiers.some((t) => t.tier === 'good'),
        better: quote.combined.tiers.some((t) => t.tier === 'better'),
        best: quote.combined.tiers.some((t) => t.tier === 'best'),
      },
      selectedTier: null,
    })

    const branding = await loadTenantBranding(supabase(), row.tenant_id, 'roofing')
    // Hero figure — the coloured roof outline tracing on a plain white
    // background, drawn from the stored footprint polygon(s) (spec
    // roof-pdf-outline-tracing). Draw EVERY detected structure when displayRows
    // is supplied (included solid, excluded faint/dashed); else the narrowed
    // quote's structures, all included. Self-contained data URI — no fetch.
    const outlineStructures: RoofOutlineStructure[] =
      opts.displayRows && opts.displayRows.length
        ? opts.displayRows.map((r) => ({
            polygon: r.structure.metrics?.polygon_geojson,
            form: r.structure.metrics?.form ?? 'unknown',
            included: r.included,
          }))
        : quote.structures.map((s) => ({
            polygon: s.metrics?.polygon_geojson,
            form: s.metrics?.form ?? 'unknown',
            included: true,
          }))
    const outlineImageSrc = roofOutlineImageSrc(outlineStructures, { width: 1000, height: 750 })

    // Aerial photo(s). One per INCLUDED structure, each centred on its building
    // via static-map ?b=. Map the rendered (narrowed/included) structures back
    // to their 1-based index in the FULL stored quote (row.quote) by buildingId,
    // because the static-map endpoint indexes the full quote and the rendered
    // quote may be a re-ordered subset from a separate DB read. Deriving this
    // INSIDE ensureRoofQuotePdf means every entry point (download route, SMS
    // send, file-store) gets the multi-structure aerials, even those that pass a
    // narrowed `quote` and no `displayRows`. Single structure → keep the legacy
    // single no-?b aerial as the figure-pair thumb (byte-identical to before).
    // (spec roofing-pdf-multi-structure-images R2)
    const imageRefs = structureImageRefs(row.quote?.structures, quote.structures)
    let structureImages: { label: string; src: string | null }[] | undefined
    let mapImageSrc: string | null = null
    if (imageRefs.length > 1) {
      structureImages = await Promise.all(
        imageRefs.map(async (r) => ({
          label: r.label,
          src: await prepareImage(`${APP_URL}${structureStaticMapPath(publicToken, r.index1Based)}`),
        })),
      )
    } else {
      mapImageSrc = await prepareImage(
        `${APP_URL}/api/roofing/q/${publicToken}/static-map`,
      )
    }

    // AI work-strategy layout map (spec quote-visual-parity R6e) — the CACHED
    // plan only, SELECTION-AWARE (user rule 2026-07-11): the aerial frames
    // exactly the structures the tradie ticked (one selected → zoomed to it
    // alone; two → both; all → all), only their zones draw, and the material
    // estimates sum only the selected structures. The ?fit=1&sel= static map
    // and layoutMapView compute the identical subset view, keeping the
    // overlay aligned with the imagery.
    let layoutOverlay: Parameters<typeof buildRoofQuoteReportHtml>[0]['layoutOverlay'] = null
    if (row.layout_status === 'ready' && row.layout_plan && row.quote?.structures?.length) {
      const overlayStructures: LayoutOverlayStructure[] = row.quote.structures.map((s) => ({
        polygon: s.metrics?.polygon_geojson ?? null,
        form: s.metrics?.form ?? 'unknown',
      }))
      const effective = resolveEffectiveIndices(
        {
          included: row.included_indices,
          confirmedStructure: row.confirmed_structure,
          paramIndices: null,
        },
        row.quote,
      )
      const includedSet = new Set(effective)
      const visibleZones =
        includedSet.size > 0
          ? row.layout_plan.zones.filter((z) => includedSet.has(z.structureIndex))
          : row.layout_plan.zones
      const includedOverlayStructures =
        effective.length > 0
          ? effective.map((i) => overlayStructures[i - 1]).filter(Boolean)
          : overlayStructures
      const includedStructures =
        effective.length > 0
          ? effective.map((i) => row.quote!.structures[i - 1]).filter(Boolean)
          : row.quote.structures
      const view = layoutMapView(includedOverlayStructures, { width: 640, height: 480 })
      const overlaySrc =
        view && visibleZones.length > 0
          ? layoutOverlayImageSrc({
              zones: visibleZones,
              structures: overlayStructures,
              center: view.center,
              zoom: view.zoom,
              width: 640,
              height: 480,
            })
          : null
      const sel = effective.length > 0 ? `&sel=${effective.join(',')}` : ''
      const aerialSrc = overlaySrc
        ? await prepareImage(`${APP_URL}/api/roofing/q/${publicToken}/static-map?fit=1${sel}`)
        : null
      if (overlaySrc && aerialSrc) {
        layoutOverlay = {
          header: row.layout_plan.header,
          aerialSrc,
          overlaySrc,
          legend: visibleZones.map((z) => ({ color: z.color, label: z.label })),
          // Deterministic material estimates over the SELECTED structures.
          materials: layoutMaterials(
            combinedLayoutMetrics(includedStructures),
            row.layout_plan.mode,
          ),
        }
      }
    }

    const html = buildRoofQuoteReportHtml({
      businessName: branding.businessName,
      branding,
      address: row.address ?? '',
      quote,
      visibleTierKeys,
      displayRows: opts.displayRows,
      outlineImageSrc,
      mapImageSrc,
      structureImages,
      layoutOverlay,
      quoteViewUrl: `${APP_URL}/q/roof/${publicToken}`,
    })
    const pdf = await renderQuotePdfCapped(html, `roof:${publicToken}`)
    const path = await storePdf(`roofs/${publicToken}${ROOF_PDF_REV}.pdf`, pdf)
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
      .select(
        'public_token, tenant_id, address, estimate, routing, pdf_path, quote_variant, felt, ai_brief, panels_image_status, panels_image_path',
      )
      .eq('public_token', publicToken)
      .maybeSingle<SolarPdfRow>()
    if (!row) return null
    if (row.routing === 'inspection_required') return null
    // '-v2' path marker = rendered WITH the panels-after figure availability
    // (spec quote-visual-parity R5); pre-marker cached PDFs regenerate once.
    if (row.pdf_path && row.pdf_path.includes(SOLAR_PDF_REV) && !opts.regenerate) {
      return row.pdf_path
    }

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
      // "Roof with panels" AI visual (spec quote-visual-parity R5) — only the
      // CACHED render is referenced, so the PDF never triggers a Gemini bill.
      panelsAfterUrl:
        row.panels_image_status === 'ready' && row.panels_image_path
          ? `${APP_URL}/api/solar/q/${publicToken}/panels-after`
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
    const path = await storePdf(`solar/${publicToken}${SOLAR_PDF_REV}.pdf`, pdf)
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
      .select(
        'public_token, tenant_id, address, estimate, routing, pdf_path, preview_status, preview_image_path',
      )
      .eq('public_token', publicToken)
      .maybeSingle<PaintingPdfRow>()
    if (!row) return null
    if (row.routing === 'inspection_required') return null
    // Rev path marker = rendered by the current layout (spec
    // quote-visual-parity R2) — a stale cached PDF regenerates once on the
    // next download; self-heal without a migration. When an AI repaint is
    // cached, the render's timestamp (painting/<id>/after-<ts>.<ext>) is
    // appended so a customer recolour also invalidates the PDF — the PDF
    // always embeds the CURRENT colour choice.
    const wantAfter = row.preview_status === 'ready' && !!row.preview_image_path
    const afterStamp = wantAfter
      ? ((row.preview_image_path as string).match(/after-(\d+)/)?.[1] ?? 'r')
      : null
    const paintRev = afterStamp ? `${PAINT_PDF_REV}-${afterStamp}` : PAINT_PDF_REV
    if (row.pdf_path && row.pdf_path.includes(paintRev) && !opts.regenerate) {
      return row.pdf_path
    }

    const estimate = row.estimate
    if (!estimate) return null

    // Honour the tenant's painting tier mode (mig 142) so a single-price
    // tenant's PDF shows one option, exactly like /q/paint — never revealing
    // the hidden Good/Best tiers, their relation rows or materials. Mirrors
    // ensureRoofQuotePdf and the /q/paint page's own tier gating.
    const paintTiers = estimate.price?.tiers ?? []
    let paintTierMode: QuoteTierMode = 'single'
    if (row.tenant_id) {
      const { data: ppb } = await supabase()
        .from('pricing_book')
        .select('quote_tier_mode')
        .eq('tenant_id', row.tenant_id)
        .eq('trade', 'painting')
        .maybeSingle<{ quote_tier_mode: string | null }>()
      paintTierMode = asQuoteTierMode(ppb?.quote_tier_mode ?? null)
    }
    const paintVisibleTierKeys = resolveVisibleTiers({
      mode: paintTierMode,
      present: {
        good: paintTiers.some((t) => t.tier === 'good'),
        better: paintTiers.some((t) => t.tier === 'better'),
        best: paintTiers.some((t) => t.tier === 'best'),
      },
      selectedTier: 'better',
    })

    // Property imagery (spec quote-visual-parity R2) — the same token-gated
    // proxies the /p and /q/paint pages use, embedded as data URIs.
    // Street View + the aerial are plain proxy fetches; the AI repaint
    // embeds ONLY when the render is already cached ('ready') so PDF
    // generation never bills Gemini. All fetches are independent.
    const [branding, streetViewSrc, aerialSrc, afterImageSrc] = await Promise.all([
      loadTenantBranding(supabase(), row.tenant_id, 'painting'),
      prepareImage(`${APP_URL}/api/painting/q/${publicToken}/street-view`, { maxEdge: 640 }),
      prepareImage(`${APP_URL}/api/painting/q/${publicToken}/static-map`, { maxEdge: 640 }),
      wantAfter
        ? prepareImage(`${APP_URL}/api/painting/q/${publicToken}/after-image`, { maxEdge: 640 })
        : Promise.resolve(null),
    ])

    const html = buildPaintingQuoteReportHtml({
      businessName: branding.businessName,
      branding,
      address: row.address ?? '',
      estimate,
      visibleTierKeys: paintVisibleTierKeys,
      streetViewSrc,
      aerialSrc,
      afterImageSrc,
      quoteViewUrl: `${APP_URL}/q/paint/${publicToken}`,
    })
    const pdf = await renderQuotePdfCapped(html, `paint:${publicToken}`)
    const path = await storePdf(`paint/${publicToken}${paintRev}.pdf`, pdf)
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
