// The builder quote (TKO-22, D-03, DEC-025/026): a plan measurement priced as
// new work and rendered as a PDF for the tradie to send a builder.
//
// New work is priced here, beside the platform's pricer, not inside it: that
// pricer's tiers are an existing roof's (patch, re-roof, upgrade) and the SMS
// receptionist prices with it, so it stays exactly as it is. A new roof takes
// only the rates the tenant set for new work, kept in their pricing book as
// `overlays.roofing_new_work_rates.rate_per_m2`, beside the roofing card, so
// saving the card never drops them. Re-roof rates include stripping the old
// roof, and the default card isn't the tenant's, so neither is ever used.
//
// Nothing is written, and the quote is a PDF, never a quotes row, so no page
// or editor can create a Stripe session for it (DEC-009).

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadTenantBranding } from '@/lib/pdf/branding'
import { renderPdfFromHtml } from '@/lib/pdf/gotenberg'
import { aud2, esc, renderReportDocument, type TenantBranding } from '@/lib/pdf/report-chrome'
import { applicableLoadings, type RoofStructureInput } from '@/lib/roofing/pricing'
import { loadTenantRoofingPricingContext } from '@/lib/roofing/pricing-authority'
import { NEW_WORK_RATES_KEY, newWorkRates } from '@/lib/roofing/rate-card-overlay'
import type { RoofingRateCard, RoofMaterial } from '@/lib/roofing/types'
import { toRoofStructures, type PriceOptions, type Unpriced } from './metrics'
import { runWithTakeoff } from './save'
import type { RoofPlanTakeoff } from './schema'

export type NewWorkRates = Partial<Record<RoofMaterial, number>>

// ponytail: the pricer keeps its material words inside tierScopeLine.
const MATERIAL_NAMES: Partial<Record<RoofMaterial, string>> = {
  colorbond_corrugated: 'Colorbond corrugated',
  colorbond_trimdek: 'Colorbond Trimdek',
  colorbond_spandek: 'Colorbond Spandek',
  colorbond_kliplok: 'Colorbond Klip-Lok',
  concrete_tile: 'concrete tile',
  terracotta_tile: 'terracotta tile',
}

// The rates' reader lives beside the card's, where the dashboard saves them.
export { newWorkRates }

export type NewWorkTier = { key: 'as_drawn' | 'upgrade'; label: string; ex_gst: number; inc_gst: number }
export type NewWorkRoof = {
  id: string | null
  label: string
  material: RoofMaterial
  area_m2: number
  pitch_degrees: number | null
  as_drawn_ex_gst: number
  upgrade_ex_gst: number
}
export type NewWorkPrice =
  | { ok: true; gst_registered: boolean; structures: NewWorkRoof[]; tiers: NewWorkTier[] }
  | { ok: false; error: 'no_new_work_rates'; materials: RoofMaterial[] }

const cents = (n: number) => Math.round(n * 100) / 100

/** Each roof as drawn and as the card's upgrade material, at the tenant's
 *  new-work rates with the storey and complexity loadings, the job at least
 *  the call-out minimum. */
export function priceNewWork(structures: RoofStructureInput[], card: RoofingRateCard, rates: NewWorkRates): NewWorkPrice {
  const upgrade = card.upgrade_material
  const missing = [...new Set([...structures.map((s) => s.inputs.material), upgrade])].filter((m) => !rates[m])
  if (missing.length) return { ok: false, error: 'no_new_work_rates', materials: missing }
  const roofs = structures.map((s): NewWorkRoof => {
    const material = s.inputs.material
    const area = s.metrics.sloped_area_m2 ?? s.metrics.footprint_m2
    // A new roof has nothing to strip, so no asbestos loading.
    const loading = applicableLoadings(s.metrics, s.inputs, card)
      .filter((l) => l.code !== 'asbestos')
      .reduce((sum, l) => sum + l.pct, 0)
    const at = (rate: number) => cents(area * rate * (1 + loading))
    return {
      id: s.buildingId,
      label: s.label ?? '',
      material,
      area_m2: area,
      pitch_degrees: s.metrics.pitch_degrees ?? null,
      as_drawn_ex_gst: at(rates[material]!),
      upgrade_ex_gst: at(Math.max(rates[upgrade]!, rates[material]!)),
    }
  })
  const tier = (key: NewWorkTier['key'], label: string, sum: number): NewWorkTier => {
    const ex = cents(Math.max(sum, card.call_out_minimum_ex_gst ?? 0))
    return { key, label, ex_gst: ex, inc_gst: card.gst_registered ? cents(ex * 1.1) : ex }
  }
  return {
    ok: true,
    gst_registered: card.gst_registered,
    structures: roofs,
    tiers: [
      tier('as_drawn', 'As drawn', roofs.reduce((sum, r) => sum + r.as_drawn_ex_gst, 0)),
      tier('upgrade', `Upgrade to ${MATERIAL_NAMES[upgrade] ?? upgrade}`, roofs.reduce((sum, r) => sum + r.upgrade_ex_gst, 0)),
    ],
  }
}

const list = (items: string[]) =>
  (items.length ? `<ul class="bullets">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="note">None.</p>')

// The quote prints on A4 pages: as one tall page, Gotenberg dropped its
// closing note at some text lengths (Grange on staging, 3 Nov). The chrome's
// footer is fixed, so on A4 it would print over each page's last lines; here
// it prints once, at the end.
const A4_FOOTER = '<style>.accentbar, .footline { position: static; }</style>'

/** The quote's page, on the platform's quote chrome: no booking, payment or
 *  site-visit section. */
export function builderQuoteHtml(input: {
  branding: TenantBranding
  builder: string | null
  site: string
  jobRef: string | null
  jobName: string | null
  takeoff: RoofPlanTakeoff
  date: Date
  priced: Extract<NewWorkPrice, { ok: true }>
}): string {
  const { priced } = input
  const gst = priced.gst_registered
  const job = [input.jobName, input.jobRef].filter(Boolean).join(', ')
  const sheets = input.takeoff.sheets
    .filter((s) => s.used)
    .map((s) => [s.number, s.title].filter(Boolean).join(' '))
    .filter(Boolean)
  const roofRows = priced.structures
    .map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(MATERIAL_NAMES[r.material] ?? r.material)}</td>`
      + `<td class="num">${r.area_m2.toFixed(2)} m²</td><td class="num">${r.pitch_degrees === null ? '' : `${r.pitch_degrees}°`}</td></tr>`)
    .join('')
  const priceRows = priced.tiers
    .map((t) => `<tr><td>${esc(t.label)}</td><td class="num">${aud2(t.ex_gst)}</td>`
      + (gst ? `<td class="num">${aud2(t.inc_gst - t.ex_gst)}</td><td class="num">${aud2(t.inc_gst)}</td>` : '') + '</tr>')
    .join('')
  const body = `${A4_FOOTER}
  <h2>Roofs</h2>
  <table>
    <thead><tr><th>Roof</th><th>Material</th><th class="num">Sloped area</th><th class="num">Pitch</th></tr></thead>
    <tbody>${roofRows}</tbody>
  </table>
  <h2>Price</h2>
  <table>
    <thead><tr><th>Option</th>${gst ? '<th class="num">Ex GST</th><th class="num">GST</th><th class="num">Inc GST</th>' : '<th class="num">Price</th>'}</tr></thead>
    <tbody>${priceRows}</tbody>
  </table>
  <h2>Includes</h2>${list(input.takeoff.scope.includes)}
  <h2>Excludes</h2>${list(input.takeoff.scope.excludes)}
  <h2>To confirm</h2>${list(input.takeoff.scope.questions)}`
  return renderReportDocument(input.branding, {
    docTitle: `Roofing quote — ${input.branding.businessName}`,
    eyebrow: 'Roofing quote · New work',
    // ponytail: an eastern-states date; the tenant's own zone when one is stored.
    dateLabel: input.date.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney' }),
    customerName: input.builder,
    siteAddress: input.site,
    introHtml: `The roof covering${job ? ` for <strong>${esc(job)}</strong>` : ''}, measured from the plans supplied.`,
    bodyHtml: body,
    pleaseNote: [
      `Measured from the builder's plans${sheets.length ? `: ${sheets.join('; ')}` : ''}.`,
      "The price is the roof covering at the rates for new work per square metre of roof, with its loadings. It doesn't price gutters, downpipes, fascia, soffit or sarking.",
    ],
    footerPriceNote: gst ? 'Prices shown ex and inc GST' : 'No GST is charged',
  })
}

export type BuilderQuoteOutcome =
  | { ok: true; pdf: Buffer; filename: string }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'run_not_ready'; status: string }
  | { ok: false; error: 'unknown_structures'; ids: string[] }
  | { ok: false; error: 'unpriceable'; structures: Unpriced[] }
  | { ok: false; error: 'no_rate_card' }
  | { ok: false; error: 'no_new_work_rates'; materials: RoofMaterial[] }
  | { ok: false; error: 'pdf_unavailable' }

/** The run's builder quote as a PDF, from a run the save would take, or a
 *  saved one. Writes nothing. */
export async function builderQuote(db: SupabaseClient, input: {
  tenantId: string
  runId: string
  options?: PriceOptions
  acceptReview?: boolean
  /** Gotenberg, unless a test gives its own. */
  render?: (html: string) => Promise<Buffer>
  now?: Date
}): Promise<BuilderQuoteOutcome> {
  const found = await runWithTakeoff(db, input.tenantId, input.runId)
  if (!found) return { ok: false, error: 'not_found' }
  const { run, takeoff } = found
  const takes = run.status === 'ready' || run.status === 'saved' || (run.status === 'needs_review' && input.acceptReview === true)
  if (!takes || !takeoff) return { ok: false, error: 'run_not_ready', status: run.status }
  const mapped = toRoofStructures(takeoff, input.options ?? {})
  if (mapped.unknown.length) return { ok: false, error: 'unknown_structures', ids: mapped.unknown }
  if (mapped.unpriced.length) return { ok: false, error: 'unpriceable', structures: mapped.unpriced }
  // The card gives the loadings, GST, the call-out minimum and the upgrade.
  const pricing = await loadTenantRoofingPricingContext(db, input.tenantId, 'roofing')
  if (!pricing) return { ok: false, error: 'no_rate_card' }
  const book = await db.from('pricing_book').select('overlays')
    .eq('id', pricing.authority.pricing_book_id).eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (book.error) throw new Error(`takeoff pricing book lookup failed: ${book.error.message}`)
  const overlays = (book.data as { overlays?: Record<string, unknown> | null } | null)?.overlays
  const priced = priceNewWork(mapped.structures, pricing.rateCard, newWorkRates(overlays?.[NEW_WORK_RATES_KEY]))
  if (!priced.ok) return priced
  const html = builderQuoteHtml({
    branding: await loadTenantBranding(db, input.tenantId, 'roofing'),
    builder: run.builder?.business ?? null,
    site: run.site_address,
    jobRef: run.job_ref,
    jobName: run.job_name,
    takeoff,
    date: input.now ?? new Date(),
    priced,
  })
  try {
    const pdf = await (input.render ?? ((page: string) => renderPdfFromHtml(page, { singlePage: false })))(html)
    return { ok: true, pdf, filename: `Builder quote ${run.job_ref ?? run.id.slice(0, 8)}.pdf` }
  } catch (error) {
    console.warn(JSON.stringify({ level: 'warn', event: 'takeoff_builder_quote_pdf_failed', run_id: run.id, cause: String(error).slice(0, 200) }))
    return { ok: false, error: 'pdf_unavailable' }
  }
}
