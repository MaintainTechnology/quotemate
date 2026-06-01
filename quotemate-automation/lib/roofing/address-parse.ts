// ════════════════════════════════════════════════════════════════════
// Roofing — pure AU address-string parsing.
//
// The Geoscape Predictive (type-ahead) API returns each suggestion as a
// single formatted DISPLAY STRING — e.g. "670 LONDON RD, CHANDLER QLD
// 4155" — and does NOT break out structured `state` / `postcode` fields
// (confirmed by probe 2026-05-29 + the predictive.test.ts fixtures).
//
// That left the Roof Measure form with a bug: picking a Chandler-QLD
// suggestion never filled the State/Postcode inputs, so they sat at the
// defaults (NSW / placeholder 2750) — the QLD-address-but-NSW/2750
// mismatch the screenshot showed.
//
// This module derives state + postcode back OUT of the display string so
// the form fields can be auto-populated from the chosen address. PURE —
// no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

export const AU_STATES = [
  'NSW',
  'VIC',
  'QLD',
  'SA',
  'WA',
  'TAS',
  'ACT',
  'NT',
] as const

export type AuState = (typeof AU_STATES)[number]

export type StatePostcode = {
  state: AuState | null
  postcode: string | null
}

/** Full state names → canonical abbreviation. Abbreviations map to
 *  themselves so a single lookup table covers both spellings. Geoscape
 *  uses abbreviations today, but tolerating the full names costs little
 *  and guards against a provider that spells them out. */
const STATE_TOKENS: ReadonlyArray<readonly [string, AuState]> = [
  // Longer tokens first so "NEW SOUTH WALES" is matched before a bare
  // "WALES"-less fallback could ever interfere.
  ['AUSTRALIAN CAPITAL TERRITORY', 'ACT'],
  ['NORTHERN TERRITORY', 'NT'],
  ['NEW SOUTH WALES', 'NSW'],
  ['WESTERN AUSTRALIA', 'WA'],
  ['SOUTH AUSTRALIA', 'SA'],
  ['QUEENSLAND', 'QLD'],
  ['TASMANIA', 'TAS'],
  ['VICTORIA', 'VIC'],
  ['NSW', 'NSW'],
  ['QLD', 'QLD'],
  ['VIC', 'VIC'],
  ['TAS', 'TAS'],
  ['ACT', 'ACT'],
  ['NT', 'NT'],
  ['SA', 'SA'],
  ['WA', 'WA'],
]

/** Whether `s` is one of the eight AU state abbreviations. */
export function isAuState(s: string | null | undefined): s is AuState {
  return typeof s === 'string' && (AU_STATES as readonly string[]).includes(s)
}

/**
 * Find the AU state token in `upper` (an already-upper-cased string).
 * Returns the canonical abbreviation plus the index in `upper` at which
 * the matched token ENDS — callers use that to look for the postcode
 * that trails the state ("… QLD 4155").
 *
 * When the same string contains more than one state-like token, the
 * LAST occurrence wins: in a full address the state sits near the end,
 * right before the postcode, so the last match is the real one.
 */
export function extractState(upper: string): { state: AuState | null; endIndex: number } {
  let best: { state: AuState; startIndex: number; endIndex: number } | null = null
  for (const [token, canonical] of STATE_TOKENS) {
    // Word-boundary match so "SA" never fires inside "SALISBURY" and
    // "WA" never fires inside "WARWICK".
    const re = new RegExp(`\\b${token}\\b`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(upper)) !== null) {
      const startIndex = m.index
      // Latest-starting token wins — in a full address the state sits
      // at the end, right before the postcode.
      if (!best || startIndex > best.startIndex) {
        best = { state: canonical, startIndex, endIndex: startIndex + token.length }
      }
    }
  }
  return best ? { state: best.state, endIndex: best.endIndex } : { state: null, endIndex: -1 }
}

/**
 * Pull a 4-digit AU postcode out of `upper`. Preference order:
 *   1. The first 4-digit token that appears AFTER the state token —
 *      this is the canonical "… STATE POSTCODE" tail.
 *   2. Failing that, a 4-digit token anchored to the very end of the
 *      string (handles "… CHANDLER 4155" with no state present).
 *
 * Guarded so a leading street number (e.g. "1234 SMITH ST") is never
 * mistaken for a postcode: option 1 only looks past the state, and
 * option 2 only accepts an end-anchored token.
 */
export function extractPostcode(upper: string, stateEndIndex: number): string | null {
  if (stateEndIndex >= 0) {
    const tail = upper.slice(stateEndIndex)
    const m = tail.match(/\b(\d{4})\b/)
    if (m && isPlausiblePostcode(m[1])) return m[1]
  }
  const end = upper.match(/\b(\d{4})\s*$/)
  if (end && isPlausiblePostcode(end[1])) return end[1]
  return null
}

/** AU postcodes run 0200–9999. Anything below 0200 is not a real
 *  postcode (and is more likely a stray 4-digit number). */
function isPlausiblePostcode(code: string): boolean {
  if (!/^\d{4}$/.test(code)) return false
  return Number(code) >= 200
}

/**
 * Derive { state, postcode } from a formatted AU address string.
 * Returns nulls for anything it cannot confidently extract — callers
 * fall back to manual entry in that case.
 */
export function extractStatePostcode(text: string | null | undefined): StatePostcode {
  if (!text || typeof text !== 'string') return { state: null, postcode: null }
  const upper = text.toUpperCase()
  const { state, endIndex } = extractState(upper)
  const postcode = extractPostcode(upper, endIndex)
  return { state, postcode }
}
