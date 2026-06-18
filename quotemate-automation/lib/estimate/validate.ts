// Database-grounding validator — runs after Opus emits a draft quote and
// before the quote is persisted. Walks every line_item and verifies that
// its unit_price_ex_gst is traceable to a real DB row × pricing_book
// derivation AND that the line description and the source row are in
// the same product category (downlights, GPOs, smoke alarms, etc).
//
// If any line item fails, the route handler downgrades the entire quote
// to inspection-required: tiers wiped to null, $99 site-visit fee becomes
// the only chargeable amount, customer is told "pricing not yet available".
//
// This is the fourth and last layer of defence against fabricated prices,
// on top of:
//   1. STRICT GROUNDING in the system prompt
//   2. NON-NEGOTIABLE RULES in the system prompt
//   3. Route-level forced null tiers when needs_inspection is true
//   4. THIS validator — the only deterministic, machine-checkable layer
//
// Updated 2026-05-06: previous version checked that the price existed in
// the DB but did not verify the SEMANTIC match between the line text and
// the source row. That allowed bugs like a "smoke alarm" line being
// priced from a "downlight" row at the same dollar amount × different
// markup. Now we require category overlap as well.

// Grounding categories are the SINGLE SOURCE OF TRUTH in ./categories
// (also consumed by the custom-service Zod schema + the dashboard form).
// Re-exported so existing `import { type Category } from './validate'`
// callers keep working unchanged.
import { isCategory, type Category } from './categories'
export type { Category } from './categories'

export type PricingBookForValidation = {
  hourly_rate: number | string
  apprentice_rate: number | string
  /** Optional senior tradie rate — when set, the validator accepts it as
   *  a valid labour price alongside hourly_rate + apprentice_rate. Without
   *  this, Opus-picked senior-tier labour silently fails grounding. */
  senior_rate?: number | string | null
  call_out_minimum: number | string
  default_markup_pct: number | string
  /** Minimum labour hours per priced tier — enforces "small job allowance".
   *  Optional for back-compat; defaults to 2.0 if not provided. */
  min_labour_hours?: number | string
  /** P-1 (2026-05-25) — after-hours multiplier. When set, the validator
   *  ALSO accepts `hourly_rate × after_hours_multiplier` as a valid labour
   *  rate AND `call_out_minimum × after_hours_multiplier` as a valid call-out
   *  rate — but ONLY when the line's source or description marks it as
   *  after-hours, so a standard-hours quote at the inflated rate still
   *  fails grounding. */
  after_hours_multiplier?: number | string | null
}

export type GroundingFailure = {
  tier: 'good' | 'better' | 'best'
  lineIndex: number
  description: string
  unit: string
  unit_price_ex_gst: number
  expected: string
}

export type GroundingResult =
  | { valid: true }
  | { valid: false; failures: GroundingFailure[] }

/** A categorised candidate price — one entry per DB row × markup variant. */
export type CandidatePrice = {
  /** Marked-up dollar amount that a line item could legitimately quote. */
  price: number
  /** The original row's name, e.g. "Tri-colour LED downlight". */
  sourceName: string
  /** Category tags extracted from the source name. */
  categories: Set<Category>
  /** R-1 (2026-05-25) — optional DB row id. When set, a line whose
   *  `source` field is `"material:<id>"` or `"assembly:<id>"` triggers
   *  STRICT row-id grounding: the validator looks up the row by id and
   *  requires the line price to match THAT row's price (raw or × default
   *  markup) — no category fallback, no markup drift band. Lines without
   *  a UUID in source fall back to the loose price + category match. */
  sourceId?: string | null
}

export type CandidatePrices = {
  material: CandidatePrice[]
  assembly: CandidatePrice[]
}

/** Tolerance in dollars — Stripe stores cents; markups round; allow ±$0.50 */
const PRICE_TOLERANCE = 0.5

function n(v: number | string): number {
  return typeof v === 'string' ? parseFloat(v) : v
}

// ─────────────────────────────────────────────────────────────────
// Category extraction — keyword tags applied to both candidate rows
// and line descriptions. Validation passes only when at least one
// tag appears on both sides.
// ─────────────────────────────────────────────────────────────────

// `Category` is imported + re-exported from ./categories above — that
// array is the single source of truth (validator + Zod schema + form).
// To add a category, add ONE line there; categorise() below then needs a
// matching keyword regex (and a collision-guard test) for the LINE side.

/** Extract category tags from arbitrary product-name or line-description text. */
export function categorise(text: string): Set<Category> {
  const t = (text ?? '').toLowerCase()
  const cats = new Set<Category>()

  // ── Electrical ──────────────────────────────────────────────────
  // Outdoor first — "outdoor IP-rated LED light" must beat the bare-LED rule.
  // Floodlights / security-sensor lights are unambiguously outdoor — fold
  // them into outdoor_light so "Install motion sensor flood light" (mig
  // 021) and the line Opus writes for it share a tag.
  if (/\b(outdoor|exterior|deck|weatherproof|ip[-\s]?rated|garden|patio|wall\s*pack|flood\s*light|floodlight)\b/.test(t)) {
    cats.add('outdoor_light')
  }
  if (/\bdownlight/.test(t)) cats.add('downlight')
  if (/\b(gpo|power\s*point|socket|wall\s*outlet|\busb\s*out)/.test(t)) cats.add('gpo')
  // smoke_alarm: "smoke alarm" / "interconnected alarm" / "240V alarm" /
  // "hardwire ... alarm" / "alarm install" / "alarm replacement" — broader
  // pattern so Opus's "Install kit ... terminate each alarm" line lands in
  // the smoke_alarm bucket (caught in 2026-05-15 E4 stress test where the
  // line was mis-categorised as [general] and the matching $40.80 row
  // existed only in [smoke_alarm], causing all 3 tiers to fail grounding).
  if (/\bsmoke\s*alarm|\binterconnect(?:ed)?\s+alarm|\b240v\s*alarm|\bhardwire[ds]?\b.*\balarm|\balarm\s+(?:install|replace|terminate|hardwire|kit)/.test(t)) cats.add('smoke_alarm')
  if (/\b(ceiling\s*fan|\bfan\b)/.test(t)) cats.add('fan')
  if (/\b(rcbo|safety\s*switch|safety\s*breaker|circuit\s*breaker)\b/.test(t)) cats.add('rcbo')
  if (/\b(oven|cooktop|stove|range\s*hood)\b/.test(t)) cats.add('oven_cooktop')
  if (/\b(ev\s*charger|electric\s*vehicle|wallbox)\b/.test(t)) cats.add('ev_charger')
  if (/\b(switchboard|switch\s*board|main\s*board|distribution\s*board)\b/.test(t)) {
    cats.add('switchboard')
  }
  // ── Electrical catalogue extras (migration 021) — tight keywords so
  //    they can't false-match an existing category. ─────────────────
  if (/\b(fault[-\s]?find(?:ing)?|diagnostic|diagnose)\b/.test(t)) cats.add('fault_find')
  if (/\b(led\s*strip|strip\s*light(?:ing)?|cove\s*light(?:ing)?)\b/.test(t)) cats.add('strip_light')
  // security/surveillance camera — deliberately NOT bare "cctv" (that is
  // the plumbing drain-camera tag below; keeping them distinct stops an
  // electrical camera price grounding a plumbing CCTV line).
  if (/\b(security\s*camera|surveillance\s*camera|cctv\s*camera)\b/.test(t)) cats.add('security_camera')
  if (/\b(doorbell|door\s*bell|intercom)\b/.test(t)) cats.add('doorbell_intercom')

  // ── Plumbing (v5) ───────────────────────────────────────────────
  // CCTV first — "CCTV drain inspection" must beat the bare-drain rule.
  if (/\b(cctv|drain[-\s]?camera|camera\s*inspection)/.test(t)) cats.add('cctv')
  if (/\b(drain|blockage|blocked\s*pipe|jet[-\s]?blast(?:ing)?|hand[-\s]?rod(?:ding)?|jet[-\s]?clear)/.test(t)) {
    cats.add('drain')
  }
  if (/\b(hot\s*water|\bhws\b|heat\s*pump|continuous[-\s]?flow|storage\s*tank|water\s*heater)/.test(t)) {
    cats.add('hot_water')
  }
  if (/\b(tap[s]?\b|mixer|tap\s*washer|faucet|spout)/.test(t)) cats.add('tap')
  if (/\b(toilet|cistern|close[-\s]?coupled|wall[-\s]?faced|in[-\s]?wall\s*cistern|flush\s*valve|fill\s*valve)/.test(t)) {
    cats.add('toilet')
  }
  if (/\b(gas\s*(?:appliance|leak|fitting|cooktop|oven|line|supply|pipe|connection)|gas[-\s]?bayonet|\blpg\b)\b/.test(t)) {
    cats.add('gas')
  }
  if (/\b(pressure[-\s]?reduction\s*valve|\bprv\b|pressure\s*valve)/.test(t)) cats.add('prv')
  // ── Plumbing catalogue extras (migration 021) — tight keywords. ──
  if (/\bdish\s*washer\b/.test(t)) cats.add('dishwasher')
  if (/\b(rain\s*water\s*tank|rainwater\s*tank)\b/.test(t)) cats.add('rainwater_tank')
  if (/\b(water\s*filter|filtration|whole[-\s]?house\s*(?:water\s*)?filter)\b/.test(t)) {
    cats.add('water_filter')
  }
  // leak DETECTION only — "gas leak" stays in the gas tag above, never here.
  if (/\bleak\s*detect(?:ion|or)?\b/.test(t)) cats.add('leak_detection')
  if (/\b(shower\s*head|showerhead|shower\s*rose)\b/.test(t)) cats.add('shower')

  // ── Shared sundries (both trades) ───────────────────────────────
  if (/\b(sundries|sundry|terminals|consumables|miscellaneous|extras|disposal|removal\s*of\s*old|fittings\s*and\s*seals|pipe\s*tape|plumbing\s*sundries|teflon|ptfe)\b/.test(t)) {
    cats.add('sundry')
  }

  if (cats.size === 0) cats.add('general')
  return cats
}

// ─────────────────────────────────────────────────────────────────
// R12 (2026-06-18) — SAFETY-CRITICAL category whitelist + cross-trade
// mismatch guard.
//
// Why: the loose grounding path accepts a line when the line and a
// same-priced candidate row share ANY tag. categorise() adds a tag only
// when the *line text* matches a keyword regex, BUT a line whose text
// trips no keyword falls back to ['general'] — and the catch-all
// general∩sundry rule, plus a candidate row that *also* tags as the same
// safety category by coincidence, could let a price ground a safety line
// it does not actually describe. For ordinary categories (downlight, tap)
// a near-miss is a pricing bug. For SAFETY-CRITICAL categories
// (smoke_alarm, gas, switchboard, rcbo/safety-switch) a wrong-category
// ground is a LIABILITY: a customer could be sold "smoke alarm work"
// priced off a downlight row.
//
// The whitelist makes the contract one-directional and strict: a CANDIDATE
// ROW that carries a safety-critical tag can only ground a line whose own
// text genuinely carries that same safety tag. A line that does NOT mention
// smoke/alarm can never ground against a smoke_alarm row, even at an exact
// price match. This only ever makes grounding REJECT a wrong-category
// safety line — a legitimate same-category safety line (line text + row
// both carry the tag) is unaffected.
// ─────────────────────────────────────────────────────────────────
const SAFETY_CRITICAL: ReadonlySet<Category> = new Set<Category>([
  'smoke_alarm',
  'gas',
  'switchboard',
  'rcbo',
])

// Per-category trade ownership. Used to flag cross-trade mismatches — an
// electrical price grounding a plumbing line (or vice versa). Shared tags
// ('sundry', 'general') belong to neither trade and never trip the guard.
const CATEGORY_TRADE: Partial<Record<Category, 'electrical' | 'plumbing'>> = {
  // ── Electrical ──
  downlight: 'electrical',
  gpo: 'electrical',
  smoke_alarm: 'electrical',
  fan: 'electrical',
  outdoor_light: 'electrical',
  rcbo: 'electrical',
  oven_cooktop: 'electrical',
  ev_charger: 'electrical',
  switchboard: 'electrical',
  fault_find: 'electrical',
  strip_light: 'electrical',
  security_camera: 'electrical',
  doorbell_intercom: 'electrical',
  // ── Plumbing ──
  drain: 'plumbing',
  hot_water: 'plumbing',
  tap: 'plumbing',
  toilet: 'plumbing',
  cctv: 'plumbing',
  gas: 'plumbing',
  prv: 'plumbing',
  dishwasher: 'plumbing',
  rainwater_tank: 'plumbing',
  water_filter: 'plumbing',
  leak_detection: 'plumbing',
  shower: 'plumbing',
}

/** Which trade(s) a category set belongs to (excludes shared sundry/general). */
function tradesOf(cats: Set<Category>): Set<'electrical' | 'plumbing'> {
  const out = new Set<'electrical' | 'plumbing'>()
  for (const c of cats) {
    const trade = CATEGORY_TRADE[c]
    if (trade) out.add(trade)
  }
  return out
}

/**
 * A line description and a candidate row "match categorically" when:
 *   - they share at least one specific tag (downlight ∩ downlight), OR
 *   - the line is purely 'general' AND the row is 'sundry' only — handles
 *     legitimate catch-all lines like "Disposal of old fittings" being
 *     priced from the Sundries row.
 *
 * R12 (2026-06-18) — two HARDENING rules applied on top:
 *   1. SAFETY-CRITICAL whitelist. If the candidate ROW carries a
 *      safety-critical tag (smoke_alarm/gas/switchboard/rcbo), the match
 *      is only allowed when the LINE genuinely carries that SAME safety
 *      tag. The shared tag must itself be the safety one — a coincidental
 *      overlap on some other tag does not license grounding off a safety
 *      row. This stops a wrong-category line grounding against a
 *      same-priced safety row.
 *   2. CROSS-TRADE guard. If the line and the row resolve to DIFFERENT
 *      single trades (electrical line vs plumbing row, or vice versa)
 *      with no shared specific tag, reject — an electrical price must
 *      never ground a plumbing line. (This is mostly already enforced by
 *      trade-scoped candidate loading, but the validator makes it a hard,
 *      testable invariant rather than relying solely on the caller.)
 */
function categoriesMatch(lineCats: Set<Category>, rowCats: Set<Category>): boolean {
  // Collect the specific tags shared by both sides.
  const shared: Category[] = []
  for (const lc of lineCats) {
    if (rowCats.has(lc)) shared.push(lc)
  }

  // Specific (non-shared-sundry/general) tags both sides have in common,
  // split into safety-critical and ordinary. A "specific" shared tag is any
  // overlap other than the trade-neutral catch-alls.
  const sharedSafety = shared.filter((c) => SAFETY_CRITICAL.has(c))
  const sharedNonSafetySpecific = shared.filter(
    (c) => !SAFETY_CRITICAL.has(c) && c !== 'sundry' && c !== 'general',
  )

  // R12.1 — row-side safety veto (false-positive fix, 2026-06-18).
  //
  // Old behaviour: if the candidate ROW carried ANY safety-critical tag, the
  // ONLY way to ground was a shared safety tag — i.e. a row's safety tag
  // vetoed every non-safety overlap. That over-rejected a legitimate
  // non-safety line that shares a real non-safety specific tag with a
  // MULTI-TAG row (safety + other), e.g. an [oven_cooktop] line grounding a
  // catalogue row tagged [oven_cooktop, gas]: the genuine oven_cooktop
  // overlap was discarded just because the row also happened to carry the
  // safety `gas` tag.
  //
  // New behaviour (still strictly conservative):
  //   - A row that is PURELY safety-critical (every tag ∈ SAFETY_CRITICAL)
  //     can only be grounded by a SHARED safety tag — the line must
  //     independently describe that same safety category. (Unchanged for the
  //     pure-safety case: a [smoke_alarm]-only row never grounds a non-smoke
  //     line.)
  //   - A MIXED row (safety + at least one non-safety tag) may ground via a
  //     genuine shared NON-SAFETY specific tag OR a shared safety tag; if
  //     there is no shared specific tag of either kind, veto.
  // Either way a wrong-category line off a safety row is still rejected — the
  // only newly-allowed case is a real, independently-tagged non-safety match
  // against a multi-tag row. This REMOVES a false positive without letting a
  // genuinely-bad price through.
  const rowSafety = [...rowCats].filter((c) => SAFETY_CRITICAL.has(c))
  if (rowSafety.length > 0) {
    const rowPurelySafety = [...rowCats].every((c) => SAFETY_CRITICAL.has(c))
    if (rowPurelySafety) {
      return sharedSafety.length > 0
    }
    return sharedSafety.length > 0 || sharedNonSafetySpecific.length > 0
  }

  // R12.2 — if the LINE is safety-critical but the row carries NONE of the
  // line's safety tags, reject. A "smoke alarm" line must be priced from a
  // smoke_alarm row, never from a generic same-priced row.
  const lineSafety = [...lineCats].filter((c) => SAFETY_CRITICAL.has(c))
  if (lineSafety.length > 0 && !lineSafety.some((s) => rowCats.has(s))) {
    return false
  }

  if (shared.length > 0) return true

  // Catch-all: a purely 'general' line may ground from a pure 'sundry' row.
  if (lineCats.has('general') && rowCats.size === 1 && rowCats.has('sundry')) return true

  // R12.2 (cross-trade) — no shared specific tag. If both sides resolve to
  // a single, DIFFERENT trade, this is an electrical↔plumbing mismatch:
  // reject regardless of a coincidental price match. (When either side is
  // trade-neutral — only sundry/general — we fall through to the default
  // reject below without singling it out as a cross-trade error.)
  const lineTrades = tradesOf(lineCats)
  const rowTrades = tradesOf(rowCats)
  if (
    lineTrades.size === 1 &&
    rowTrades.size === 1 &&
    [...lineTrades][0] !== [...rowTrades][0]
  ) {
    return false
  }

  return false
}

// ─────────────────────────────────────────────────────────────────
// Catalogue-row anchoring — shared by the within-tier dedup (D-1 / R5)
// and the cross-tier dedup (R6). A line resolves to an "anchor" =
// `"<type>:<id>"` of the catalogue row it maps to. This is the unit of
// double-charge detection: two lines that map to the SAME catalogue row
// are charging the customer for the same product twice.
// ─────────────────────────────────────────────────────────────────

type AnchorIndex = {
  materialById: Map<string, CandidatePrice[]>
  assemblyById: Map<string, CandidatePrice[]>
}

const PRICE_TOLERANCE_ANCHOR = PRICE_TOLERANCE
const withinTol = (a: number, b: number) => Math.abs(a - b) <= PRICE_TOLERANCE_ANCHOR

/** Build the per-id candidate index used by anchor resolution. */
function buildAnchorIndex(candidates: CandidatePrices): AnchorIndex {
  const materialById = new Map<string, CandidatePrice[]>()
  const assemblyById = new Map<string, CandidatePrice[]>()
  for (const c of candidates.material) {
    if (c.sourceId) {
      const list = materialById.get(c.sourceId) ?? []
      list.push(c)
      materialById.set(c.sourceId, list)
    }
  }
  for (const c of candidates.assembly) {
    if (c.sourceId) {
      const list = assemblyById.get(c.sourceId) ?? []
      list.push(c)
      assemblyById.set(c.sourceId, list)
    }
  }
  return { materialById, assemblyById }
}

/** Parse `"material:<id>"` / `"assembly:<id>"` out of a line's source.
 *  Mirrors validateQuoteGrounding's local extractRowRef so anchor
 *  resolution and strict UUID grounding agree on what a typed ref is. */
function parseRowRef(
  source: unknown,
): { type: 'material' | 'assembly'; id: string } | null {
  const s = String(source ?? '').trim()
  const m = s.match(/^(material|assembly):([A-Za-z0-9_-]+)$/)
  if (!m) return null
  const id = m[2]
  if (!id || id.length < 4 || id.toLowerCase() === 'uuid') return null
  return { type: m[1] as 'material' | 'assembly', id }
}

/**
 * Resolve a line item to the catalogue row it represents, returned as
 * `"<type>:<id>"`. Resolution order (R5 — sourceId FIRST):
 *
 *   1. EXPLICIT typed ref in `source` ("material:<id>" / "assembly:<id>")
 *      — authoritative, by row id. This is the only signal Opus is
 *      supposed to emit and is immune to description drift.
 *   2. NAME + price reverse lookup — the line description aligns with a
 *      catalogue row name (either direction, parenthetical tails stripped)
 *      AND the price matches one of that row's markup variants.
 *   3. R5 — PRICE-ONLY reverse lookup. When neither a typed ref nor a name
 *      match resolves, but the price matches EXACTLY ONE catalogue row's
 *      price-set (across all markup variants), anchor to that row. This is
 *      what catches the harder duplicate: the same row emitted twice with
 *      DIFFERENT descriptions ("Dux Proflo 315L" vs "Premium HWS 315L")
 *      and/or in DIFFERENT markup bands (raw vs ×20% vs ×28%). It is
 *      deliberately conservative — if the price is ambiguous (matches >1
 *      distinct row id) we return null rather than guess, so we never
 *      flag two genuinely different products that merely cost the same.
 *
 * Labour / call-out / fabricated lines resolve to null (no catalogue
 * anchor) and are therefore never treated as duplicates of each other.
 */
function resolveLineAnchor(li: any, index: AnchorIndex): string | null {
  const ref = parseRowRef(li?.source)
  if (ref) return `${ref.type}:${ref.id}`

  // R5 (2026-06-18, false-positive fix) — short-circuit NON-CATALOGUE lines
  // to null BEFORE the loose name/price reverse lookups. A labour / call-out /
  // after-hours line is NOT a catalogue product, so it must never anchor to a
  // material/assembly row just because their dollar amounts happen to match
  // (e.g. labour at $110/hr colliding with a same-priced $110 material row).
  // Without this short-circuit the price-only fallback (3) below could anchor
  // such a line to a coincidentally same-priced catalogue row, and the D-1
  // within-tier dedup would then flag a genuine labour line as a duplicate →
  // a clean quote needlessly downgraded to inspection. Typed `material:`/
  // `assembly:` refs already returned above and keep their behaviour; this
  // only narrows the loose path, so grounding can only ever REJECT FEWER
  // false dupes — never accept a genuinely-bad price.
  const unitNorm = String(li?.unit ?? '').toLowerCase().trim()
  const sourceNorm = String(li?.source ?? '').toLowerCase().trim()
  const NON_CATALOGUE_SOURCES = new Set([
    'labour',
    'callout',
    'after_hours',
    'after-hours',
    'emergency',
    'emergency_callout',
    'after_hours_callout',
  ])
  if (unitNorm === 'hr' || NON_CATALOGUE_SOURCES.has(sourceNorm)) return null

  const price = Number(li?.unit_price_ex_gst)
  if (!Number.isFinite(price)) return null

  const desc = String(li?.description ?? '').toLowerCase().trim()
  const descBase = desc.split(/\s*\(/)[0].trim()

  const entries = [
    ['material', index.materialById],
    ['assembly', index.assemblyById],
  ] as const

  // (2) name + price reverse lookup.
  if (desc.length >= 4) {
    for (const [type, byId] of entries) {
      for (const [id, variants] of byId) {
        const cName = variants[0]?.sourceName?.toLowerCase()
        if (!cName || cName.length < 4) continue
        const nameAligned =
          desc.includes(cName) ||
          (descBase.length >= 4 && (descBase.includes(cName) || cName.includes(descBase)))
        if (!nameAligned) continue
        if (variants.some((v) => withinTol(v.price, price))) {
          return `${type}:${id}`
        }
      }
    }
  }

  // (3) R5 — price-only reverse lookup. Collect EVERY distinct row id whose
  // price-set contains this price. Only anchor when exactly one row matches
  // (an unambiguous price → row mapping); otherwise stay null.
  const priceMatchedIds = new Set<string>()
  let firstAnchor: string | null = null
  for (const [type, byId] of entries) {
    for (const [id, variants] of byId) {
      if (variants.some((v) => withinTol(v.price, price))) {
        const anchor = `${type}:${id}`
        if (!priceMatchedIds.has(anchor)) {
          priceMatchedIds.add(anchor)
          firstAnchor = firstAnchor ?? anchor
        }
      }
    }
  }
  if (priceMatchedIds.size === 1) return firstAnchor
  return null
}

/** Stripped (lower-cased, parenthetical-tail-removed) line description,
 *  used by the cross-tier framing check. */
function descKey(li: any): string {
  return String(li?.description ?? '')
    .toLowerCase()
    .split(/\s*\(/)[0]
    .trim()
}

export type CrossTierDuplicate = {
  anchor: string
  /** The catalogue row's name (for the failure message). */
  sourceName: string
  /** Tier → line index where this anchor appears. */
  occurrences: Array<{ tier: 'good' | 'better' | 'best'; lineIndex: number }>
  /** True when every occurrence quotes the SAME quantity (a verbatim
   *  re-charge); false when quantities differ (tier-up via quantity). */
  sameQuantity: boolean
}

/**
 * R6 (2026-06-18) — CROSS-TIER duplicate detection.
 *
 * Good / Better / Best are PRESENTED to the customer as mutually exclusive
 * options — the customer picks ONE tier and pays for it. So the same
 * catalogue row legitimately appears in more than one tier (a downlight in
 * Good, Better and Best is normal tier progression). The danger this guard
 * addresses is a row appearing across tiers in a way that DOUBLE-CHARGES
 * within whichever single tier the customer picks — i.e. the validator's
 * within-tier dedup (D-1/R5) catches a row twice in one tier; this catches
 * the cross-tier shape where the same row is charged in a way the
 * scope/assumptions do not justify.
 *
 * Policy:
 *   - Same row, SAME quantity in 2+ tiers → ALLOWED (ordinary tier
 *     progression; the customer only ever pays one tier).
 *   - Same row, DIFFERENT quantities across tiers ("3 downlights in Good,
 *     6 in Best") → ALLOWED **only** when the differing quantity is
 *     explicitly framed in scope_of_works / assumptions (the customer can
 *     see why the count changes). Otherwise FLAG it — an unframed quantity
 *     jump is exactly how a silent double/over-charge hides across tiers.
 *
 * Tiers that quote DIFFERENT products (Good = basic HWS, Better = premium
 * HWS — different catalogue rows → different anchors) never collide, so
 * legitimate tier differentiation is untouched.
 *
 * Returns the list of offending anchors. Empty array = no cross-tier
 * double-charge detected.
 */
export function detectCrossTierDuplicates(
  draft: any,
  candidates: CandidatePrices,
): CrossTierDuplicate[] {
  const index = buildAnchorIndex(candidates)
  const TIERS = ['good', 'better', 'best'] as const

  // Free-text framing the customer can see. When a quantity difference is
  // explained here, a differing-quantity cross-tier appearance is allowed.
  const framingText = [
    typeof draft?.scope_of_works === 'string' ? draft.scope_of_works : '',
    typeof draft?.scope_short === 'string' ? draft.scope_short : '',
    Array.isArray(draft?.assumptions) ? draft.assumptions.join(' ') : '',
    // Per-tier framing too — a tier label/timeframe can carry the "6 vs 3"
    // distinction ("Best — 6 downlights").
    ...TIERS.map((t) =>
      [draft?.[t]?.label, draft?.[t]?.timeframe, draft?.[t]?.scope_note]
        .filter((x) => typeof x === 'string')
        .join(' '),
    ),
  ]
    .join(' ')
    .toLowerCase()

  // anchor → occurrences across tiers (one per tier max; the within-tier
  // dedup already handles repeats inside a single tier).
  type Occ = {
    tier: 'good' | 'better' | 'best'
    lineIndex: number
    quantity: number
    sourceName: string
    descKey: string
  }
  const byAnchor = new Map<string, Occ[]>()

  for (const tierKey of TIERS) {
    const tier = draft?.[tierKey]
    if (!tier || !Array.isArray(tier.line_items)) continue
    // Only the FIRST occurrence of each anchor per tier counts here — a
    // within-tier repeat is D-1/R5's job, not this function's.
    const seenInTier = new Set<string>()
    for (let i = 0; i < tier.line_items.length; i++) {
      const li = tier.line_items[i]
      const anchor = resolveLineAnchor(li, index)
      if (!anchor) continue
      if (seenInTier.has(anchor)) continue
      seenInTier.add(anchor)
      const ref = parseRowRef(li?.source)
      const variants =
        (ref?.type === 'assembly' ? index.assemblyById : index.materialById).get(
          ref?.id ?? anchor.split(':')[1],
        ) ?? []
      const sourceName = variants[0]?.sourceName ?? anchor
      const arr = byAnchor.get(anchor) ?? []
      arr.push({
        tier: tierKey,
        lineIndex: i,
        quantity: Number(li?.quantity) || 0,
        sourceName,
        descKey: descKey(li),
      })
      byAnchor.set(anchor, arr)
    }
  }

  const out: CrossTierDuplicate[] = []
  for (const [anchor, occs] of byAnchor) {
    if (occs.length <= 1) continue
    const quantities = new Set(occs.map((o) => o.quantity))
    const sameQuantity = quantities.size === 1

    if (sameQuantity) {
      // Same row, same quantity in 2+ tiers — ordinary tier progression.
      // The customer picks one tier and pays once. Allowed.
      continue
    }

    // Different quantities across tiers. Allowed ONLY if explicitly framed
    // so the customer can see why the count differs.
    //
    // R6 (2026-06-18, false-positive fix) — the framing match used to require
    // the VERBATIM catalogue SKU name (or the line's descKey) in the framing
    // text. Real quotes frame the difference in customer PROSE ("3 downlights
    // in the lounge, 6 in the best option") that never repeats the exact SKU
    // string, so legitimately-framed quotes were over-flagged → needless
    // inspection. We now also accept a framing that mentions the line's
    // product CATEGORY (reuse categorise() on the line description + source
    // name and require the framing text to independently categorise into the
    // SAME bucket) — plus a quantity-difference signal.
    //
    // This is deliberately conservative: it still requires BOTH an item
    // reference (verbatim name/desc OR a shared product category) AND a
    // quantity-difference signal. A genuine silent stack with NO framing at
    // all (no item mention, or no quantity signal) is still flagged. So this
    // only ever makes the guard REJECT FEWER framed quotes — it never lets an
    // unframed cross-tier over-charge through.
    const nameNeedle = (occs[0].sourceName || '').toLowerCase()
    const descNeedle = occs[0].descKey
    // Category overlap between the line and the framing prose. categorise()
    // on the line text yields the product bucket(s); categorise() on the
    // framing text must independently land in at least one of the SAME
    // SPECIFIC buckets (the trade-neutral catch-alls sundry/general don't
    // count as an item reference).
    const lineCats = categorise(`${descNeedle} ${nameNeedle}`)
    const framingCats = categorise(framingText)
    const sharedFramingCat = [...lineCats].some(
      (c) => c !== 'sundry' && c !== 'general' && framingCats.has(c),
    )
    const mentionsItem =
      (nameNeedle.length >= 4 && framingText.includes(nameNeedle)) ||
      (descNeedle.length >= 4 && framingText.includes(descNeedle)) ||
      sharedFramingCat
    // Quantity-difference signal: at least two of the differing quantities
    // appear as bare numbers, OR explicit comparison/upgrade prose.
    const quantitiesMentioned = [...quantities].filter(
      (q) => q > 0 && new RegExp(`\\b${q}\\b`).test(framingText),
    ).length
    const quantityPhrase =
      /\b\d+\s*(?:vs\.?|versus|→|to)\s*\d+\b/.test(framingText) ||
      /\b(?:additional|extends?\s+to|upgrade\s+to|up\s+to|increases?\s+to|more)\b/.test(
        framingText,
      )
    const quantitySignalled = quantitiesMentioned >= 2 || quantityPhrase
    const framed = mentionsItem && quantitySignalled

    if (!framed) {
      out.push({
        anchor,
        sourceName: occs[0].sourceName,
        occurrences: occs.map((o) => ({ tier: o.tier, lineIndex: o.lineIndex })),
        sameQuantity: false,
      })
    }
  }

  return out
}

export function validateQuoteGrounding(
  draft: any,
  pricingBook: PricingBookForValidation,
  candidates: CandidatePrices,
): GroundingResult {
  // Inspection-required quotes don't carry line items to validate.
  if (draft?.needs_inspection === true) return { valid: true }

  const hourly = n(pricingBook.hourly_rate)
  const apprentice = n(pricingBook.apprentice_rate)
  const senior =
    pricingBook.senior_rate != null && pricingBook.senior_rate !== ''
      ? n(pricingBook.senior_rate)
      : null
  const callOut = n(pricingBook.call_out_minimum)
  const markupPct = n(pricingBook.default_markup_pct)
  const minLabourHours = pricingBook.min_labour_hours != null
    ? n(pricingBook.min_labour_hours)
    : 2.0
  // P-1 — derived after-hours rates. Both default to null when the multiplier
  // is unset/invalid, so the additional accept branches are dormant unless
  // the tradie has explicitly configured a VALID multiplier.
  //
  // R11 (2026-06-18) — multiplier TYPE + VALUE validation. The after-hours
  // accept branches are the only place the validator will sign off on a
  // labour/callout price ABOVE the standard rate. A forged or garbage
  // multiplier must not be able to establish an arbitrarily inflated
  // "accepted" rate. `n()` blindly parseFloat()s its input, so a string,
  // a non-numeric value, or an absurd number could previously slip a
  // mis-derived rate into the accept set. We now:
  //   - reject anything that isn't a finite number (NaN, Infinity, "", a
  //     non-numeric string → null, branch stays dormant);
  //   - require strictly > 1 — an after-hours rate is a SURCHARGE, so a
  //     multiplier of ≤ 1 is meaningless and never widens the accept set
  //     (a ×1 would just duplicate the standard rate; a <1 would let an
  //     UNDER-cost rate ground under an after-hours tag);
  //   - cap at AFTER_HOURS_MAX_MULTIPLIER (2.5) — real after-hours/emergency
  //     loadings in AU trades top out around ×2–2.5 (the documented AU
  //     ceiling); anything beyond the cap is treated as forged/garbage and
  //     the branch stays dormant so the inflated price falls through to a
  //     normal grounding failure.
  // A legitimately configured ×1.5 / ×2 multiplier still derives its rate
  // and a correctly-tagged after-hours line still grounds.
  const AFTER_HOURS_MAX_MULTIPLIER = 2.5
  const rawAfterHoursMx =
    pricingBook.after_hours_multiplier != null && pricingBook.after_hours_multiplier !== ''
      ? n(pricingBook.after_hours_multiplier)
      : null
  const afterHoursMx =
    rawAfterHoursMx != null &&
    Number.isFinite(rawAfterHoursMx) &&
    rawAfterHoursMx > 1 &&
    rawAfterHoursMx <= AFTER_HOURS_MAX_MULTIPLIER
      ? rawAfterHoursMx
      : null
  const afterHoursHourly = afterHoursMx != null ? +(hourly * afterHoursMx).toFixed(2) : null
  const afterHoursCallout = afterHoursMx != null ? +(callOut * afterHoursMx).toFixed(2) : null

  // A line item is "tagged after-hours" iff its `source` field explicitly
  // says so. Standard-hours lines at the inflated rate still fail grounding.
  //
  // C-2 (2026-05-25) — dropped the description-side regex. Pre-C-2 the
  // detector also matched any description containing "after-hours" or
  // "emergency", which let Opus pass an inflated rate by writing the
  // word into ANY line description (e.g. "Emergency-capable wiring",
  // "After-hours capable LED install"). Source-only detection is
  // unambiguous and the prompts now reliably set `source: "after_hours"`
  // on the lines that should qualify; the description-side check was
  // belt-and-braces that turned into a leak.
  const isAfterHours = (li: any): boolean => {
    const source = String(li?.source ?? '').toLowerCase().trim()
    return (
      source === 'after_hours' ||
      source === 'after-hours' ||
      source === 'emergency' ||
      source === 'emergency_callout' ||
      source === 'after_hours_callout'
    )
  }

  const within = (a: number, b: number) => Math.abs(a - b) <= PRICE_TOLERANCE

  /** Candidate rows whose price matches `target` within tolerance. */
  const findMatches = (target: number, list: CandidatePrice[]) =>
    list.filter((c) => within(c.price, target))

  // R-4 (2026-05-25) — STRICT UUID GROUNDING.
  // Index candidates by row id once per validation so per-line lookups
  // are O(1). Each id maps to ALL its markup variants (raw + ±5pp + default)
  // — buildCandidatePrices stamps the same sourceId on every variant of a
  // given row. The strict path matches against this full set, so the line
  // can use any valid markup of THE EXACT ROW Opus picked.
  //
  // R5 (2026-06-18) — the same index now also feeds resolveLineAnchor for
  // the within-tier dedup pass below (and the cross-tier dedup, R6, which
  // builds its own index from the same candidates).
  const anchorIndex = buildAnchorIndex(candidates)
  const { materialById, assemblyById } = anchorIndex

  /** Parse `"material:<id>"` / `"assembly:<id>"` out of a line's source.
   *  Returns null for anything that isn't a typed UUID reference (labour,
   *  callout, tradie_edit, plain "material" without a colon, etc.) so
   *  those lines fall through to the loose grounding path unchanged. */
  const extractRowRef = (source: unknown): { type: 'material' | 'assembly'; id: string } | null => {
    const s = String(source ?? '').trim()
    const m = s.match(/^(material|assembly):([A-Za-z0-9_-]+)$/)
    if (!m) return null
    const id = m[2]
    // Empty / placeholder ids (e.g. literal "UUID" from a prompt example
    // Opus copy-pasted) → no strict path; fall through to loose.
    if (!id || id.length < 4 || id.toLowerCase() === 'uuid') return null
    return { type: m[1] as 'material' | 'assembly', id }
  }

  const failures: GroundingFailure[] = []
  const TIERS = ['good', 'better', 'best'] as const

  for (const tierKey of TIERS) {
    const tier = draft?.[tierKey]
    if (!tier || !Array.isArray(tier.line_items)) continue

    // Per-tier labour-hours minimum check. Sum every unit='hr' line.
    // If the tier has any line items at all but labour totals below
    // pricing_book.min_labour_hours, fail the tier — Opus has skipped
    // the small-job-allowance rule. (Unit normalised so 'HR'/'Hr' also count.)
    const labourHours = tier.line_items
      .filter((li: any) => String(li?.unit ?? '').toLowerCase().trim() === 'hr')
      .reduce((sum: number, li: any) => sum + (Number(li?.quantity) || 0), 0)
    if (tier.line_items.length > 0 && labourHours < minLabourHours - 0.05) {
      failures.push({
        tier: tierKey,
        lineIndex: -1,
        // L-1.2 (2026-05-25) — distinguish "tier has zero labour at all"
        // from "tier has labour but below the floor" so operators reading
        // risk_flags can act on the right cause. Opus generating a tier
        // with no `hr` lines is a different kind of mistake to forgetting
        // the floor on a small job.
        description: labourHours === 0
          ? '(tier has no labour lines)'
          : '(tier-level labour total)',
        unit: 'hr',
        unit_price_ex_gst: labourHours,
        expected: `at least ${minLabourHours} hr of labour per tier (got ${labourHours.toFixed(2)})`,
      })
    }

    for (let i = 0; i < tier.line_items.length; i++) {
      const li = tier.line_items[i]
      const price = Number(li?.unit_price_ex_gst)
      const description = String(li?.description ?? '(no description)')
      const unit = String(li?.unit ?? '?')
      // L-1.1 (2026-05-25) — normalise unit for comparison so 'M', 'METRE',
      // 'metres', '  lm  ' etc. all behave like 'lm'. `unit` is preserved
      // verbatim for the failure message so the original spelling is visible
      // to operators reading risk_flags.
      const unitNorm = unit.toLowerCase().trim()

      if (!Number.isFinite(price)) {
        failures.push({
          tier: tierKey, lineIndex: i, description, unit,
          unit_price_ex_gst: price,
          expected: 'finite numeric unit_price_ex_gst',
        })
        continue
      }

      let valid = false
      let expected = ''

      if (unitNorm === 'hr') {
        // Labour rates: hourly_rate, apprentice_rate, OR senior_rate when
        // configured. No semantic category check — labour lines are
        // intrinsically generic. Adding senior_rate fixes the case where
        // Opus picks the senior tier for the "Best" option and the
        // entire quote was being downgraded for what is the right call.
        //
        // P-1 — when the line is explicitly tagged as after-hours AND the
        // tradie has configured a multiplier, ALSO accept hourly × multiplier.
        // Standard-hours lines at the inflated rate still fail.
        valid =
          within(price, hourly) ||
          within(price, apprentice) ||
          (senior !== null && within(price, senior)) ||
          (afterHoursHourly !== null && isAfterHours(li) && within(price, afterHoursHourly))
        const afterHoursNote =
          afterHoursHourly !== null
            ? `, or after-hours hourly ($${afterHoursHourly.toFixed(2)}) when line tagged after-hours`
            : ''
        expected = senior !== null
          ? `pricing_book.hourly_rate ($${hourly}), apprentice_rate ($${apprentice}), or senior_rate ($${senior})${afterHoursNote}`
          : `pricing_book.hourly_rate ($${hourly}) or apprentice_rate ($${apprentice})${afterHoursNote}`
      } else if (
        li?.source === 'callout' ||
        (unitNorm === 'each' && within(price, callOut)) ||
        // P-1 — after-hours callout: accept the inflated price ONLY when the
        // line is explicitly marked as after-hours/emergency.
        (afterHoursCallout !== null && unitNorm === 'each' && isAfterHours(li) && within(price, afterHoursCallout))
      ) {
        // Call-out — unit is 'each' but price matches call_out_minimum
        // (or the after-hours variant when tagged).
        valid =
          within(price, callOut) ||
          (afterHoursCallout !== null && isAfterHours(li) && within(price, afterHoursCallout))
        const afterHoursNote =
          afterHoursCallout !== null
            ? `, or after-hours call-out ($${afterHoursCallout.toFixed(2)}) when line tagged after-hours`
            : ''
        expected = `pricing_book.call_out_minimum ($${callOut})${afterHoursNote}`
      } else if (
        unitNorm === 'each' ||
        unitNorm === 'lm' ||
        unitNorm === 'm' ||
        unitNorm === 'metre' ||
        unitNorm === 'metres'
      ) {
        // L-1 (2026-05-25) — 'm' and 'metre' are accepted as aliases for
        // 'lm' so per-metre-priced lines (LED strip, drain rod, copper
        // pipe) don't dump to inspection on the unit check. The price
        // side of the candidate set carries no unit, so matching is
        // unaffected; this just stops the allowlist failing loudly for
        // a legitimate unit Opus might emit.
        //
        // R-4 (2026-05-25) — STRICT UUID PATH (when `source` carries one).
        // If the line says `source: "material:<id>"` or `"assembly:<id>"`
        // we look up THAT exact row and only accept a price that matches
        // its raw or markup-expanded variants (±$0.50). The loose price
        // + category fallback below is bypassed — UUID is the link, no
        // need for the "right price + plausible category" heuristic.
        // Lines without a UUID in source (legacy, tradie_edit, ambiguous)
        // continue to use the loose path so no quote ever-grounded today
        // suddenly breaks.
        const ref = extractRowRef(li?.source)
        if (ref) {
          const candidateList = ref.type === 'material'
            ? materialById.get(ref.id)
            : assemblyById.get(ref.id)
          if (!candidateList || candidateList.length === 0) {
            valid = false
            expected =
              `${ref.type}:${ref.id} not found in this tenant+trade candidate set ` +
              `(row may have been deleted, fabricated by the model, or the id ` +
              `belongs to another trade/tenant). Strict UUID grounding requires ` +
              `the row Opus picked to be in the loaded candidate set.`
          } else {
            const match = candidateList.find((c) => within(c.price, price))
            if (match) {
              valid = true
            } else {
              valid = false
              const allowed = Array.from(new Set(candidateList.map((c) => `$${c.price.toFixed(2)}`))).join(', ')
              expected =
                `${ref.type}:${ref.id} ("${candidateList[0].sourceName}") allows ` +
                `prices [${allowed}] (raw + markup variants); got $${price}. ` +
                `Either Opus emitted a price that doesn't match the row it picked, ` +
                `or it stamped the wrong row id.`
            }
          }
        } else {
          // Materials or assemblies — price match AND category match required
          // (the original loose path, unchanged).
          const lineCats = categorise(description)
          const priceMatches = [
            ...findMatches(price, candidates.material),
            ...findMatches(price, candidates.assembly),
          ]

          if (priceMatches.length === 0) {
            valid = false
            expected = `shared_materials/shared_assemblies (raw or × ${markupPct}% markup)`
          } else {
            // Of the rows that match by price, do any also match by category?
            const semanticMatch = priceMatches.find((c) => categoriesMatch(lineCats, c.categories))
            if (semanticMatch) {
              valid = true
            } else {
              valid = false
              const lineCatList = Array.from(lineCats).join(',')
              const sourceList = priceMatches
                .map((c) => `"${c.sourceName}" [${Array.from(c.categories).join(',')}]`)
                .slice(0, 3)
                .join(' | ')
              expected = `price $${price} only exists in DB rows of a different category. Line categorised as [${lineCatList}], but matching rows are: ${sourceList}`
            }
          }
        }
      } else {
        valid = false
        expected = `recognised unit (hr / each / lm / m / metre / metres — case-insensitive)`
      }

      if (!valid) {
        failures.push({
          tier: tierKey, lineIndex: i, description, unit,
          unit_price_ex_gst: price,
          expected,
        })
      }
    }

    // D-1 (2026-05-26) — DUPLICATE-LINE GUARD.
    // Catches the bug where Opus emits the SAME catalogue product as two
    // separate line items: one at raw cost ("source": "material"), one at
    // marked-up cost ("source": "material:<id>"). The original per-line
    // validation accepts both individually (the raw price is a valid
    // candidate via the loose path; the marked-up price is a valid
    // candidate via the strict UUID path) — so the customer ends up paying
    // for the product twice. Real example: quote 3669a680... charged James
    // for a Dux Proflo 315L at both $1645 (raw) AND $2237.20 (×1.36),
    // inflating the total by ~$1810 inc GST.
    //
    // Each line resolves to an "anchor" — the catalogue row id it maps to —
    // via the shared resolveLineAnchor (R5). Resolution is sourceId-FIRST
    // and falls back to name+price, then a conservative price-only lookup.
    // Two lines with the same anchor in the same tier → flag the later one.
    //
    // R5 (2026-06-18) — the price-only fallback closes the harder shapes
    // the old name-anchored resolver missed: the SAME catalogue row emitted
    // twice with DIFFERENT descriptions ("Dux Proflo 315L" vs "Premium HWS
    // 315L") and/or in DIFFERENT markup bands (raw vs ×20% vs ×28%). As long
    // as each line's price unambiguously maps to one catalogue row, both
    // anchor to it regardless of the description Opus invented.
    if (tier.line_items.length > 1) {
      const anchorToIndices = new Map<string, number[]>()
      for (let i = 0; i < tier.line_items.length; i++) {
        const anchor = resolveLineAnchor(tier.line_items[i], anchorIndex)
        if (!anchor) continue
        const arr = anchorToIndices.get(anchor) ?? []
        arr.push(i)
        anchorToIndices.set(anchor, arr)
      }
      for (const [anchor, indices] of anchorToIndices) {
        if (indices.length <= 1) continue
        for (const dupIdx of indices.slice(1)) {
          const li = tier.line_items[dupIdx]
          failures.push({
            tier: tierKey,
            lineIndex: dupIdx,
            description: String(li?.description ?? '(no description)'),
            unit: String(li?.unit ?? '?'),
            unit_price_ex_gst: Number(li?.unit_price_ex_gst),
            expected:
              `duplicate ${anchor} — same catalogue row already used at line ${indices[0]}. ` +
              `Each catalogue row may appear at most once per tier (D-1 dedup). ` +
              `If the customer needs two of this product, set quantity=2 on a single line.`,
          })
        }
      }
    }
  }

  // R6 (2026-06-18) — CROSS-TIER duplicate detection. Runs once across all
  // three tiers (after the per-tier passes above). The same catalogue row
  // appearing across Good/Better/Best at the SAME quantity is ordinary tier
  // progression and is allowed; a row appearing at DIFFERENT quantities
  // across tiers is flagged unless scope_of_works/assumptions explicitly
  // frame the quantity difference. Surfaced as a grounding failure (against
  // the FIRST occurrence's tier+line) so an unframed cross-tier
  // double/over-charge downgrades the quote to inspection like any other
  // integrity violation.
  const crossTier = detectCrossTierDuplicates(draft, candidates)
  for (const dup of crossTier) {
    const first = dup.occurrences[0]
    const firstLi = draft?.[first.tier]?.line_items?.[first.lineIndex]
    const where = dup.occurrences
      .map((o) => `${o.tier}#${o.lineIndex}`)
      .join(', ')
    failures.push({
      tier: first.tier,
      lineIndex: first.lineIndex,
      description: String(firstLi?.description ?? dup.sourceName ?? '(no description)'),
      unit: String(firstLi?.unit ?? '?'),
      unit_price_ex_gst: Number(firstLi?.unit_price_ex_gst),
      expected:
        `cross-tier duplicate ${dup.anchor} ("${dup.sourceName}") appears at ${where} ` +
        `with differing quantities and no scope_of_works/assumptions framing the change. ` +
        `Same product at different quantities across tiers (R6) is only allowed when the ` +
        `quantity difference is explicitly explained to the customer; otherwise quote each ` +
        `tier's quantity consistently or document the "N vs M" distinction in the scope.`,
    })
  }

  return failures.length === 0 ? { valid: true } : { valid: false, failures }
}

/** Raw DB row fed into the candidate builder. `category`, when set, is an
 *  EXPLICIT validator category carried on the row itself
 *  (shared_assemblies.category / tenant_custom_assemblies.category,
 *  migration 029). It is ADDED to the name-derived tags, never replaces
 *  them — so the column can only ever make grounding recognise the
 *  CORRECT category for a row whose name the regex misses; it can never
 *  remove a tag and regress a row that already grounds today.
 *
 *  R-1 (2026-05-25) — `id` is the DB row's primary key. When passed
 *  through, it enables the strict UUID grounding path in
 *  validateQuoteGrounding. Optional for backward compat with callers
 *  that don't yet thread row IDs through. */
export type RawCandidateRow = {
  id?: string | null
  name: string
  price: number | string | null | undefined
  category?: string | null
}


/**
 * Build the candidate-price set used by validateQuoteGrounding.
 * For each raw DB row (name + price), expand into multiple realistic
 * markup variants (10% to 40% in 5% steps, plus the tradie's configured
 * default_markup_pct). Each variant carries the source row's name and
 * extracted category tags so semantic grounding can be enforced.
 */
export function buildCandidatePrices(
  rawMaterialRows: RawCandidateRow[],
  rawAssemblyRows: RawCandidateRow[],
  pricingBook: PricingBookForValidation,
): CandidatePrices {
  // MARKUP POLICY (relaxed 2026-05-13):
  // Accept the tradie's configured default_markup_pct PLUS a ±5pp band
  // PLUS 0% raw (used when Opus quotes a base material as a customer-
  // supply line or when the assembly already bakes the markup in).
  //
  // History: an earlier version allowed [0, 10, 15, 20, 25, 28, 30, 35, 40]%
  // — too much slack. Then it was tightened to exactly [0, default] which
  // killed clean plumbing quotes when Opus rounded its way to 20% on a
  // 15%-configured book (Wall-faced toilet at $580: 15% = $667 vs 20% =
  // $696, $29 over the $0.50 PRICE_TOLERANCE → every material line fails
  // → entire quote downgraded to inspection).
  //
  // ±5pp drift is the sweet spot: forgiving enough that Opus rounding /
  // anchor bias on the AU plumbing 20% standard still validates against
  // a 15%-configured book, strict enough that 30%-tradie prices can't
  // sneak through on a 15%-tradie's book (those differ by 15pp).
  const defaultMarkup = n(pricingBook.default_markup_pct)
  const MARKUP_DRIFT_PP = 5
  const standardMarkups = new Set<number>([
    0,
    Math.max(0, defaultMarkup - MARKUP_DRIFT_PP),
    defaultMarkup,
    defaultMarkup + MARKUP_DRIFT_PP,
  ])

  const multipliers = Array.from(standardMarkups).map((pct) => 1 + pct / 100)

  const expand = (rows: RawCandidateRow[]): CandidatePrice[] => {
    const out: CandidatePrice[] = []
    for (const row of rows) {
      const raw = Number(row.price)
      if (!Number.isFinite(raw) || raw <= 0) continue
      const categories = categorise(row.name ?? '')
      // Migration 029: fold in the row's EXPLICIT category (additive —
      // never drops a name-derived tag, so a row that grounds today keeps
      // grounding; this only ADDS the correct tag for names the regex
      // misses, e.g. "Install whole-house water filter").
      if (isCategory(row.category)) categories.add(row.category)
      // R-1 — preserve the row id through every markup variant so the
      // validator's strict path can index candidates by id.
      const sourceId = row.id ?? null
      for (const m of multipliers) {
        out.push({
          price: +(raw * m).toFixed(2),
          sourceName: row.name ?? '(unnamed)',
          categories,
          sourceId,
        })
      }
    }
    return out
  }

  return {
    material: expand(rawMaterialRows),
    assembly: expand(rawAssemblyRows),
  }
}
