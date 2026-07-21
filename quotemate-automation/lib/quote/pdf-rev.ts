// Pure storage-path revision markers for the trade-native quote PDFs
// (solar / roofing / painting), split out of lib/quote/pdf.ts so they stay
// dependency-light and unit-testable (same rationale as pdf-signature.ts).
//
// Unlike the electrical/plumbing quotes-row PDF — which self-heals via a rich
// quotePdfSignature — the trade-native rows have no signature column, so the
// storage PATH itself encodes which template + content era a cached PDF came
// from. A cached PDF whose path doesn't contain the CURRENT rev regenerates
// once on its next download/send. Bumping a rev therefore regenerates every
// cached PDF of that trade exactly once.

// Solar base rev. Bumped WHENEVER buildSolarQuoteReportHtml's output changes in
// a way that should invalidate every cached solar PDF.
//   -v2 (2026-06-XX): rendered WITH the panels-after figure availability.
//   -v3 (2026-06-XX): solar detach & reinstate applied to replacement tiers.
export const SOLAR_PDF_REV = '-v3'

/**
 * RC-5 — a CONTENT-AWARE solar rev. The auto-release render freezes the PDF
 * before several enrichment sections exist (the roof-with-panels image, the
 * sun & shade heatmap, the felt roof-map thumbnail, the AI brief) — they are
 * produced by concurrent `after()` work that the render usually wins. Under the
 * old static `-v3` marker the frozen, section-less PDF was served forever to the
 * download / email / MMS channels while the live /q/solar page (a live read)
 * showed the sections — the exact cross-channel divergence.
 *
 * Folding that volatile state into the rev — exactly how ensurePaintingPdf folds
 * the after-image timestamp — means the first fetch after each asset lands sees
 * a rev the cached path no longer contains, regenerates once, and every channel
 * then serves the SAME enriched document. The default (nothing produced yet,
 * premium off) returns the bare rev, so existing cached PDFs are NOT
 * force-regenerated. Suffix characters are appended in a FIXED order so the same
 * state always yields the same rev. PURE — no I/O.
 */
export function solarPdfRev(
  row: {
    panels_image_status?: string | null
    panels_image_path?: string | null
    quote_variant?: string | null
    felt?: { thumbnail_url?: string | null } | null
    ai_brief?: unknown
    estimate?: { context?: { sun?: { flux_image_path?: string | null } | null } | null } | null
  },
  premiumEnabled: boolean,
): string {
  let suffix = ''
  // Same gate ensureSolarQuotePdf uses to embed the "roof with panels" figure.
  if (row.panels_image_status === 'ready' && row.panels_image_path) suffix += 'p'
  // Same gate for the sun & shade heatmap (fluxImageUrl).
  if (row.estimate?.context?.sun?.flux_image_path) suffix += 's'
  // Felt-variant-only sections — ignored on instant estimates (never rendered).
  if (row.quote_variant === 'felt') {
    if (row.felt?.thumbnail_url) suffix += 'f'
    if (row.ai_brief) suffix += 'b'
  }
  // The premium proposal (assumed values, STC cross-check) is flag-gated and
  // read live at render, so a flag flip must also re-key the cache.
  if (premiumEnabled) suffix += 'q'
  return suffix ? `${SOLAR_PDF_REV}-${suffix}` : SOLAR_PDF_REV
}
