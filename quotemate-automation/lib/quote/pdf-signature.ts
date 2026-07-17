// Cache-signature helpers for the self-healing customer quote PDF (mig 146).
//
// Split out of lib/quote/pdf.ts so they stay pure + dependency-light: the PDF
// service pulls in Gotenberg, Supabase, and every trade's report builder, which
// a unit test shouldn't have to load. These two functions decide WHAT a cached
// PDF was rendered from and WHETHER it must be regenerated.

import type { QuoteTierMode, TierKey } from './tier-visibility'

/**
 * Cache signature for a quote PDF. Captures everything in the tenant's Pricing
 * settings that changes what the customer PDF renders: the report template
 * version, the resolved tier mode, the exact visible tier keys, and the
 * recommended tier. Stamped into quotes.pdf_signature at generation time and
 * recomputed on every download/send — a mismatch means the cached PDF is stale
 * (the tradie changed the tier mode, or the template was bumped) and must
 * regenerate. Tier PRICE edits change the quote content but not this signature,
 * so the edit path passes { regenerate: true }.
 */
export function quotePdfSignature(args: {
  templateVersion: number
  tierMode: QuoteTierMode
  visibleTierKeys: readonly TierKey[]
  recommendedTier: string | null
  /** Content hash of report_doc + report_style (hashReportContent). Omitted /
   *  empty for legacy quotes with no document → signature is byte-identical to
   *  the pre-Phase-0 format, so those cached PDFs are NOT force-regenerated. */
  docHash?: string | null
  /** Realised early-booking discount % (quotes.applied_discount_pct). The
   *  discount is stamped at BOOKING time — after the draft-time PDF was
   *  cached — so it must be part of the signature or the customer keeps
   *  downloading a full-price PDF (P7). Omitted/0 keeps the signature
   *  byte-identical to the pre-v7 format. */
  appliedDiscountPct?: number | null
}): string {
  let base = `v${args.templateVersion}|${args.tierMode}|t=${args.visibleTierKeys.join('+')}|r=${
    args.recommendedTier ?? ''
  }`
  const pct = args.appliedDiscountPct ?? 0
  if (pct > 0) base = `${base}|disc=${pct}`
  return args.docHash ? `${base}|d=${args.docHash}` : base
}

/**
 * Whether a cached quote PDF must be regenerated: no PDF yet, an explicit
 * regenerate request, or the stored signature no longer matches the freshly
 * computed one (mig 146 self-heal). A pre-mig146 cached PDF has a NULL stored
 * signature, which never equals a fresh one — so it regenerates on first access.
 */
export function quotePdfIsStale(args: {
  pdfPath: string | null
  storedSignature: string | null
  freshSignature: string
  regenerate?: boolean
}): boolean {
  if (args.regenerate) return true
  if (!args.pdfPath) return true
  return args.storedSignature !== args.freshSignature
}

/**
 * Stable content hash of a quote's document + style override, for the PDF cache
 * signature (§10.2). A tiny dependency-free FNV-1a over a key-sorted JSON string
 * so it stays edge-safe and pure (no node:crypto). Null document → '' (legacy
 * quotes keep their pre-Phase-0 signature — see quotePdfSignature.docHash).
 */
export function hashReportContent(reportDoc: unknown | null, reportStyle: unknown | null): string {
  if (reportDoc == null && reportStyle == null) return ''
  const json = stableStringify({ d: reportDoc ?? null, s: reportStyle ?? null })
  let h = 0x811c9dc5
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}
