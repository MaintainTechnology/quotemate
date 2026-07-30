// Resolve a legacy category that a one-to-one rename cannot, by reading the
// product's own name.
//
// scripts/fix-material-categories.mjs refuses to guess when an old value maps to
// several real ones: `hot_water` could be any of three hws_* values, `tap` any
// of four tapware_*. Guessing would put a $1,845 gas unit's price on an electric
// job.
//
// But it is not really a guess. "Rheem 5-star 260L gas storage HWS" is not
// ambiguous to a plumber, and the name is right there on the row. This module
// reads the evidence the row already carries.
//
// Conservative by design: no clear evidence → null → the row is left alone and
// still reported for a human. Silence is the correct answer more often than a
// plausible-looking category.

const HWS_RULES: Array<{ re: RegExp; category: string }> = [
  // Heat pump FIRST: a heat pump is electric, so an "electric" rule would
  // otherwise swallow it and file a $4k unit as a $1.4k storage tank.
  { re: /heat[\s-]?pump/i, category: 'hws_heat_pump' },
  { re: /\bgas\b|\blpg\b|\bng\b/i, category: 'hws_gas' },
  { re: /\belectric\b|\bresistive\b/i, category: 'hws_electric' },
]

const TAP_RULES: Array<{ re: RegExp; category: string }> = [
  { re: /\bgarden\b|\boutdoor\b|\bhose\b|\bbibcock\b/i, category: 'tapware_outdoor' },
  { re: /\bkitchen\b|\bsink\b/i, category: 'tapware_kitchen' },
  { re: /\blaundry\b|\btrough\b/i, category: 'tapware_laundry' },
  { re: /\bbasin\b|\bvanity\b|\bbathroom\b/i, category: 'tapware_basin' },
]

/** Old category → the rules that can disambiguate it from a product name. */
const RULES: Record<string, Array<{ re: RegExp; category: string }>> = {
  hot_water: HWS_RULES,
  tap: TAP_RULES,
}

/**
 * The real material category this product belongs in, read from its name — or
 * `null` when the name does not say.
 *
 * Only handles the categories in RULES. Anything else (a value that is already
 * valid, or an orphan like `cctv` with no material row at all) returns null:
 * this function's job is disambiguation, not invention.
 */
export function resolveByProductName(
  oldCategory: string | null | undefined,
  productName: string | null | undefined,
  _trade?: string | null,
): string | null {
  const key = (oldCategory ?? '').trim().toLowerCase()
  const rules = RULES[key]
  if (!rules) return null

  const name = (productName ?? '').trim()
  if (!name) return null

  for (const { re, category } of rules) {
    if (re.test(name)) return category
  }
  return null
}
