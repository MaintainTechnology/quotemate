// WP2 + WP3 — operator materials catalogue, brand/range -> tier mapping,
// structured bill-of-materials quote-line builder, and global-vs-local
// estimation-parameter resolution.
//
// PURE + dependency-free (unit-tested in catalogue.test.ts). No DB, no
// Supabase, no Next runtime. This is the single source of truth for the
// keystone behaviour; the estimator wiring (tools.ts lookup, run.ts
// candidate loader / preference block) and the dashboard both call into
// these helpers so the logic is provable in isolation before it ever
// touches the live money path.
//
// Money convention (CLAUDE.md): prices stored/computed ex-GST; markups
// round to 2dp exactly like applyMarkup() and buildCandidatePrices() so
// a BOM-built line grounds against the validator's candidate set instead
// of being dumped to inspection (the WP2 "trap").

export type Tier = 'good' | 'better' | 'best'

export interface TenantMaterial {
  id?: string
  category: string
  name: string
  brand?: string | null
  range_series?: string | null
  supplier?: string | null
  unit?: string | null
  unit_price_ex_gst: number | string
  customer_supply_price_ex_gst?: number | string | null
  /** What the tradie PAYS (margin insight only — never a sell price;
   *  the estimator and grounding validator never read this). */
  cost_price_ex_gst?: number | string | null
  /** Operator's own product blurb (display + later WP9 option labels). */
  description?: string | null
  /** Real product photo (WP4 render reference — URL or storage path).
   *  Carried through so the rendered preview shows THE EXACT product. */
  image_path?: string | null
  tier_hint?: Tier | null
  /** "My go-to product for this category" — a SOFT tiebreaker in
   *  chooseMaterial(), strictly below an exact brand/range/tier match. */
  is_preferred?: boolean | null
  active?: boolean | null
  /** Structured product specs (amperage, ip_rating, energy_source, litres…)
   *  — the spec-aware-pricing lever. Used by selectProductOptions (match-
   *  then-price) and the reconcile guard; NEVER by price math. Empty on
   *  legacy rows (mig 028 default '{}') — callers degrade-never-block. */
  properties?: Record<string, string | number | boolean | null> | null
  /** Trade the catalogue row belongs to (electrical/plumbing/…). Surfaced
   *  so spec reconciliation can pick the right (trade,category) SpecDefs. */
  trade?: string | null
}

export interface SharedMaterial {
  name: string
  category?: string | null
  brand?: string | null
  unit?: string | null
  default_unit_price_ex_gst?: number | string | null
  unit_price_ex_gst?: number | string | null
}

export interface BomLine {
  material_category: string
  description?: string | null
  quantity: number | string
  required?: boolean | null
  /** Display/ordering rank from the recipe row. Load-bearing: both
   *  scaleBomToItemCount and the headline scan in buildBomQuoteLines pick by
   *  `sort`, not array order, so a caller that maps or concatenates cannot
   *  change which line the job is judged by. */
  sort?: number | null
  /** Phase 4 R7 (migration 185) — include this line only when the RESOLVED
   *  product's attributes satisfy every key. NULL/absent = always include.
   *  See shouldIncludeLine for the unknown-attribute rule, which differs by
   *  `required` and is the load-bearing part of the semantic. */
  include_when?: Record<string, unknown> | null
  /** Phase 4 R8 (migration 185) — ratio denominator. One driver per four
   *  lights is `quantity_per: 4`; with item_count 10 the line becomes 3
   *  (ceil), not 10. NULL/absent = use `quantity` as-is. Applied in
   *  scaleBomToItemCount, which is where item_count lives. */
  quantity_per?: number | string | null
  /** Phase 4 R11 (migration 185) — pin this line to one exact product from
   *  the tenant's catalogue. A tier-ladder hit still beats it (R12). */
  catalogue_id?: string | null
}

/** Phase 4 R7 — does this line survive its include_when condition?
 *
 *  Evaluated against the attributes of the product that was actually
 *  RESOLVED for the line, not against the job or the recipe, so the same
 *  recipe reshapes itself around whatever product the tier landed on. That
 *  is the whole point of the phase.
 *
 *  THE UNKNOWN RULE, which is the part worth arguing about. When the product
 *  simply has no such attribute we cannot evaluate the condition, and the
 *  safe answer depends on what the line IS:
 *
 *    required line  → INCLUDE. Dropping a required part because a tradie
 *                     never tagged a product would put a hole in the quote
 *                     and the customer would be billed for a job missing a
 *                     part. This is the spec's "include-on-unknown so a
 *                     missing attribute never drops a required part".
 *    optional line  → EXCLUDE. Optional lines are upsells (a dimmer for a
 *                     smart light). Adding one on a guess bills the customer
 *                     for something nobody established they need.
 *
 *  A KNOWN mismatch always excludes, required or not. That is not a hole,
 *  it is the condition doing its job: an integrated-driver downlight really
 *  does not need the separate driver line.
 */
export function shouldIncludeLine(
  condition: Record<string, unknown> | null | undefined,
  properties: Record<string, unknown> | null | undefined,
  required: boolean,
): boolean {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return true
  const keys = Object.keys(condition)
  if (keys.length === 0) return true
  const props = properties && typeof properties === 'object' ? properties : {}
  for (const key of keys) {
    const has = Object.prototype.hasOwnProperty.call(props, key)
    const actual = has ? (props as Record<string, unknown>)[key] : undefined
    if (!has || actual === null || actual === '') {
      // Unknown. Required lines stay, optional lines go.
      if (!required) return false
      continue
    }
    if (!attrEquals(actual, condition[key])) return false
  }
  return true
}

/** Loose equality for product attributes. `properties` is jsonb typed by
 *  whoever filled the CSV, so "true"/true/1 all turn up for the same tag and
 *  a strict === would silently fail every condition on a real catalogue. */
function attrEquals(actual: unknown, want: unknown): boolean {
  const norm = (v: unknown): string => {
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    if (typeof v === 'number') return v === 1 ? 'true' : v === 0 ? 'false' : String(v)
    const s = String(v).trim().toLowerCase()
    if (s === 'yes' || s === 'y' || s === '1') return 'true'
    if (s === 'no' || s === 'n' || s === '0') return 'false'
    return s
  }
  return norm(actual) === norm(want)
}

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return NaN
  return typeof v === 'string' ? parseFloat(v) : v
}

/** Round to 2dp the same way applyMarkup()/buildCandidatePrices() do. */
function money(x: number): number {
  return +x.toFixed(2)
}

// ── brand + range -> tier ───────────────────────────────────────────
// A tradie can pin a tier explicitly via tenant_material_catalogue.tier_hint.
// When they haven't, infer from the range/series wording (Clipsal Iconic
// is the premium line; Clipsal 2000 is the standard line, etc.).
const BEST_RANGE = /\b(elite|signature|designer|deluxe|prestige)\b/i
const BETTER_RANGE = /\b(iconic|premium|pro|plus|smart|saturn)\b/i
const GOOD_RANGE = /\b(2000|standard|basic|budget|essential|classic|value|slimline)\b/i

/**
 * Resolve which tier a branded product belongs in.
 * Precedence: explicit hint > range/series keywords > brand keywords > null.
 * `null` means "no opinion" — the estimator treats it as tier-neutral.
 */
export function resolveTierForBrandRange(
  brand?: string | null,
  range?: string | null,
  hint?: Tier | null,
): Tier | null {
  if (hint === 'good' || hint === 'better' || hint === 'best') return hint
  const hay = `${brand ?? ''} ${range ?? ''}`.trim()
  if (!hay) return null
  if (BEST_RANGE.test(hay)) return 'best'
  if (BETTER_RANGE.test(hay)) return 'better'
  if (GOOD_RANGE.test(hay)) return 'good'
  return null
}

// ── tenant-preferred material selection ─────────────────────────────

/** v7 Phase 3 — one entry in a tenant's explicit Good/Better/Best ladder.
 *  Sourced from tenant_tier_ladder (migration 043). */
export interface TierLadderEntry {
  category: string
  tier: Tier
  catalogue_id: string
}

export interface ChooseMaterialInput {
  tenantRows: TenantMaterial[]
  sharedRows: SharedMaterial[]
  category: string
  brand?: string | null
  range?: string | null
  tier?: Tier | null
  /** v7 Phase 3 — when set AND `tier` is set, a (category, tier) ladder
   *  hit beats every other signal. Lets a tradie pin "for downlights at
   *  Better tier, ALWAYS use SAL Anova" even when the model's brand/range
   *  inference would have picked a different row. */
  tierLadder?: TierLadderEntry[]
  /** Phase 4 R3 — the product the CUSTOMER picked from the two options the
   *  SMS offered, and the bucket they saw it in. Anchors that one product
   *  into that one tier; the other tiers resolve their own product for the
   *  category, which is what makes three surviving tiers meaningful.
   *
   *  Beats the tier ladder, deliberately. The two options were generated
   *  FROM this tradie's catalogue, so the tradie already sanctioned every
   *  product on offer — and a pick that visibly changes nothing is worse
   *  than not offering the pick. The ladder still governs the two tiers the
   *  customer did not pick. */
  chosenProduct?: ChosenProductAnchor | null
  /** Phase 4 R11 — this recipe LINE pins an exact product
   *  (tenant_assembly_bom.catalogue_id, migration 185).
   *
   *  R12 precedence: a tier-ladder hit BEATS the pin, because the ladder is
   *  declared per tier while a pin is not. A tier-agnostic pin applied ahead
   *  of the ladder would put the same product on Good, Better and Best and
   *  flatten the quote — the exact failure R4 and R3 were written to fix. */
  pinnedCatalogueId?: string | null
}

/** Phase 4 R3 — the minimum needed to anchor a pick. Deliberately NOT the
 *  whole ChosenProduct: price and render fields play no part in choosing,
 *  and `tier` is optional upstream, so this type makes it required and the
 *  caller does the narrowing. No tier → no anchor → old behaviour. */
export interface ChosenProductAnchor {
  catalogue_id: string
  category: string
  tier: Tier
}

export type ChosenMaterial =
  | { source: 'tenant'; row: TenantMaterial; price: number }
  | { source: 'shared'; row: SharedMaterial; price: number }
  | null

const eqi = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Pick the best material for a category. Operator-owned (active) rows are
 * ALWAYS preferred ahead of generic shared rows (WP2), scored by how
 * tightly they match the requested brand/range/tier. Falls back to shared
 * rows so a tenant who hasn't built a catalogue still gets a quote.
 *
 * v7 Phase 3 precedence: an explicit tier-ladder hit (when input.tier is
 * set AND the tenant declared a ladder for this category+tier) beats the
 * scoring loop. If the ladder row isn't in tenantRows (e.g. recently
 * deleted), we fall through to scoring — preserving the "zero-config
 * still works" guarantee.
 */
export function chooseMaterial(input: ChooseMaterialInput): ChosenMaterial {
  const cat = input.category?.trim().toLowerCase()

  // Phase 4 R3 — the customer's own pick wins, for ITS tier only.
  //
  // This is the half of the original brief that was never built. Before it,
  // applyChosenProduct rewrote the headline line of ALL THREE tiers after
  // the draft was built, so every tier held the same product at the same
  // price — and run.ts collapsed the quote to a single option to hide that.
  // The pick could never change which PARTS a job needed, only relabel one
  // line.
  //
  // Anchoring inside the builder instead means the chosen product occupies
  // its own tier and the other two resolve their own product for the
  // category, so the customer keeps a real choice of three.
  //
  // Scoped hard: only this category, only this tier. A pick for downlights
  // must not decide the safety switch, and must not decide the two tiers
  // the customer did not pick.
  if (input.tier && input.chosenProduct && input.chosenProduct.tier === input.tier) {
    const wantCat = input.chosenProduct.category?.trim().toLowerCase()
    if (wantCat && wantCat === cat) {
      const pickedRow = input.tenantRows.find(
        (r) =>
          r.id === input.chosenProduct!.catalogue_id &&
          Number.isFinite(num(r.unit_price_ex_gst)),
      )
      if (pickedRow) {
        // NOTE no `active` check, unlike the ladder branch below. The
        // customer was SHOWN this product and chose it; a tradie
        // deactivating it between the offer and the quote must not silently
        // swap what they bought. Same reasoning as the validator's M-6.
        return { source: 'tenant', row: pickedRow, price: money(num(pickedRow.unit_price_ex_gst)) }
      }
      // Row gone entirely → fall through. The quote is still built, just
      // without the anchor, and applyChosenProduct remains the backstop.
    }
  }

  // v7 Phase 3 — explicit ladder hit wins.
  if (input.tier && input.tierLadder && input.tierLadder.length > 0) {
    const ladderHit = input.tierLadder.find(
      (e) => e.tier === input.tier && e.category?.trim().toLowerCase() === cat,
    )
    if (ladderHit) {
      const ladderRow = input.tenantRows.find(
        (r) =>
          r.id === ladderHit.catalogue_id &&
          (r.active ?? true) &&
          Number.isFinite(num(r.unit_price_ex_gst)),
      )
      if (ladderRow) {
        return { source: 'tenant', row: ladderRow, price: money(num(ladderRow.unit_price_ex_gst)) }
      }
      // Ladder row not stocked / inactive → fall through to scoring.
    }
  }

  // Phase 4 R11 — the recipe line's own pin. Sits HERE, below the ladder and
  // above scoring, which is R12's stated order:
  //   customer pick (R3) → tier ladder → recipe pin → scoring → shared.
  // The pin is tier-agnostic, so running it above the ladder would give all
  // three tiers the same product; running it below scoring would make it
  // pointless, since scoring always returns something.
  if (input.pinnedCatalogueId) {
    const pinned = input.tenantRows.find(
      (r) =>
        r.id === input.pinnedCatalogueId &&
        (r.active ?? true) &&
        Number.isFinite(num(r.unit_price_ex_gst)),
    )
    if (pinned) {
      return { source: 'tenant', row: pinned, price: money(num(pinned.unit_price_ex_gst)) }
    }
    // Pinned row deleted or deactivated → fall through to scoring rather than
    // fail the line. The FK is ON DELETE SET NULL so a deleted product clears
    // the pin, but a DEACTIVATED one still points here.
  }

  const tenant = input.tenantRows
    .filter((r) => (r.active ?? true) && r.category?.trim().toLowerCase() === cat)
    .filter((r) => Number.isFinite(num(r.unit_price_ex_gst)))
  if (tenant.length > 0) {
    const scored = tenant.map((r) => {
      let s = 1
      if (eqi(r.brand, input.brand)) s += 4
      if (eqi(r.range_series, input.range)) s += 4
      const rowTier = resolveTierForBrandRange(r.brand, r.range_series, r.tier_hint ?? null)
      if (input.tier && rowTier === input.tier) s += 2
      // "My go-to product" — a SOFT +1 tiebreaker only. Deliberately
      // below brand (+4), range (+4) and tier (+2) so it can ONLY decide
      // between rows that are otherwise an equal match; it never pulls
      // the estimator off an exact brand/range/tier hit.
      if (r.is_preferred === true) s += 1
      return { r, s }
    })
    scored.sort((a, b) => b.s - a.s)
    const best = scored[0].r
    return { source: 'tenant', row: best, price: money(num(best.unit_price_ex_gst)) }
  }
  const shared = input.sharedRows
    .filter((r) => !r.category || r.category.trim().toLowerCase() === cat)
    .map((r) => ({ r, price: num(r.unit_price_ex_gst ?? r.default_unit_price_ex_gst) }))
    .filter((x) => Number.isFinite(x.price))
  if (shared.length === 0) return null
  // An explicitly requested brand is a STATED preference — it outranks an
  // inferred tier.
  const brandHit = shared.find((x) => eqi(x.r.brand, input.brand))
  if (brandHit) return { source: 'shared', row: brandHit.r, price: money(brandHit.price) }

  // Phase 4 R4 — honour the tier. This path used to take `shared[0]` and
  // ignore `input.tier` entirely, so a tenant with an empty catalogue got the
  // SAME shared product at the SAME price for Good, Better and Best. Three
  // identical tiers read to the customer as one option, and the collapse at
  // run.ts then made that literal.
  //
  // Price-sort ascending, then index: Good cheapest, Best dearest, Better
  // between. Fewer candidates than tiers simply share — one row serves all
  // three rather than returning null, because a quote with a product beats no
  // quote.
  const byPrice = [...shared].sort((a, b) => a.price - b.price)
  const last = byPrice.length - 1
  const idx =
    input.tier === 'good' ? 0
    : input.tier === 'best' ? last
    : input.tier === 'better' ? Math.min(last, Math.ceil(last / 2))
    : -1
  // No tier stated: unchanged behaviour, first matching row in source order.
  const pick = idx >= 0 ? byPrice[idx] : shared[0]
  return { source: 'shared', row: pick.r, price: money(pick.price) }
}

// ── global-vs-local override resolution ─────────────────────────────
export interface ResolvedParam<T> {
  value: T
  source: 'local' | 'global'
  /** Phase 5b — set when a local override EXISTED and was DROPPED for being
   *  out of range. Without it, `source: 'global'` means two different things —
   *  "the tradie set nothing" and "the tradie set something absurd and we
   *  ignored it" — and the second must be visible or a typo goes unnoticed
   *  until it lands on a customer's quote. */
  dropped?: string
}
/** Local override wins when present (non-null, and finite for numbers). */
export function resolveParam<T>(globalVal: T, localOverride: T | null | undefined): ResolvedParam<T> {
  if (localOverride === null || localOverride === undefined) {
    return { value: globalVal, source: 'global' }
  }
  if (typeof localOverride === 'number' && !Number.isFinite(localOverride)) {
    return { value: globalVal, source: 'global' }
  }
  return { value: localOverride, source: 'local' }
}

export interface AssemblyOverride {
  labour_hours_override?: number | string | null
  markup_pct_override?: number | string | null
}
export interface EffectiveAssembly {
  labourHours: ResolvedParam<number>
  markupPct: ResolvedParam<number>
}
/** Fold a global assembly + a per-tenant override into the effective params
 *  the estimator should use AND the dashboard should display.
 *  v7 Phase 0: `enabled` was removed — it lived on tenant_assembly_overrides
 *  but nothing wrote to it. The Services-tab toggle writes
 *  tenant_service_offerings.enabled instead, and that is now the single
 *  source of truth (read by /api/tenant/me AND /api/tenant/estimation). */

// ── Phase 5b — read-time bounds on tenant overrides, drop not clamp ──────
//
// Until now effectiveAssembly accepted ANY finite override. A tradie who typed
// 800 meaning 8.00 got 800 labour hours on the quote, and 2500 meaning 25.00
// got a 2500% markup. Nothing in between caught it: checkSanityBounds only
// fires when the job type has a job_type_bounds row, and that table covers 5 of
// 14 live job types.
//
// DROP, NOT CLAMP — the spec is explicit and it is the right call. Clamping 800
// to 40 ships a price nobody chose and looks deliberate. Dropping falls back to
// the global default, which is a number a human actually set, and records WHY
// so the bad row can be fixed.
//
// These are absolute sanity rails, not business policy. They exist to catch
// data entry that is off by a factor of a hundred, so they are deliberately
// loose: a real assembly can genuinely take a long day, and a real markup can
// genuinely be high. Anything past these is a typo, not a pricing strategy.
/** One assembly line needing more than a working week is a typo, not a job. */
const OVERRIDE_LABOUR_HOURS_MAX = 40
/** Above this the tradie has typed cents-as-percent (2500 for 25.00). */
const OVERRIDE_MARKUP_PCT_MAX = 300

function boundedOverride(
  raw: number,
  max: number,
  label: string,
  unit: string,
): { ok: true; value: number } | { ok: false; reason: string } {
  if (!Number.isFinite(raw)) return { ok: false, reason: `${label} override is not a number` }
  if (raw < 0) return { ok: false, reason: `${label} override ${raw}${unit} is negative` }
  if (raw > max) {
    return { ok: false, reason: `${label} override ${raw}${unit} exceeds the ${max}${unit} sanity limit` }
  }
  return { ok: true, value: raw }
}

export function effectiveAssembly(
  globalLabourHours: number | string,
  globalMarkupPct: number | string,
  override?: AssemblyOverride | null,
): EffectiveAssembly {
  const lhRaw = override ? num(override.labour_hours_override) : NaN
  const muRaw = override ? num(override.markup_pct_override) : NaN

  // An ABSENT override is not a dropped one. Only validate a value the tradie
  // actually set, so a blank column keeps reading as plain 'global'.
  const lhSet = override != null && override.labour_hours_override != null
  const muSet = override != null && override.markup_pct_override != null

  const lh = lhSet ? boundedOverride(lhRaw, OVERRIDE_LABOUR_HOURS_MAX, 'labour hours', 'h') : null
  const mu = muSet ? boundedOverride(muRaw, OVERRIDE_MARKUP_PCT_MAX, 'markup', '%') : null

  const labourHours: ResolvedParam<number> =
    lh && lh.ok
      ? resolveParam(num(globalLabourHours), lh.value)
      : { value: num(globalLabourHours), source: 'global', ...(lh ? { dropped: lh.reason } : {}) }

  const markupPct: ResolvedParam<number> =
    mu && mu.ok
      ? resolveParam(num(globalMarkupPct), mu.value)
      : { value: num(globalMarkupPct), source: 'global', ...(mu ? { dropped: mu.reason } : {}) }

  return { labourHours, markupPct }
}

// ── structured BOM -> deterministic quote lines (WP3) ───────────────
export interface QuoteLine {
  description: string
  quantity: number
  unit: string
  unit_price_ex_gst: number
  total_ex_gst: number
  source: string
  /** WP4 — which operator catalogue product priced this line (render
   *  reference). Render-only metadata: NEVER read by the grounding
   *  validator or any price math, so it cannot affect money/routing. */
  catalogue_id?: string | null
  image_path?: string | null
  /** Operator's catalogue blurb for this product (render-only, same
   *  no-money guarantee as catalogue_id/image_path). */
  product_description?: string | null
}
export interface BuildBomInput {
  bom: BomLine[]
  /** Resolve a marked-up unit price + display name for a BOM line.
   *  Injected so this stays DB-free and unit-testable. Return null when the
   *  line cannot be priced (caller routes to inspection). The optional
   *  catalogue_id/image_path are WP4 render metadata only — they never
   *  influence price.
   *
   *  Phase 4 R10 — takes the whole line, not just `material_category`. A bare
   *  category discards everything else on the row, which is why a line could
   *  not pin a specific product (R11) or carry an include_when condition (R7).
   *  Existing resolvers ignore the extra fields, so this is behaviour-neutral. */
  resolveMaterial: (line: BomLine) => {
    name: string
    markedUpPrice: number
    catalogue_id?: string | null
    image_path?: string | null
    /** Phase 4 R7 — the resolved product's own attributes, so include_when
     *  can be judged against the product that actually landed on this tier
     *  rather than against the recipe. Absent on shared-material fallbacks,
     *  which have no attributes; that reads as "unknown" and the required
     *  line is kept. */
    properties?: Record<string, unknown> | null
  } | null
  labourHours: number
  labourRate: number
  includeOptional?: boolean
}
export interface BuildBomResult {
  lines: QuoteLine[]
  /** Phase 4 R9 — the HEADLINE product's attributes, the same ones the R7
   *  include_when conditions were judged against.
   *
   *  Returned rather than stamped onto QuoteLine on purpose. The tier jsonb is
   *  persisted on the quotes row and rendered to customers, so putting product
   *  tags on every line would persist and expose data no quote surface needs.
   *  The caller wants it for ONE decision — which steps this tier earns — so it
   *  travels as a result field.
   *
   *  null when nothing unconditional and non-sundry could be priced. */
  headlineProperties?: Record<string, unknown> | null
  /** Required BOM categories that could not be priced — non-empty means
   *  the caller should route the quote to inspection rather than ship a
   *  hole. Mirrors the grounding validator's safe-failure philosophy. */
  missingRequired: string[]
}
/**
 * Build the same quote lines for the same job every time (WP3): walk the
 * structured BOM in order, price each line via the injected resolver, add
 * a single labour line. No model free-association — deterministic.
 */
export function buildBomQuoteLines(input: BuildBomInput): BuildBomResult {
  const lines: QuoteLine[] = []
  const missingRequired: string[] = []
  const sorted = [...input.bom]
  // resolveMaterial is called once per line at most. The headline scan below
  // needs a resolution before the main loop reaches that line, and a reviewer
  // rightly pointed out that resolving twice assumes purity of every injected
  // resolver forever. Memoised on line identity instead of assuming.
  const resolved = new Map<BomLine, ReturnType<BuildBomInput['resolveMaterial']>>()
  const resolve = (b: BomLine) => {
    if (!resolved.has(b)) resolved.set(b, input.resolveMaterial(b))
    return resolved.get(b)!
  }

  const isSundryLine = (b: BomLine) =>
    SUNDRY_RE.test(String(b.material_category ?? '')) || SUNDRY_RE.test(String(b.description ?? ''))
  const isRatioLine = (b: BomLine) => {
    const per = Number(b.quantity_per)
    return Number.isFinite(per) && per > 0
  }
  /** Will this line actually end up on the quote? */
  const willShip = (b: BomLine) => {
    if (!b.include_when && !(b.required ?? true) && !input.includeOptional) return false
    const q = num(b.quantity)
    return Number.isFinite(q) && q > 0
  }

  // Phase 4 R7 — resolve the HEADLINE product first, because that is what the
  // conditions are about.
  //
  // R7's wording says include_when is judged against "the resolved product",
  // which reads as the product for THAT line. R9's acceptance scenarios say
  // otherwise, and they are the concrete requirement: "a smart product adds
  // its dimmer part", "an integrated_driver product drops the separate driver
  // line". The smart thing is the DOWNLIGHT, not the dimmer; the integrated
  // driver is a property of the DOWNLIGHT, not of the driver line being
  // dropped. Judged per line, both scenarios are unexpressible — the driver
  // row has no integrated_driver tag and never will.
  //
  // ⚠ THE CANDIDATE MUST BE A LINE THAT ACTUALLY SHIPS. Review of the first
  // version found this scan filtering on include_when and SUNDRY_RE alone,
  // which let it pick an OPTIONAL line that the short-circuit then dropped, or
  // a quantity_per RATIO line. Either way every condition on the job was
  // judged against a product that was never priced, never shown and never
  // billed — and with missingRequired empty the quote shipped silently. A
  // dropped smart hub claiming integrated_driver removed a driver the
  // downlight genuinely needed.
  //
  // Four filters, each load-bearing:
  //   · no condition of its own — a conditional line cannot be the thing
  //     conditions are measured against without the definition eating itself
  //   · not a ratio line — scaleBomToItemCount already excludes those from
  //     headline consideration and the two must agree on what the job is
  //   · not a sundry — tape is not the job
  //   · willShip — it has to be on the quote to describe it
  // Picked in `sort` order, matching scaleBomToItemCount, so a caller that
  // maps or concatenates cannot change the answer.
  const headlineProps: Record<string, unknown> | null = (() => {
    const bySort = [...sorted].sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
    for (const b of bySort) {
      if (b.include_when || isRatioLine(b) || isSundryLine(b) || !willShip(b)) continue
      const m = resolve(b)
      if (m) return m.properties ?? null
    }
    return null
  })()

  for (const b of sorted) {
    const required = b.required ?? true
    // A line that states a condition is governed BY that condition, not by
    // the blunt optional/includeOptional rule. Without this an optional
    // conditional line (the dimmer) could never be added, because the
    // short-circuit would drop it before the condition was read.
    if (!b.include_when && !required && !input.includeOptional) continue

    // Phase 4 R7 — THE CONDITION IS EVALUATED FIRST, ahead of both the
    // quantity guard and the resolver.
    //
    // Review found it running last, which meant a required line the condition
    // would have DROPPED still had to be priceable: the resolver returned null
    // for a category nothing stocks, the line went to missingRequired, and
    // buildDeterministicTiers returned {tiers:null} — routing a correct quote
    // to the $99 inspection. Production made that certain, not theoretical:
    // no driver or dimmer product exists in shared_materials or any tenant
    // catalogue, so the first tradie to seed the R9 condition this phase
    // exists to support would have broken every integrated-driver quote.
    //
    // A condition whose whole meaning is "this part is not needed" cannot
    // require the part to be priceable, or to have a sane quantity, first.
    //
    // An excluded line is NOT missingRequired: the condition was evaluated and
    // the part is genuinely not needed.
    if (!shouldIncludeLine(b.include_when, headlineProps, required)) continue

    const qty = num(b.quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      if (required) missingRequired.push(b.material_category)
      continue
    }
    const m = resolve(b)
    if (!m) {
      if (required) missingRequired.push(b.material_category)
      continue
    }
    const unitPrice = money(m.markedUpPrice)
    lines.push({
      description: b.description?.trim() || m.name,
      quantity: qty,
      unit: 'each',
      unit_price_ex_gst: unitPrice,
      total_ex_gst: money(unitPrice * qty),
      source: 'material',
      // WP4 — stamp the priced product so the render can show it.
      ...(m.catalogue_id ? { catalogue_id: m.catalogue_id } : {}),
      ...(m.image_path ? { image_path: m.image_path } : {}),
    })
  }
  const lh = num(input.labourHours)
  const lr = num(input.labourRate)
  if (Number.isFinite(lh) && lh > 0 && Number.isFinite(lr)) {
    lines.push({
      description: 'Labour',
      quantity: lh,
      unit: 'hr',
      unit_price_ex_gst: money(lr),
      total_ex_gst: money(lh * lr),
      source: 'labour',
    })
  }
  return { lines, missingRequired, headlineProperties: headlineProps }
}

// ── validator-acceptance feed (the WP2 "trap") ──────────────────────
/**
 * Flatten a tenant's catalogue into the {id, name, price} rows that
 * run.ts loadCandidatePrices feeds to buildCandidatePrices(), so a
 * branded tenant-priced line grounds instead of being dumped to
 * inspection. Includes the customer-supply price variant when set.
 * Pure so the acceptance logic is tested here, ahead of the wiring.
 *
 * R-2 (2026-05-25) — emits `id` so the validator's strict UUID path
 * can index candidates by row id. Both the regular-price and the
 * customer-supply-price variant share the SAME id (same DB row).
 *
 * M-6 follow-up (2026-05-25) — the `r.active === false` filter is
 * GONE. SQL-side filter was already dropped to close the deactivation
 * race; the JS-side filter here was undoing that. A row a tradie
 * deactivates seconds after Opus grounded on it now still validates,
 * so the otherwise-correct draft doesn't dump to a $99 inspection.
 * (The lookup tool keeps active=true at draft time, so no new quote
 * can REACH a deactivated row — only the validator forgives.)
 */
export function catalogueCandidateRows(
  tenantRows: TenantMaterial[],
): Array<{ id: string | null; name: string; price: number; category: string | null }> {
  const out: Array<{ id: string | null; name: string; price: number; category: string | null }> = []
  for (const r of tenantRows) {
    const p = num(r.unit_price_ex_gst)
    const category = r.category ?? null
    const id = r.id ?? null
    if (Number.isFinite(p) && p > 0) out.push({ id, name: r.name, price: money(p), category })
    const cs = num(r.customer_supply_price_ex_gst)
    if (Number.isFinite(cs) && cs > 0) out.push({ id, name: r.name, price: money(cs), category })
  }
  return out
}

// ── soft prompt hints (WP2 brand/range, WP3 structured BOM) ─────────
// Both are SOFT hints appended to the user message — the grounding
// validator still enforces correctness regardless. Empty input -> null
// so legacy/no-catalogue tenants and an unseeded BOM table change
// nothing (additive, no regression).

export interface CatalogueHintRow {
  category: string
  name: string
  brand?: string | null
  range_series?: string | null
  tier_hint?: Tier | null
}
/** "Prefer THESE exact products, mapped to the tier shown" — makes the
 *  operator's brand+range catalogue (WP2) visible to the model. */
export function formatCatalogueHint(rows: CatalogueHintRow[]): string | null {
  const valid = rows.filter((r) => r?.category && r?.name)
  if (valid.length === 0) return null
  const byCat = new Map<string, string[]>()
  for (const r of valid) {
    const tier = resolveTierForBrandRange(r.brand, r.range_series, r.tier_hint ?? null)
    const label = [r.brand, r.range_series].filter(Boolean).join(' ')
    const desc = `${r.name}${label ? ` (${label})` : ''}${tier ? ` -> ${tier}` : ''}`
    const arr = byCat.get(r.category) ?? []
    arr.push(desc)
    byCat.set(r.category, arr)
  }
  const lines = [...byCat.entries()].map(([cat, items]) => `  • ${cat}: ${items.join('; ')}`)
  return [
    "Tradie operator catalogue (prefer THESE exact products; brand+range maps to the tier shown):",
    ...lines,
    "Pick the catalogue row that fits the customer's tier/spec; grounding validation runs regardless.",
  ].join('\n')
}

/** v7 Phase 3 — one row of a tenant's explicit Good/Better/Best ladder
 *  for prompt-time soft hinting (formatTierLadderHint). The product_name
 *  + brand are denormalised from the tenant_material_catalogue row that
 *  catalogue_id points to so the helper stays DB-free. */
export interface TierLadderHintRow {
  category: string
  tier: Tier
  product_name: string
  brand?: string | null
}

/** "MUST use these products for the named tier" — the strongest soft
 *  hint we surface, designed to be paired with formatCatalogueHint()
 *  (which lists the wider catalogue) and formatBomHint() (which lists
 *  the BOM). The grounding validator still has the final say. */
export function formatTierLadderHint(rows: TierLadderHintRow[]): string | null {
  const valid = rows.filter((r) => r?.category && r?.tier && r?.product_name)
  if (valid.length === 0) return null
  const TIER_ORDER: Record<Tier, number> = { good: 0, better: 1, best: 2 }
  const byCat = new Map<string, TierLadderHintRow[]>()
  for (const r of valid) {
    const arr = byCat.get(r.category) ?? []
    arr.push(r)
    byCat.set(r.category, arr)
  }
  const lines = [...byCat.entries()].map(([cat, items]) => {
    const sorted = [...items].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier])
    const labels = sorted.map((i) => {
      const brand = i.brand ? ` (${i.brand})` : ''
      return `${i.tier}=${i.product_name}${brand}`
    })
    return `  • ${cat}: ${labels.join('; ')}`
  })
  return [
    "Tradie's EXPLICIT Good/Better/Best ladder (use these exact products for the named tier):",
    ...lines,
  ].join('\n')
}

export interface BomHintRow {
  material_category: string
  quantity: number | string
  required?: boolean | null
  description?: string | null
}

// ── Phase 2 R4 · recipe quantities follow the customer's count ──────
/**
 * Set the HEADLINE line's quantity to `itemCount`, leaving every other line at
 * its recipe quantity.
 *
 * Migration 118 seeds `downlight ×6`; nothing read `intake.scope.item_count`,
 * so a customer asking for 10 got materials for 6.
 *
 * REPLACE, not multiply — the recipe quantity is a per-job default for the main
 * product, so 6 with a count of 10 is 10, never 60. Only the headline line
 * moves: a job needs one roll of tape whether it is 6 downlights or 10. That is
 * the same rule the reconcile backstop already applies via
 * findHeadlineMaterialIndex ("which line's quantity should equal item_count"),
 * reused deliberately so the two cannot disagree.
 *
 * Headline = the first row in `sort` order whose category/description is not a
 * sundry, matched with the SUNDRY_RE the backstop uses. A sundries-only recipe
 * has no headline and is returned untouched.
 *
 * A missing, zero, negative, fractional, absurd (>10k, the schema's own cap) or
 * non-finite count is ignored — today's behaviour is preserved rather than a
 * junk quantity reaching a quote. Pure; never mutates the input.
 */
export function scaleBomToItemCount<
  T extends {
    material_category: string
    quantity: number | string
    sort?: number | null
    quantity_per?: number | string | null
  },
>(rows: readonly T[], itemCount: number | null | undefined): T[] {
  const out = rows.map((r) => ({ ...r }))
  const n = Number(itemCount)
  if (!Number.isInteger(n) || n <= 0 || n > 10_000) return out

  // Phase 4 R8 — ratio lines scale by division, not replacement.
  //
  // Applied here rather than in buildBomQuoteLines because this function is
  // where item_count lives, and because BOTH pricing paths already call it:
  // putting it in the builder would leave the Opus hint path with the wrong
  // quantity and the two paths silently disagreeing.
  //
  // ceil, not round: one driver per four lights with ten lights needs THREE
  // drivers. Rounding gives 2.5 → 2 and the job is short a driver.
  //
  // A ratio line is scaled and then skipped for headline consideration —
  // "one driver per four lights" is never the headline of the job.
  const ratioIdx = new Set<number>()
  out.forEach((r, i) => {
    const per = Number(r.quantity_per)
    if (Number.isFinite(per) && per > 0) {
      out[i] = { ...out[i], quantity: Math.ceil(n / per) }
      ratioIdx.add(i)
    }
  })

  const isSundry = (r: T & { description?: string | null }) =>
    SUNDRY_RE.test(String(r.material_category ?? '')) ||
    SUNDRY_RE.test(String(r.description ?? ''))

  // Pick by `sort`, not array order — the API returns sorted rows but a caller
  // that maps or concatenates could hand them over shuffled.
  const bySort = out
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Number(a.r.sort ?? 0) - Number(b.r.sort ?? 0))
  const headline = bySort.find(
    ({ r, i }) => !ratioIdx.has(i) && !isSundry(r as T & { description?: string | null }),
  )
  if (!headline) return out

  out[headline.i] = { ...out[headline.i], quantity: n }
  return out
}
/** "Standard bill of materials for this job" — makes WP3's structured
 *  BOM visible so the same job quotes the same parts every time. */
export function formatBomHint(rows: BomHintRow[]): string | null {
  const valid = rows.filter((r) => r?.material_category && Number(num(r.quantity)) > 0)
  if (valid.length === 0) return null
  const lines = valid.map((r) => {
    const opt = (r.required ?? true) ? '' : ' (optional)'
    const d = r.description ? ` ${r.description}` : ''
    return `  • ${num(r.quantity)} x ${r.material_category}${d}${opt}`
  })
  return [
    'Standard bill of materials for this job (quote these parts consistently every time):',
    ...lines,
    'These are the baseline parts. Price each from the catalogue / shared materials.',
  ].join('\n')
}

// ── Catalogue ↔ Recipe coverage (Phase 1 sync visibility) ───────────
// The estimator joins a Recipe line to a Catalogue product by matching
// their category strings. If those strings don't line up, the tradie's
// real product + price is silently dropped and the line falls back to a
// generic price (or inspection). These helpers are the ONE definition of
// "same category" so the dashboard badge — and any future estimator-side
// check — agree. Pure; unit-tested in catalogue.test.ts.

/** Trim + lowercase, the single canonical category comparison form. */
export function normaliseCategory(c: string | null | undefined): string {
  return (c ?? '').trim().toLowerCase()
}

/**
 * True when the tradie has at least one priced, active catalogue product
 * in this recipe line's category. Drives the Recipes "priced from your
 * catalogue" vs "no product — generic price" badge so a silent
 * Catalogue↔Recipe category mismatch becomes visible instead of quietly
 * costing the operator their real product and price.
 */
export function categoryHasCatalogueProduct(
  recipeCategory: string | null | undefined,
  catalogueCategories: Array<string | null | undefined>,
): boolean {
  const target = normaliseCategory(recipeCategory)
  if (!target) return false
  return catalogueCategories.some((c) => normaliseCategory(c) === target)
}

// ── WP4 — link quote lines back to the catalogue product ────────────
// The Opus draft writes line items as free text ("Caroma Liano tap").
// AFTER grounding has PASSED, match each material line back to the
// operator catalogue row that priced it (by normalised name) and stamp
// catalogue_id + image_path so the render step can show THE EXACT
// product. This is render-only metadata: it runs after pricing +
// validation, never touches a price/total/route, and only fills fields
// that are MISSING (so the deterministic path's own stamping always
// wins and the helper is idempotent). Pure; unit-tested.

export interface CatalogueProductRef {
  id?: string | null
  name: string
  image_path?: string | null
  /** Operator's own product blurb — carried to the render prompt. */
  description?: string | null
}

export interface EnrichResult {
  draft: any
  /** How many line items got an operator product linked (for logging). */
  linked: number
}

/** Canonical product-name comparison form (trim + lowercase + collapse
 *  internal whitespace) so "Caroma  Liano Tap" == "caroma liano tap". */
function normaliseName(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function enrichLinesWithCatalogue(
  draft: any,
  catalogue: CatalogueProductRef[],
): EnrichResult {
  if (!draft || draft.needs_inspection === true) return { draft, linked: 0 }
  const byName = new Map<string, CatalogueProductRef>()
  for (const p of catalogue ?? []) {
    const k = normaliseName(p?.name)
    if (k && !byName.has(k)) byName.set(k, p)
  }
  if (byName.size === 0) return { draft, linked: 0 }

  let linked = 0
  for (const tierKey of ['good', 'better', 'best'] as const) {
    const tier = draft[tierKey] as
      | { line_items?: Array<Record<string, unknown>> }
      | null
      | undefined
    if (!tier || !Array.isArray(tier.line_items)) continue
    for (const li of tier.line_items) {
      if (!li) continue
      const src = li.source
      if (src === 'labour' || src === 'call_out') continue
      // Never overwrite an explicit link — the deterministic builder
      // already stamped the exact source product.
      if (li.catalogue_id) continue
      const hit = byName.get(normaliseName(li.description as string))
      if (!hit) continue
      if (hit.id) li.catalogue_id = hit.id
      if (hit.image_path) li.image_path = hit.image_path
      // Render-only blurb; only fill when the line doesn't already have
      // one (deterministic / WP9 stamping always wins). Never priced.
      if (
        hit.description &&
        String(hit.description).trim() !== '' &&
        !li.product_description
      ) {
        li.product_description = String(hit.description).trim()
      }
      if (hit.id || hit.image_path) linked++
    }
  }
  return { draft, linked }
}

// ── WP9 — force the customer's mid-chat pick into the quote ─────────
// When a customer chose a specific operator product, the quote MUST
// show THAT product at THAT catalogue price with THAT photo — not a
// generic line. enrichLinesWithCatalogue only *links by name*; this
// goes further and overwrites the headline material line of each
// priced tier with the chosen product. Runs AFTER grounding: the price
// is the operator's own catalogue price (the WP2-guaranteed legitimate
// price the customer literally selected), so this is consistent with
// the money model — same "adjust the locked draft" pattern as
// applyMinLabourFloor. Pure; unit-tested. No-op when nothing chosen.

export interface ChosenProductInput {
  catalogue_id: string
  name: string
  price_ex_gst: number
  image_path?: string | null
  /** Operator's own product blurb (render-only context for WP4). */
  description?: string | null
  /** Structured specs of the chosen product — read by the reconcile guard
   *  (run.ts), never by price math. Optional; guard degrades when absent. */
  properties?: Record<string, string | number | boolean | null> | null
}
export interface ApplyChosenResult {
  draft: any
  /** Tiers whose headline line was set to the chosen product. */
  applied: string[]
}

const SUNDRY_RE = /sundr|seal|tape|\bclip\b|terminal|^fittings,/i

/**
 * Index of a tier's "headline" material line — the non-sundry, non-labour line
 * that represents the main product (downlight, GPO, tap…). Used by
 * applyChosenProduct (which line to overwrite with the customer's pick) and by
 * the reconcile backstop (which line's quantity should equal item_count).
 * Prefers a non-sundry material line; falls back to any non-labour line; -1 if
 * none. Pure.
 */
/**
 * Did the TRADIE pin this product from the dashboard job quoter, rather than a
 * CUSTOMER picking it mid-SMS?
 *
 * The two want opposite tier behaviour. A customer pick means they chose, so
 * collapsing to the one option they picked is the honest render. A tradie pin
 * lands on a quote held for their review, and TierSelect renders nothing below
 * two priced tiers — so collapsing would delete the only tier control on the
 * page the review gate exists to serve.
 *
 * Pure and exported so the rule is testable; the alternative is an inline
 * condition buried in run.ts that nothing can assert.
 */
export function isTradiePin(chosen: { pinned_by?: unknown } | null | undefined): boolean {
  return chosen?.pinned_by === 'tradie'
}

export function findHeadlineMaterialIndex(
  items: Array<Record<string, any>> | null | undefined,
): number {
  if (!Array.isArray(items)) return -1
  const notLabour = (li: any) => li && li.source !== 'labour' && li.source !== 'call_out'
  let idx = items.findIndex(
    (li) => notLabour(li) && !SUNDRY_RE.test(String(li?.description ?? '')),
  )
  if (idx < 0) idx = items.findIndex((li) => notLabour(li))
  return idx
}

export function applyChosenProduct(
  draft: any,
  chosen: ChosenProductInput | null | undefined,
): ApplyChosenResult {
  if (!draft || draft.needs_inspection === true || !chosen) return { draft, applied: [] }
  const price = Number(chosen.price_ex_gst)
  if (!Number.isFinite(price) || price < 0 || !chosen.name) return { draft, applied: [] }
  const unitPrice = +price.toFixed(2)
  const applied: string[] = []

  // Helper: does this line already reference the chosen catalogue product?
  // Same key (catalogue_id OR a "material:<uuid>" source ending in the
  // chosen id) used for both pre-rewrite "pick the right line to overwrite"
  // AND post-rewrite "purge any sibling lines that point at the SAME
  // product". The dedup key is `catalogue_id` (a stable SKU id) — never
  // description text — so it cannot collapse legitimately-different lines.
  // (NB: if a tradie ever splits one SKU across two intentional line items
  //  e.g. "5 downlights — kitchen" + "5 downlights — bathroom", this would
  //  merge them. Today's policy — declared by the D-1 dedup guard's own
  //  failure message — is one row per SKU per tier, qty=N on a single
  //  line; this fix is in keeping with that.)
  const refsChosenProduct = (li: any): boolean => {
    if (!li || !chosen.catalogue_id) return false
    if (li.catalogue_id != null && String(li.catalogue_id) === String(chosen.catalogue_id)) {
      return true
    }
    const src = String(li.source ?? '')
    if (src.startsWith('material:') && src.endsWith(String(chosen.catalogue_id))) {
      return true
    }
    return false
  }

  for (const tierKey of ['good', 'better', 'best'] as const) {
    const tier = draft[tierKey] as
      | { line_items?: Array<Record<string, any>>; subtotal_ex_gst?: number | string; label?: string }
      | null
      | undefined
    if (!tier || !Array.isArray(tier.line_items) || tier.line_items.length === 0) continue
    const items = tier.line_items
    // IDEMPOTENCY (2026-05-29) — if Opus has already emitted the chosen
    // product (typical happy path now that the tool returns the UUID-
    // anchored source), overwrite THAT line in place. Otherwise the
    // headline-overwrite below would rewrite an UNRELATED non-sundry line
    // (e.g. cable runs, ceiling cuts) into the chosen product, leaving
    // the original chosen-product line untouched → two lines for the
    // same product in the same tier (the Atomic 5ad1ca16 / ca7ded23
    // incident, 2026-05-28).
    let idx = items.findIndex(refsChosenProduct)
    // Prefer the headline (non-sundry) material line; else any material line.
    if (idx < 0) idx = findHeadlineMaterialIndex(items)
    if (idx < 0) continue

    const li = items[idx]
    const qty = Number(li.quantity)
    const q = Number.isFinite(qty) && qty > 0 ? qty : 1
    li.description = chosen.name
    li.unit = li.unit || 'each'
    li.quantity = q
    li.unit_price_ex_gst = unitPrice
    li.total_ex_gst = +(unitPrice * q).toFixed(2)
    // Emit the SAME UUID-anchored source shape the validator's strict path
    // expects, so a future regression that reintroduces a duplicate would
    // be caught by D-1 on the first validate pass (defense in depth).
    li.source = chosen.catalogue_id ? `material:${chosen.catalogue_id}` : 'material'
    li.catalogue_id = chosen.catalogue_id
    if (chosen.image_path) li.image_path = chosen.image_path
    // Render-only product blurb (same guarantee as image_path /
    // catalogue_id: never read by the validator or any price math).
    // Fed to the WP4 image prompt so Gemini knows WHAT the product is,
    // not just its photo.
    if (chosen.description && String(chosen.description).trim() !== '') {
      li.product_description = String(chosen.description).trim()
    }

    // Keep the tier label consistent with the headline line we just
    // rewrote. Opus generated the label around the DEFAULT tier product;
    // once the customer's explicit pick is forced into the line item, a
    // stale label names a product the quote no longer contains — the
    // customer SMS and /q page would show the wrong product name. The
    // label must always match the chosen product.
    tier.label = chosen.name

    // POST-REWRITE DEDUP (2026-05-29) — purge any OTHER line that points
    // at the same catalogue product. Trust the chosen-product price
    // (it's the operator's own catalogue price the customer literally
    // selected, WP2-guaranteed legitimate) and drop the strays. Keeps
    // order stable; runs in-place; never touches non-material lines.
    for (let j = items.length - 1; j >= 0; j--) {
      if (j === idx) continue
      if (refsChosenProduct(items[j])) {
        items.splice(j, 1)
        if (j < idx) idx-- // keep the rewritten line's index valid
      }
    }

    tier.subtotal_ex_gst = +items
      .reduce((s, x) => s + (Number(x?.total_ex_gst) || 0), 0)
      .toFixed(2)
    applied.push(tierKey)
  }
  return { draft, applied }
}
