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
}): string {
  return `v${args.templateVersion}|${args.tierMode}|t=${args.visibleTierKeys.join('+')}|r=${
    args.recommendedTier ?? ''
  }`
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
