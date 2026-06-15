// Commercial-painting customer quote delivery — PURE helpers.
//
// The save-quote route owns the dispatch (via the shared dispatchQuoteWithPdf
// chokepoint, so the tender PDF rides as a best-effort MMS exactly like
// electrical/plumbing/solar). This module only builds the customer SMS body
// and normalises the tradie-typed mobile to E.164 — NO I/O, fully testable.

/** Format an AUD figure inc-GST, no cents (SMS reads cleaner). */
function aud(n: number): string {
  return `$${Math.round(n).toLocaleString('en-AU')}`
}

/**
 * Normalise a tradie-typed AU mobile to E.164 (+61…), or return null when it
 * doesn't look like a valid mobile — so we never dispatch to garbage.
 *
 * Accepts: "0412 345 678", "0412345678", "+61 412 345 678", "61412345678",
 * "412345678". A value already in +<8–15 digit> international form is passed
 * through (an overseas customer is rare but shouldn't be blocked).
 */
export function normaliseAuMobile(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/[^\d+]/g, '')
  if (!cleaned) return null

  if (cleaned.startsWith('+')) {
    if (/^\+614\d{8}$/.test(cleaned)) return cleaned // +61 4XXXXXXXX
    return /^\+\d{8,15}$/.test(cleaned) ? cleaned : null // generic E.164 passthrough
  }

  let national = cleaned
  if (national.startsWith('61')) national = national.slice(2)
  else if (national.startsWith('0')) national = national.slice(1)

  // AU mobile national significant number: 4XXXXXXXX (leading 4, 9 digits).
  return /^4\d{8}$/.test(national) ? `+61${national}` : null
}

/**
 * PURE — the customer-facing commercial-painting quote SMS body. The tender
 * PDF rides as a best-effort MMS via dispatchQuoteWithPdf; this body always
 * carries the durable quote-page link and (when a PDF was produced) its
 * download link, so the customer can still reach the quote even when the
 * carrier drops the MMS (AU long codes routinely do).
 */
export function buildPaintCustomerSms(args: {
  businessName: string
  customerName?: string | null
  jobName?: string | null
  totalIncGst: number
  quoteUrl: string
  pdfUrl?: string | null
}): string {
  const hi = args.customerName ? `Hi ${args.customerName}, ` : 'Hi, '
  const job = args.jobName ? ` for ${args.jobName}` : ''
  const pdf = args.pdfUrl ? ` · PDF copy: ${args.pdfUrl}` : ''
  return (
    `${hi}your painting quote from ${args.businessName}${job} is ready: ` +
    `${aud(args.totalIncGst)} inc GST. ` +
    `View the full quote: ${args.quoteUrl}${pdf} — reply to confirm.`
  )
}
