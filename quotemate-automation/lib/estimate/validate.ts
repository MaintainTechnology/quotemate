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

/**
 * A line description and a candidate row "match categorically" when:
 *   - they share at least one specific tag (downlight ∩ downlight), OR
 *   - the line is purely 'general' AND the row is 'sundry' only — handles
 *     legitimate catch-all lines like "Disposal of old fittings" being
 *     priced from the Sundries row.
 */
function categoriesMatch(lineCats: Set<Category>, rowCats: Set<Category>): boolean {
  for (const lc of lineCats) {
    for (const rc of rowCats) {
      if (lc === rc) return true
    }
  }
  if (lineCats.has('general') && rowCats.size === 1 && rowCats.has('sundry')) return true
  return false
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
  // is unset/invalid (≤0), so the additional accept branches are dormant
  // unless the tradie has explicitly configured a multiplier.
  const afterHoursMx =
    pricingBook.after_hours_multiplier != null && pricingBook.after_hours_multiplier !== ''
      ? n(pricingBook.after_hours_multiplier)
      : null
  const afterHoursHourly =
    afterHoursMx != null && Number.isFinite(afterHoursMx) && afterHoursMx > 0
      ? hourly * afterHoursMx
      : null
  const afterHoursCallout =
    afterHoursMx != null && Number.isFinite(afterHoursMx) && afterHoursMx > 0
      ? callOut * afterHoursMx
      : null

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
    // Each line resolves to an "anchor" — the catalogue row id it maps to.
    // Lines with explicit UUID in source anchor directly. Lines without
    // UUID try a reverse lookup by description + price match against the
    // candidate set (stripping common parenthetical suffixes like
    // "(supplied)" first so Opus's invented decorations don't dodge the
    // check). Two lines with the same anchor in the same tier → flag the
    // later one as a duplicate.
    if (tier.line_items.length > 1) {
      const resolveAnchor = (li: any): string | null => {
        const ref = extractRowRef(li?.source)
        if (ref) return `${ref.type}:${ref.id}`
        const desc = String(li?.description ?? '').toLowerCase().trim()
        const price = Number(li?.unit_price_ex_gst)
        if (!Number.isFinite(price) || desc.length < 4) return null
        const descBase = desc.split(/\s*\(/)[0].trim()
        for (const [type, byId] of (
          [
            ['material', materialById],
            ['assembly', assemblyById],
          ] as const
        )) {
          for (const [id, variants] of byId) {
            const cName = variants[0]?.sourceName?.toLowerCase()
            if (!cName || cName.length < 4) continue
            // Match the line text against the catalogue row name in either
            // direction so we catch both "Catalogue name (supplied)" and
            // "Catalogue name + extra prose" shapes.
            const nameAligned =
              desc.includes(cName) ||
              descBase.includes(cName) ||
              cName.includes(descBase)
            if (!nameAligned) continue
            if (variants.some((v) => within(v.price, price))) {
              return `${type}:${id}`
            }
          }
        }
        return null
      }
      const anchorToIndices = new Map<string, number[]>()
      for (let i = 0; i < tier.line_items.length; i++) {
        const anchor = resolveAnchor(tier.line_items[i])
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
