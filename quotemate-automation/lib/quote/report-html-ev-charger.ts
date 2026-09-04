// ════════════════════════════════════════════════════════════════════
// The EV charger ESTIMATE document — spec specs/ev-charger-estimate-template.md
//
// A job_type-specific customer document for electrical `ev_charger` quotes
// ONLY. Selected in lib/quote/pdf.ts renderQuoteDocumentHtml when
// intake.job_type === 'ev_charger' AND intake.trade === 'electrical'; every
// other combination keeps the generic buildQuoteReportHtml output byte for byte
// (R1). Reproduces the section set of the source estimates (Appendix A of the
// spec) inside the shared white-label chrome, so the header block, fonts,
// palette and repeating footer are the ones every other trade PDF already uses
// (R2).
//
// Section order (R3): header · ESTIMATE + number · Prepared For / Site Address /
// Date / Valid Until · Scope of Work · Description of Works · Assumptions ·
// Inclusions · Exclusions · Optional Upgrades & Recommendations · phased
// line-item tables with Group Totals · Subtotal / GST / Total · Images ·
// Terms & Conditions. Every optional section is omitted HEADING AND ALL when it
// has no content — an empty section beats a padded one.
//
// PURE. No I/O, no Date.now(): the document date is input.generatedAt (itself
// quotes.created_at) so two renders of one quote are byte-identical (R1). Every
// caller-supplied string goes through esc(). Everything this document needs
// from the database — the estimate number, the customer's own phone, the
// assemblies' exclusions, the embedded images — is resolved by pdf.ts and
// passed in.
//
// Money: line items and the totals block are 2dp; every figure derives from the
// tier's own stored numbers through lib/quote/money.ts (R13). Nothing here
// invents a price — see the Optional Upgrades block, which carries the source
// documents' advisory copy with the dollar figures deliberately removed.
// ════════════════════════════════════════════════════════════════════

import {
  renderReportDocument,
  esc,
  aud2,
  brandingFromName,
  type TenantBranding,
} from '../pdf/report-chrome'
import { asMoneyNumber, totalIncGstCents, dollars } from './money'
import { clampDiscountPct } from './early-bird'

/** Body-template key folded into quotes.pdf_signature (R15). Bump on any change
 *  to this template's OUTPUT so cached EV PDFs — and only those — regenerate.
 *
 *  ev2 — the Images section now leads with the Gemini render of the charger in
 *  the customer's own photo (spec ev-charger-location-photo R12/R14). */
export const EV_ESTIMATE_TEMPLATE_KEY = 'ev2'

/** How long the printed estimate says its prices stand (R7). Presentational:
 *  derived at render, never stored, and it gates nothing in the funnel. */
export const EV_ESTIMATE_VALID_DAYS = 30

/** "EST-0534" — the source estimates' format, zero-padded to four digits and
 *  growing naturally beyond them. Lives here rather than in lib/quote/pdf.ts so
 *  the customer page can format the number without pulling the whole PDF
 *  service (Gotenberg, sharp, every trade's report builder) into its bundle. */
export function formatEstimateNumber(n: number): string {
  return `EST-${String(Math.max(0, Math.trunc(n))).padStart(4, '0')}`
}

export const EV_PHASE_1_TITLE = 'Switchboard and rough-in'
export const EV_PHASE_2_TITLE = 'Fit-off and commissioning'

/**
 * Whether this quote gets the EV estimate document (spec R1).
 *
 * Both strings must match exactly. `job_type` is nullable and falls back to
 * 'job' upstream, and plumbing shares the generic electrical branch — so a
 * looser test would quietly capture quotes this document was never designed
 * for. Everything else keeps the generic report, byte for byte.
 */
export function isEvChargerJob(
  jobType: string | null | undefined,
  trade: string | null | undefined,
): boolean {
  return jobType === 'ev_charger' && trade === 'electrical'
}

export type EvEstimateLineItem = {
  description: string
  quantity: number
  unit: string
  unit_price_ex_gst: number
  total_ex_gst: number
  /** "material:<uuid>" | "assembly:<uuid>" | "labour" | "tradie_manual" … */
  source?: string | null
  catalogue_id?: string | null
}

export type EvEstimateTier = {
  label: string
  subtotal_ex_gst: number | string
  line_items?: EvEstimateLineItem[]
} | null

export type EvEstimateUpsell = {
  name: string
  /** Finite ⇒ a catalogue row backed it and the price prints. Null/absent ⇒
   *  "quoted on site" — what lib/estimate/upsell-guard.ts writes (R10). */
  price_ex_gst?: number | null
}

export type EvEstimateImage = {
  /** data: URI (PDF) or absolute URL (live HTML preview). */
  src: string
  caption?: string | null
}

export type EvChargerEstimateInput = {
  businessName: string
  branding?: TenantBranding
  /** "EST-0534", or the 8-character quote reference when no number could be
   *  assigned (R5). Already formatted by the caller. */
  estimateRef: string
  customerName?: string | null
  customerEmail?: string | null
  /** The customer's OWN number for this thread — never a remembered one (R6). */
  customerPhone?: string | null
  siteAddress?: string | null
  scopeOfWorks?: string | null
  /** Bullets for "Description of Works" (R8), resolved by the caller. */
  descriptionOfWorks?: string[] | null
  assumptions?: string[] | null
  /** Omit to derive from the visible tiers' line items (R9). */
  inclusions?: string[] | null
  /** The priced assemblies' default_exclusions, loaded by the caller (R9). */
  exclusions?: string[] | null
  optionalUpsells?: EvEstimateUpsell[] | null
  images?: EvEstimateImage[] | null
  good: EvEstimateTier
  better: EvEstimateTier
  best: EvEstimateTier
  selectedTier?: 'good' | 'better' | 'best' | null
  appliedDiscountPct?: number | null
  /** pricing_book.gst_registered. Absent ⇒ treated as registered. */
  gstRegistered?: boolean | null
  quoteViewUrl?: string | null
  estimatedTimeframe?: string | null
  /** intakes.scope.specs.supplied_by — drives the charger-unit exclusion (R9). */
  suppliedBy?: 'tradie' | 'customer' | null
  /** Catalogue ids known to be EV charger UNITS, so the unit line lands in
   *  Phase 2 with its mounting rather than in the rough-in (R4). */
  chargerUnitIds?: string[] | null
  generatedAt?: Date
}

// ── Phase classification (R4) ───────────────────────────────────────────
//
// Derived at RENDER, never stored. app/api/quote/[id]/edit/route.ts validates
// tier line items with a Zod object that strips unknown keys and re-emits
// exactly six of them, so a `phase` written onto a line item would be destroyed
// the first time the tradie saved. Re-deriving from the description (plus the
// caller's charger-unit id set) survives every edit.

/**
 * Unambiguous fit-off work: terminating, testing, commissioning, verifying,
 * cleaning up, handing over, energising. A line saying any of these is Phase 2
 * whatever else it mentions — "Mount and terminate the charger, make off the
 * cable glands" is fit-off even though it names cable.
 */
const PHASE_2_STRONG_PATTERN =
  /\b(terminat|commission|test|verif|clean[\s-]?up|cleanup|hand[\s-]?over|handover|energis|energiz)/i

/**
 * "mount" on its own is ambiguous: it is the act of fixing the charger to the
 * wall, but it is ALSO a material descriptor — "25mm surface mount conduit",
 * "surface mount enclosure". Treated as fit-off only when the line does not
 * name rough-in containment.
 */
const PHASE_2_MOUNT_PATTERN = /\bmount/i

/** Rough-in containment. Its presence demotes a mount-only match back to
 *  Phase 1, so conduit never prints under "Fit-off and commissioning". */
const PHASE_1_CONTAINMENT_PATTERN =
  /\b(conduit|cable|duct|ducting|enclosure|tray|saddle|gland)/i

/**
 * Which phase a line item belongs to. Phase 2 covers fit-off and commissioning
 * — including the charger unit itself, which is fitted in the same visit as its
 * mounting. Phase 1 is everything else: protection devices, cable, conduit,
 * fittings, sundries and the rough-in labour.
 */
export function evChargerPhase(
  line: Pick<EvEstimateLineItem, 'description' | 'source' | 'catalogue_id'>,
  opts?: { chargerUnitIds?: string[] | null },
): 1 | 2 {
  const ids = opts?.chargerUnitIds ?? []
  if (ids.length > 0) {
    const refId = line.catalogue_id ?? sourceUuid(line.source)
    // The charger unit is fitted in the same visit as its mounting, and the
    // tenant's catalogue is the only authority on which line IS the unit.
    if (refId && ids.includes(refId)) return 2
  }
  const description = line.description ?? ''
  // An unambiguous fit-off verb settles it, whatever else the line names.
  if (PHASE_2_STRONG_PATTERN.test(description)) return 2
  // Otherwise "mount" counts as fit-off only when the line is not containment.
  if (PHASE_2_MOUNT_PATTERN.test(description)) {
    return PHASE_1_CONTAINMENT_PATTERN.test(description) ? 1 : 2
  }
  return 1
}

/** The uuid out of "material:<uuid>" / "assembly:<uuid>"; null for every other
 *  source form (labour, callout, tradie_manual, …). */
function sourceUuid(source?: string | null): string | null {
  if (!source) return null
  const m = /^(?:material|assembly):(.+)$/i.exec(source.trim())
  return m ? m[1].trim() : null
}

// ── Optional Upgrades advisory copy (R10) ───────────────────────────────
//
// The source estimates print "Single Phase Install: $360.00 + GST", "Three
// Phase Install: $580.00 + GST" and "an additional charge of $150 to $400".
// Those figures are NOT reproduced: no catalogue row backs any of them, so the
// grounding rule that every printed dollar derives from a priced row would be
// broken by construction (this is the exact class of line that caused the
// 2026-09-01 incident); "+ GST" contradicts inc-GST display; and a range
// contradicts the no-indicative-figures rule. The recommendation itself is
// worth printing, so it prints — priced on site.
//
// A tenant who stocks surge-protection devices gets real prices automatically:
// they arrive as catalogue-backed optional_upsells entries and render below.

export const EV_SURGE_PROTECTION_NOTE = {
  title: 'Surge protection option',
  body:
    'We highly recommend installing a Surge Protection Device (SPD) to safeguard your new ' +
    'electric vehicle, EV charger, and valuable household electronics against sudden voltage ' +
    'spikes. Power surges can occur from lightning strikes or grid fluctuations and can cause ' +
    'thousands of dollars in damage to sensitive electronics. Pricing depends on there being ' +
    'sufficient physical room in your existing switchboard to fit the device, and is confirmed ' +
    'at your site visit.',
}

export const EV_SWITCHBOARD_CAPACITY_NOTE = {
  title: 'Switchboard capacity note',
  body:
    'If your switchboard does not have a spare circuit position available, additional work is ' +
    'needed to create space or upgrade the board. This is confirmed at your site visit.',
}

// ── Terms & Conditions (R13) ────────────────────────────────────────────
//
// Three lines survive from the source estimates verbatim. Two are replaced
// because they describe a commercial model this platform does not run:
//   "A 50% deposit is required to commence work."  → electrical takes the flat
//     $99 refundable site visit and nothing else (strategy v20); every deposit
//     link 302s to it, so printing a deposit promises what the funnel refuses.
//   "All prices are in AUD and include GST."       → contradicts the ex-GST line
//     items printed directly above it, and is simply false for a tenant whose
//     pricing_book.gst_registered is off.

export function evEstimateTerms(gstRegistered: boolean): string[] {
  return [
    'This is an estimate, not a contract.',
    `Prices are valid for ${EV_ESTIMATE_VALID_DAYS} days from the date of this estimate.`,
    'Final price may vary based on actual work performed.',
    'A $99 refundable site visit fee confirms your booking and is credited toward your final quote.',
    gstRegistered
      ? 'All prices are in Australian dollars. Line items are shown ex GST; the total includes 10% GST.'
      : 'All prices are in Australian dollars and are not subject to GST.',
  ]
}

// ── Formatting helpers ──────────────────────────────────────────────────

/** "13 Aug 2026" — the source estimates' date format, en-AU. */
function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime())
  out.setDate(out.getDate() + days)
  return out
}

/** "10 METRE", "1.5 HOUR", "1 EACH" — quantity and unit in one cell (R3). */
function qtyCell(line: EvEstimateLineItem): string {
  const unit = (line.unit ?? '').trim().toUpperCase()
  const qty = asMoneyNumber(line.quantity)
  return unit ? `${qty} ${unit}` : `${qty}`
}

function dedupeStrings(items: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items) {
    const s = (raw ?? '').trim()
    if (!s) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

function bulletSection(heading: string, items: string[]): string {
  if (items.length === 0) return ''
  return `
  <h3 class="ev-sub">${esc(heading)}</h3>
  <ul class="bullets">${items.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`
}

function visibleTiers(
  input: EvChargerEstimateInput,
): Array<{ key: 'good' | 'better' | 'best'; tier: NonNullable<EvEstimateTier> }> {
  return (['good', 'better', 'best'] as const)
    .map((key) => ({ key, tier: input[key] }))
    .filter((t): t is { key: 'good' | 'better' | 'best'; tier: NonNullable<EvEstimateTier> } =>
      Boolean(t.tier),
    )
}

/** Every visible tier's line items, in tier order. */
function allLineItems(input: EvChargerEstimateInput): EvEstimateLineItem[] {
  return visibleTiers(input).flatMap((t) => t.tier.line_items ?? [])
}

/**
 * Inclusions, derived from what is actually priced (R9): one bullet per distinct
 * line-item description across the visible tiers. Nothing new is asked of the
 * model — the priced lines ARE the inclusions.
 */
export function deriveEvInclusions(input: EvChargerEstimateInput): string[] {
  if (input.inclusions) return dedupeStrings(input.inclusions)
  return dedupeStrings(allLineItems(input).map((li) => li.description))
}

/**
 * "Description of Works" bullets (R8), in priority order: what the customer
 * actually described, else the authored EV method this repo already ships
 * (lib/quote/job-method.ts, rendered on the quote page but never in a PDF
 * before), else the labour lines that were priced.
 *
 * Nothing is invented and no new model output is asked for: every bullet traces
 * to intake content, authored method text, or a priced line.
 */
export function deriveEvDescriptionOfWorks(args: {
  scopeDescription?: string | null
  methodSteps?: string[] | null
  lineItems?: EvEstimateLineItem[] | null
}): string[] {
  const described = splitSentences(args.scopeDescription)
  if (described.length > 0) return described
  const steps = dedupeStrings(args.methodSteps ?? [])
  if (steps.length > 0) return steps
  return dedupeStrings(
    (args.lineItems ?? [])
      .filter((li) => (li.unit ?? '').trim().toLowerCase() === 'hr')
      .map((li) => li.description),
  )
}

/** Sentence-split a free-text scope into bullets. Abbreviations are not worth
 *  a parser here: the split needs whitespace after the stop, so "approx. 6m"
 *  and "AS/NZS 3000." survive intact. */
function splitSentences(text?: string | null): string[] {
  const s = (text ?? '').trim()
  if (!s) return []
  return dedupeStrings(s.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map((part) => part.trim()))
}

/**
 * Exclusions (R9): the priced assemblies' own default_exclusions, resolved by
 * the caller, plus the charger unit when the customer is supplying it. An
 * assembly whose uuid a tradie edit stripped contributes nothing — the section
 * renders what survives, and is omitted when nothing does.
 */
export function deriveEvExclusions(input: EvChargerEstimateInput): string[] {
  const supplied =
    input.suppliedBy === 'customer' ? ['Supply of the EV charger unit itself.'] : []
  return dedupeStrings([...supplied, ...(input.exclusions ?? [])])
}

// ── Body sections ───────────────────────────────────────────────────────

/** One phase's table, with its Group Total (R4). */
function phaseTable(title: string, items: EvEstimateLineItem[]): string {
  if (items.length === 0) return ''
  const groupTotal = items.reduce((sum, li) => sum + asMoneyNumber(li.total_ex_gst), 0)
  const rows = items
    .map(
      (li) => `
      <tr>
        <td>${esc(li.description)}</td>
        <td class="num">${esc(qtyCell(li))}</td>
        <td class="num">${aud2(asMoneyNumber(li.unit_price_ex_gst))}</td>
        <td class="num">${aud2(asMoneyNumber(li.total_ex_gst))}</td>
      </tr>`,
    )
    .join('')
  return `
  <section class="part ev-phase">
    <h3 class="ev-phase-title">${esc(title)}</h3>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="num">Qty</th>
          <th class="num">Rate</th>
          <th class="num">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr class="ev-group-total">
          <td colspan="3" class="num">Group Total:</td>
          <td class="num">${aud2(groupTotal)}</td>
        </tr>
      </tfoot>
    </table>
  </section>`
}

/**
 * The Subtotal / GST / Total block (R13). Every figure comes from
 * lib/quote/money.ts and the three rows always reconcile: the GST row is the
 * difference between the total and the ex-GST base, so Subtotal + GST = Total
 * exactly (the source estimates read the same way). A tenant who is not GST
 * registered gets no GST row and a total equal to the subtotal — never a fixed
 * 10% line.
 */
function totalsBlock(
  tier: NonNullable<EvEstimateTier>,
  money: { discountPct?: number | null; gstRegistered?: boolean | null },
): string {
  const gstRegistered = money.gstRegistered ?? true
  const pct = clampDiscountPct(money.discountPct)
  const rawEx = asMoneyNumber(tier.subtotal_ex_gst)
  // The ex-GST base actually being charged. Identical to subtotal_ex_gst for
  // electrical, whose early-booking discount has been unreachable since v20;
  // discounting it here keeps the three rows reconciling if that ever changes.
  const exBase = pct > 0 ? Math.round(rawEx * (1 - pct / 100) * 100) / 100 : rawEx
  const totalCents = totalIncGstCents(rawEx, {
    discountPct: pct,
    gstRegistered,
  })
  const total = totalCents / 100
  const gstAmount = total - exBase
  const rows = [
    `<tr><td class="ev-total-label">Subtotal (ex GST):</td><td class="num">${aud2(exBase)}</td></tr>`,
    gstRegistered
      ? `<tr><td class="ev-total-label">GST (10%):</td><td class="num">${aud2(gstAmount)}</td></tr>`
      : '',
    `<tr class="ev-grand"><td class="ev-total-label">Total:</td><td class="num">${aud2(total)}</td></tr>`,
  ]
    .filter(Boolean)
    .join('')
  return `
  <table class="ev-totals">
    <tbody>${rows}</tbody>
  </table>`
}

/** One tier: its phased tables and its totals. Tier arity is untouched — every
 *  tier resolveVisibleTiers surfaced is rendered under its own label (R13). */
function tierBlock(
  input: EvChargerEstimateInput,
  entry: { key: 'good' | 'better' | 'best'; tier: NonNullable<EvEstimateTier> },
  showLabel: boolean,
): string {
  const items = entry.tier.line_items ?? []
  const opts = { chargerUnitIds: input.chargerUnitIds }
  const phase1 = items.filter((li) => evChargerPhase(li, opts) === 1)
  const phase2 = items.filter((li) => evChargerPhase(li, opts) === 2)
  // One populated phase ⇒ a single table still numbered "Phase 1", matching the
  // single-phase source estimate (R4).
  const tables =
    phase1.length > 0 && phase2.length > 0
      ? phaseTable(`Phase 1 - ${EV_PHASE_1_TITLE}`, phase1) +
        phaseTable(`Phase 2 - ${EV_PHASE_2_TITLE}`, phase2)
      : phaseTable(
          `Phase 1 - ${phase2.length > 0 ? EV_PHASE_2_TITLE : EV_PHASE_1_TITLE}`,
          phase1.length > 0 ? phase1 : phase2,
        )
  const heading = showLabel
    ? `<h2 class="ev-tier-heading">${esc(entry.tier.label || entry.key)}${
        input.selectedTier === entry.key ? ' <span class="chip">Recommended</span>' : ''
      }</h2>`
    : ''
  return `${heading}${tables}${totalsBlock(entry.tier, {
    discountPct: input.appliedDiscountPct,
    gstRegistered: input.gstRegistered,
  })}`
}

function optionalUpgradesSection(input: EvChargerEstimateInput): string {
  const upsells = (input.optionalUpsells ?? []).filter((u) => (u?.name ?? '').trim())
  const notes = [EV_SURGE_PROTECTION_NOTE, EV_SWITCHBOARD_CAPACITY_NOTE]
  const noteHtml = notes
    .map(
      (n) => `
    <div class="ev-upgrade">
      <div class="ev-upgrade-title">${esc(n.title)}</div>
      <p class="note">${esc(n.body)}</p>
    </div>`,
    )
    .join('')
  const upsellHtml = upsells.length
    ? `<ul class="bullets">${upsells
        .map((u) => {
          const price = u.price_ex_gst
          // A price prints ONLY when a catalogue row produced one. Anything else
          // is quoted on site — never a figure this template invented (R10).
          const priced =
            typeof price === 'number' && Number.isFinite(price)
              ? `$${dollars(
                  totalIncGstCents(price, { gstRegistered: input.gstRegistered }),
                ).toLocaleString('en-AU')} inc GST`
              : 'quoted on site'
          return `<li>${esc(u.name.trim())} — <span class="ev-upsell-price">${esc(priced)}</span></li>`
        })
        .join('')}</ul>`
    : ''
  return `
  <h2>Optional Upgrades &amp; Recommendations</h2>
  ${noteHtml}
  ${upsellHtml}`
}

function imagesSection(images: EvEstimateImage[]): string {
  if (images.length === 0) return ''
  return `
  <h2>Images</h2>
  <div class="ev-images">${images
    .map(
      (img) => `
    <figure class="figure ev-image">
      <img src="${esc(img.src)}" alt="${esc(img.caption ?? 'Job image')}">
      ${img.caption ? `<figcaption>${esc(img.caption)}</figcaption>` : ''}
    </figure>`,
    )
    .join('')}</div>`
}

/** The two-column Prepared For / Proposal Details block that replaces the
 *  chrome's flat sub-line (R2/R3/R6/R7). Omits any line with no value, and the
 *  whole Prepared For column when nothing at all is known. */
function introMeta(input: EvChargerEstimateInput, issued: Date): string {
  const preparedLines = dedupeStrings([
    input.customerEmail,
    input.customerPhone,
  ]).map((s) => `<div class="ev-meta-line">${esc(s)}</div>`)
  const name = (input.customerName ?? '').trim()
  const preparedFor =
    name || preparedLines.length
      ? `
    <div class="ev-meta-col">
      <div class="ev-meta-label">Prepared For:</div>
      ${name ? `<div class="ev-meta-name">${esc(name)}</div>` : ''}
      ${preparedLines.join('')}
      ${
        input.siteAddress
          ? `<div class="ev-meta-label ev-meta-label-sub">Site Address</div>
             <div class="ev-meta-line">${esc(input.siteAddress)}</div>`
          : ''
      }
    </div>`
      : ''
  const details = `
    <div class="ev-meta-col ev-meta-col-right">
      <div class="ev-meta-label">Proposal Details:</div>
      <div class="ev-meta-line"><strong>Date:</strong> ${esc(fmtDate(issued))}</div>
      <div class="ev-meta-line"><strong>Valid Until:</strong> ${esc(
        fmtDate(addDays(issued, EV_ESTIMATE_VALID_DAYS)),
      )}</div>
      ${
        input.estimatedTimeframe
          ? `<div class="ev-meta-line"><strong>Est. timeframe:</strong> ${esc(
              input.estimatedTimeframe,
            )}</div>`
          : ''
      }
    </div>`
  return `<div class="ev-meta">${preparedFor}${details}</div>`
}

/** EV-only styling, contributed through the body slot so the shared chrome
 *  needs no new CSS file (R2). Tokens only — no new colours. */
const EV_STYLE = `
<style>
  .ev-meta{ display:flex; justify-content:space-between; gap:24px; margin-top:10px; }
  .ev-meta-col{ font-size:11px; color:var(--sec); }
  .ev-meta-col-right{ text-align:right; }
  .ev-meta-label{ font-family:'JetBrains Mono','Courier New',monospace; font-size:9px;
    letter-spacing:0.16em; text-transform:uppercase; color:var(--pri); font-weight:600;
    margin-bottom:3px; }
  .ev-meta-label-sub{ margin-top:8px; }
  .ev-meta-name{ font-weight:800; color:var(--pri); font-size:12px; }
  .ev-meta-line{ margin-top:1px; }
  .ev-meta-line strong{ color:var(--pri); }
  .ev-sub{ font-size:11.5px; font-weight:800; text-transform:uppercase;
    letter-spacing:0.02em; color:var(--pri); margin:14px 0 4px; }
  .ev-scope{ color:var(--sec); margin:6px 0 0; }
  .ev-upgrade{ margin-top:10px; }
  .ev-upgrade-title{ font-family:'JetBrains Mono','Courier New',monospace; font-size:9px;
    letter-spacing:0.16em; text-transform:uppercase; color:var(--pri); font-weight:600; }
  .ev-upsell-price{ font-family:'JetBrains Mono','Courier New',monospace;
    font-variant-numeric:tabular-nums; }
  .ev-tier-heading{ margin-top:22px; }
  .ev-phase{ padding:12px 14px; }
  .ev-phase-title{ font-size:12px; font-weight:800; text-transform:uppercase;
    letter-spacing:-0.01em; margin:0; color:var(--pri); }
  .ev-phase table{ margin-top:6px; }
  .ev-phase td.num, .ev-phase th.num, .ev-totals td.num{
    font-family:'JetBrains Mono','Courier New',monospace; font-variant-numeric:tabular-nums; }
  .ev-group-total td{ border-bottom:none; border-top:2px solid var(--pri);
    font-weight:800; padding-top:7px; }
  .ev-totals{ width:auto; min-width:280px; margin:12px 0 0 auto; }
  .ev-totals td{ border-bottom:1px solid var(--line); padding:5px 6px; }
  .ev-totals .ev-total-label{ color:var(--sec); }
  .ev-totals .ev-grand td{ border-bottom:none; border-top:2px solid var(--pri);
    font-weight:800; font-size:14px; color:var(--pri); padding-top:8px; }
  .ev-images{ display:flex; flex-wrap:wrap; gap:12px; }
  .ev-image{ flex:1 1 200px; max-width:280px; margin:8px 0 0; }
  .ev-image img{ max-height:240px; }
  .ev-terms{ margin-top:22px; }
</style>`

/**
 * The EV charger estimate, as one self-contained HTML document.
 *
 * Pure and deterministic: with a fixed `generatedAt`, two calls return
 * identical strings.
 */
export function buildEvChargerEstimateHtml(input: EvChargerEstimateInput): string {
  const issued = input.generatedAt ?? new Date(0)
  const branding = input.branding ?? brandingFromName(input.businessName)
  const gstRegistered = input.gstRegistered ?? true
  const tiers = visibleTiers(input)
  const showTierLabels = tiers.length > 1

  const description = dedupeStrings(input.descriptionOfWorks ?? [])
  const assumptions = dedupeStrings(input.assumptions ?? [])
  const inclusions = deriveEvInclusions(input)
  const exclusions = deriveEvExclusions(input)
  const images = (input.images ?? []).filter((i) => (i?.src ?? '').trim())

  const scopeLead = (input.scopeOfWorks ?? '').trim()

  const body = `
${EV_STYLE}
  <h2>Scope of Work</h2>
  ${scopeLead ? `<p class="ev-scope">${esc(scopeLead)}</p>` : ''}
  ${bulletSection('Description of Works', description)}
  ${bulletSection('Assumptions', assumptions)}
  ${bulletSection('Inclusions', inclusions)}
  ${bulletSection('Exclusions', exclusions)}
  ${optionalUpgradesSection(input)}
  ${tiers.map((entry) => tierBlock(input, entry, showTierLabels)).join('')}
  ${imagesSection(images)}
  <div class="ev-terms">
    <h2>Terms &amp; Conditions</h2>
    <ul class="bullets">${evEstimateTerms(gstRegistered)
      .map((t) => `<li>${esc(t)}</li>`)
      .join('')}</ul>
  </div>`

  return renderReportDocument(branding, {
    docTitle: `Estimate ${input.estimateRef} — ${branding.businessName}`,
    titleText: 'ESTIMATE',
    eyebrow: input.estimateRef,
    introMetaHtml: introMeta(input, issued),
    dateLabel: fmtDate(issued),
    bodyHtml: body,
    closingLine: input.quoteViewUrl
      ? `View and accept this estimate online: ${input.quoteViewUrl}`
      : null,
    footerPriceNote: gstRegistered ? 'Prices include GST' : 'Prices are not subject to GST',
  })
}
