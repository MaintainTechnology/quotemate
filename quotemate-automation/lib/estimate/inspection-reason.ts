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

// ─────────────────────────────────────────────────────────────────────────
// R5 — CLOSED ENUM of customer-facing inspection reasons.
//
// The reason a customer sees when a job routes to the $99 inspection is ALWAYS
// one of these pre-written strings. The model's free-form reason is used ONLY
// to *select* which one (by keyword) — it is never shown verbatim. This makes
// the customer-facing copy un-foolable: no invented price, no sensationalism,
// no off-brand wording can reach the customer even if the sanitiser misses it.
// ─────────────────────────────────────────────────────────────────────────

export const INSPECTION_REASONS = {
  generic: SAFE_INSPECTION_REASON,
  access:
    'A site visit is needed to confirm access and scope before we can quote this accurately.',
  switchboard:
    'Switchboard or mains work needs an on-site assessment before we can quote it.',
  safety:
    'A licensed on-site inspection is required for safety and compliance before we can quote.',
  hot_water:
    'We need to confirm the hot water system type and location on-site before quoting.',
  drainage:
    'A drainage issue like this needs an on-site or camera check before we can price the fix.',
  hidden_work:
    'This job may involve hidden or variable work, so an inspection is needed to quote it accurately.',
  out_of_scope:
    'This one is best sorted with a quick site visit rather than over text.',
} as const

export type InspectionReasonKey = keyof typeof INSPECTION_REASONS

// Keyword → enum mapping, most-specific first. Matched against the SANITISED
// reason text, so price/shout artefacts are already gone before we map.
const REASON_KEYWORDS: Array<[RegExp, InspectionReasonKey]> = [
  [/switchboard|mains|meter\b|three[-\s]?phase|rewire|\brcd\b|safety switch/i, 'switchboard'],
  [/asbestos|complian|licen[cs]|hazard|smoke[-\s]?alarm/i, 'safety'],
  [/hot[-\s]?water|\bhws\b|heat[-\s]?pump|gas (storage|hot)/i, 'hot_water'],
  [/drain|sewer|blockage|blocked|camera|cctv/i, 'drainage'],
  [/access|manhole|roof|cavity|raked|cathedral|sub[-\s]?floor/i, 'access'],
  [/out of scope|outside|too (big|complex)|renovat|commercial/i, 'out_of_scope'],
  [/hidden|variable|unknown|not sure|depends|inspect|assess/i, 'hidden_work'],
]

/**
 * R5 — resolve any raw/free-form inspection reason to a member of the closed
 * {@link INSPECTION_REASONS} set. Sanitises first (defence in depth), then maps
 * by keyword; falls back to the safe generic reason when nothing matches. The
 * return value is always one of the enum strings — never model free text.
 */
export function resolveInspectionReason(raw: unknown): string {
  const cleaned = sanitizeInspectionReason(raw)
  if (cleaned === SAFE_INSPECTION_REASON) return INSPECTION_REASONS.generic
  for (const [re, key] of REASON_KEYWORDS) {
    if (re.test(cleaned)) return INSPECTION_REASONS[key]
  }
  return INSPECTION_REASONS.generic
}
