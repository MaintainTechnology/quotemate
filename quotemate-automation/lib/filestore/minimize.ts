// PII-minimized KB renderings (spec 2026-06-19 tenant-file-store, R7).
//
// THE PRIVACY MECHANISM: this module produces the ONLY content ever uploaded
// to Gemini File Search. It builds server-generated markdown from a quote's or
// invoice's STRUCTURED data and deliberately excludes customer name / street
// address / phone / email. The full, unredacted customer PDF/image is archived
// to access-controlled Supabase Storage separately and is NEVER passed to the
// KB. See `lib/filestore/ingest-quote.ts` which enforces that only this
// markdown reaches `kbUploadDocument`.
//
// Two layers of protection:
//   1. Whitelist — only known non-PII structured fields are ever read.
//   2. Backstop scrub — any free-text field that slips through (e.g. a scope
//      note) is regex-scrubbed for emails and AU phone numbers.
// (Free-text names cannot be reliably stripped without NER, so PII lives only
// in dedicated fields the whitelist never reads.)
//
// Pure + deterministic — no I/O, unit-tested. `contentHash` is the sha256 of
// the final markdown and drives material-re-draft detection (R15).

import { createHash } from 'node:crypto'
import { incGst, type QuoteReportTier } from '@/lib/quote/report-html'
import type { ExtractedInvoice } from '@/lib/invoice/extract'
import { normalizeTradeForDoc } from './tenant-store-name'

export type MinimizedDoc = {
  /** The markdown actually uploaded to Gemini. */
  markdown: string
  /** UTF-8 bytes of `markdown` (what `addDocumentToTenantStore` uploads). */
  bytes: Uint8Array
  /** sha256(markdown) — change detector for material re-drafts. */
  contentHash: string
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// AU-ish phone: +61… or a leading 0 followed by 8–11 more digits with optional
// space/hyphen separators. Conservative — only matches phone-shaped runs.
const PHONE_RE = /(?:\+?61[\s-]?|0)\d(?:[\s-]?\d){7,10}/g

/** Backstop redaction for free-text fields. */
function scrub(text: string): string {
  if (!text) return ''
  return String(text).replace(EMAIL_RE, '[redacted-email]').replace(PHONE_RE, '[redacted-phone]')
}

/**
 * Redact known customer-name tokens (whole-word, case-insensitive) from free
 * text. The whitelist never emits a name field directly, but a customer name
 * can be typed into a free-text scope note ("spoke with John Smith about…").
 * We can't do general NER, but when a structured customer name IS on the row we
 * strip those exact tokens — closing the most common free-text name leak.
 */
function scrubNames(text: string, names: Array<string | null | undefined>): string {
  if (!text) return text
  const tokens = new Set<string>()
  for (const n of names) {
    for (const raw of String(n ?? '').split(/\s+/)) {
      const t = raw.replace(/[^A-Za-z'-]/g, '').trim()
      if (t.length >= 3) tokens.add(t)
    }
  }
  let out = text
  for (const t of tokens) {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`\\b${esc}\\b`, 'gi'), '[redacted-name]')
  }
  return out
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

function pack(markdown: string): MinimizedDoc {
  const clean = markdown.replace(/\n{3,}/g, '\n\n').trim() + '\n'
  return { markdown: clean, bytes: new TextEncoder().encode(clean), contentHash: sha256(clean) }
}

function fmtMoney(n: number | string): string {
  const v = typeof n === 'string' ? parseFloat(n) : n
  return Number.isFinite(v) ? `$${v}` : 'n/a'
}

/**
 * Build the PII-minimized markdown for a quote across any live trade. Reads
 * structured fields only (`good`/`better`/`best` tiers for electrical/plumbing,
 * or a generic `estimate` object for token-based trades). When `pricesHidden`
 * is true (a force-confirm / inspection-published variant), emits a price-free
 * rendering matching the published PDF.
 */
export function buildQuoteKbText(args: {
  quote: Record<string, unknown> & Record<string, any>
  trade: string
  pricesHidden?: boolean
}): MinimizedDoc {
  const { quote, trade, pricesHidden } = args
  const q = (quote ?? {}) as Record<string, any>
  const lines: string[] = ['# Quote summary', '']

  lines.push(`- Trade: ${normalizeTradeForDoc(trade)}`)
  const jobType = q.job_type ?? q.jobType ?? null
  if (jobType) lines.push(`- Job type: ${String(jobType).replace(/_/g, ' ')}`)
  // Suburb/state are retained per spec; street address is never read.
  const area = q.customer_suburb ?? q.suburb ?? q.state ?? null
  if (area) lines.push(`- Area: ${scrub(String(area))}`)
  const routing = q.routing_decision ?? q.routing?.decision ?? null
  if (routing) lines.push(`- Routing: ${routing}`)
  // Privacy backstop (spec R13): a price-hidden published quote must NEVER yield
  // a price-bearing KB doc. Hide prices when the caller says so OR when the
  // routing itself indicates an inspection/forced-confirm state — so a hook that
  // forgets to pass pricesHidden still can't leak prices for a flagged quote.
  const hide = !!pricesHidden || /inspection|forced/i.test(String(routing ?? ''))
  const timeframe = q.estimated_timeframe ?? q.estimatedTimeframe ?? null
  if (timeframe) lines.push(`- Estimated timeframe: ${scrub(String(timeframe))}`)

  const custNames = [q.customer?.name, q.caller?.name, q.customer_name, q.customer_full_name]
  const scope = q.scope_of_works ?? q.scopeOfWorks ?? q.scope ?? null
  if (scope) {
    lines.push('', '## Scope of works', scrubNames(scrub(String(scope)), custNames))
  }

  const tiers: Array<[string, QuoteReportTier]> = [
    ['Good', (q.good ?? null) as QuoteReportTier],
    ['Better', (q.better ?? null) as QuoteReportTier],
    ['Best', (q.best ?? null) as QuoteReportTier],
  ]
  if (tiers.some(([, t]) => t)) {
    lines.push('', '## Pricing tiers')
    for (const [name, tier] of tiers) {
      if (!tier) continue
      lines.push('', `### ${name}${tier.label ? ' — ' + scrub(String(tier.label)) : ''}`)
      if (hide) {
        lines.push('- Pricing withheld pending inspection')
      } else {
        lines.push(`- Total inc GST: $${incGst(tier.subtotal_ex_gst)}`)
        lines.push(`- Subtotal ex GST: ${fmtMoney(tier.subtotal_ex_gst)}`)
      }
      for (const li of tier.line_items ?? []) {
        const head = `- ${scrub(li.description)} ×${li.quantity} ${li.unit}`
        lines.push(hide ? head : `${head} — ${fmtMoney(li.total_ex_gst)} ex GST`)
      }
    }
  } else if (q.estimate && typeof q.estimate === 'object') {
    lines.push('', '## Estimate summary', ...summarizeEstimate(q.estimate, hide))
  }

  return pack(lines.join('\n'))
}

/** First numeric value found among the given keys on an object. */
function pickNum(obj: Record<string, any> | null | undefined, ...keys: string[]): number | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  for (const k of keys) if (typeof obj[k] === 'number') return obj[k]
  return undefined
}

/**
 * Defensive, whitelist-driven summary for the token-based trades. Their pricing
 * lives in different shapes — solar at `estimate.price.tiers[]` + `estimate.sizing`,
 * roofing at `quote.combined.tiers[]` + `quote.structures`, commercial-painting
 * at camelCase `bom.totalIncGst` + `bom.lines[]` — so this reads snake_case AND
 * camelCase keys, top-level and one level into common containers, plus any
 * tier/line array it can find. (Spec R7/R9: the KB doc must carry real
 * job/line-item/total data for every trade, not an empty stub.)
 */
function summarizeEstimate(est: Record<string, any>, pricesHidden: boolean): string[] {
  const out: string[] = []
  const containers = [est, est.price, est.economics, est.totals, est.summary, est.combined].filter(
    (c) => c && typeof c === 'object',
  )

  // Headline money — try inc-GST then ex-GST across snake + camel variants.
  const incVariants = ['total_inc_gst', 'totalIncGst', 'grand_total', 'grandTotal', 'net_inc_gst', 'netIncGst', 'total', 'price']
  const exVariants = ['total_ex_gst', 'totalExGst', 'subtotal_ex_gst', 'subtotalExGst', 'subtotal']
  for (const [label, variants] of [['total inc gst', incVariants], ['subtotal ex gst', exVariants]] as const) {
    for (const c of containers) {
      const v = pickNum(c, ...variants)
      if (typeof v === 'number') {
        out.push(`- ${label}: ${pricesHidden ? 'withheld' : fmtMoney(v)}`)
        break
      }
    }
  }

  // Pricing tiers — solar `price.tiers`, roofing `combined.tiers`, or `est.tiers`.
  const tierArr: any[] | null =
    (Array.isArray(est.price?.tiers) && est.price.tiers) ||
    (Array.isArray(est.combined?.tiers) && est.combined.tiers) ||
    (Array.isArray(est.tiers) && est.tiers) ||
    null
  if (tierArr && tierArr.length) {
    out.push('', '### Tiers')
    for (const t of tierArr.slice(0, 10)) {
      const label = scrub(String(t?.tier ?? t?.name ?? t?.label ?? 'tier'))
      const total = pickNum(t, 'net_inc_gst', 'netIncGst', 'inc_gst', 'incGst', 'total_inc_gst', 'totalIncGst', 'total', 'price')
      if (pricesHidden) out.push(`- ${label}: pricing withheld`)
      else if (typeof total === 'number') out.push(`- ${label}: ${fmtMoney(total)} inc GST`)
      else out.push(`- ${label}`)
    }
  }

  // Descriptive (non-price) numerics — top-level or under sizing/production/system.
  const descSources = [est, est.sizing, est.production, est.system].filter((c) => c && typeof c === 'object')
  const descKeys = [
    'system_size_kw', 'systemSizeKw', 'system_kw_dc', 'panel_count', 'panelCount',
    'annual_output_kwh', 'annualOutputKwh', 'area_sqm', 'areaSqm', 'roof_area_sqm', 'storeys',
  ]
  for (const k of descKeys) {
    for (const c of descSources) {
      if (typeof c[k] === 'number') {
        out.push(`- ${k.replace(/_/g, ' ')}: ${c[k]}`)
        break
      }
    }
  }
  if (Array.isArray(est.structures)) out.push(`- structures: ${est.structures.length}`)

  // Line items — snake_case, camelCase, `lines`, or nested under price.
  const items: any[] | null =
    est.line_items ?? est.lineItems ?? est.items ?? est.lines ?? est.price?.line_items ?? est.price?.lines ?? null
  if (Array.isArray(items) && items.length) {
    out.push('', '### Items')
    for (const it of items.slice(0, 100)) {
      const desc = scrub(String(it?.description ?? it?.name ?? it?.label ?? it?.item ?? 'item'))
      const amt = pickNum(it, 'total_ex_gst', 'totalExGst', 'total_inc_gst', 'totalIncGst', 'total', 'amount', 'price', 'lineTotal', 'incGst')
      out.push(pricesHidden || typeof amt !== 'number' ? `- ${desc}` : `- ${desc} — ${fmtMoney(amt)}`)
    }
  }

  if (!out.some((l) => l.startsWith('- '))) out.push('- (no structured pricing fields available)')
  return out
}

/**
 * Build the PII-minimized markdown for an invoice from the Opus-extracted
 * structured fields. Retains supplier scope / totals / quantity / suburb /
 * date; the extracted `customer_name` is deliberately NOT included.
 */
export function buildInvoiceKbText(args: { extraction: ExtractedInvoice }): MinimizedDoc {
  const e = (args.extraction ?? {}) as ExtractedInvoice
  const lines: string[] = ['# Invoice summary', '']
  if (e.job_type_guess) lines.push(`- Job type: ${String(e.job_type_guess).replace(/_/g, ' ')}`)
  if (typeof e.quantity === 'number') lines.push(`- Quantity: ${e.quantity}`)
  if (typeof e.total_inc_gst === 'number') lines.push(`- Total inc GST: ${fmtMoney(e.total_inc_gst)}`)
  if (e.customer_suburb) lines.push(`- Area: ${scrub(String(e.customer_suburb))}`)
  if (e.invoice_date) lines.push(`- Invoice date: ${e.invoice_date}`)
  if (e.scope_description) lines.push('', '## Scope', scrubNames(scrub(String(e.scope_description)), [e.customer_name]))
  // e.customer_name intentionally excluded (PII).
  return pack(lines.join('\n'))
}
