// R13 — constrain the customer-facing `inspection_reason`.
//
// When a quote is downgraded to the $99 site inspection, `inspection_reason`
// is shown to the customer (quote SMS + quote page) and to the tradie. On the
// LLM self-report path it is free-form text the model wrote, so it can carry
// two problems we never want in front of a customer:
//   1. PRICE CLAIMS — an inspection quote has NO grounded price, so any "$X"
//      the model invents is, by definition, ungrounded. Strip them.
//   2. SENSATIONALISM — all-caps shouting / exclamation runs that alarm the
//      customer. Calm them.
//
// This is a pure, deterministic sanitiser (no I/O) so it is trivially testable
// and can run on every inspection path (LLM self-report AND the WP1 pricing-
// book fallback). It NEVER invents content — it only removes/neutralises — and
// falls back to a single safe default when nothing usable remains.

/** Customer-friendly fallback when the model's reason is empty or unusable. */
export const SAFE_INSPECTION_REASON =
  'A quick on-site inspection is needed to quote this job accurately.'

/** SMS-friendly cap — long enough to be specific, short enough not to bloat
 *  the quote SMS. The reason is one clause, not a paragraph. */
const MAX_LEN = 200

/**
 * Sanitise an inspection reason for customer display.
 * - strips dollar amounts and currency symbols (no price on a no-price quote)
 * - calms all-caps shouting and collapses exclamation/question runs
 * - collapses whitespace and tidies dangling punctuation
 * - length-caps on a word boundary
 * - falls back to {@link SAFE_INSPECTION_REASON} when empty/too short
 */
export function sanitizeInspectionReason(raw: unknown): string {
  let s = String(raw ?? '').trim()
  if (!s) return SAFE_INSPECTION_REASON

  // 1. Strip price claims in every shape:
  //    symbol-led ("$99", "AU$350", "AUD $1,200.50"),
  //    word-led   ("AUD 350", "AUD350"),
  //    word-trailed ("200 dollars", "500 aud", "10 bucks"),
  //    then any bare currency symbols left over.
  s = s
    .replace(/(?:AUD?|AU)?\s*[$£€]\s*\d[\d,]*(?:\.\d+)?/gi, '')
    .replace(/\bAUD?\s*\d[\d,]*(?:\.\d+)?\b/gi, '')
    .replace(/\d[\d,]*(?:\.\d+)?\s*(?:dollars?|aud|bucks)\b/gi, '')
    .replace(/[$£€]/g, '')

  // 2. Calm shouting: if the whole message is upper-case, sentence-case it.
  if (s === s.toUpperCase() && /[A-Z]/.test(s)) {
    s = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
  }

  // 3. Collapse exclamation/question runs and repeated punctuation.
  s = s
    .replace(/!+/g, '.')
    .replace(/\?{2,}/g, '?')
    .replace(/\.{2,}/g, '.')

  // 4. Tidy whitespace and punctuation spacing / dangling separators.
  s = s
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:?])/g, '$1')
    .replace(/[\s,;:–—-]+$/g, '')
    .replace(/^[\s,;:–—-]+/g, '')
    .trim()

  if (s.length < 8) return SAFE_INSPECTION_REASON

  // 5. Length cap on a word boundary.
  if (s.length > MAX_LEN) {
    s = s.slice(0, MAX_LEN).replace(/\s+\S*$/, '').trim()
    if (!/[.?]$/.test(s)) s += '…'
  }

  return s
}
