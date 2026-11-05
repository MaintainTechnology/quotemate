// ════════════════════════════════════════════════════════════════════
// Phase 2 — DETERMINISTIC BOM TIER BUILDER ("same job = same parts =
// your prices, every time").
//
// THE PROBLEM IT SOLVES: today a tenant Recipe (tenant_assembly_bom)
// and Catalogue (tenant_material_catalogue) are only SOFT hints to
// Opus — it can ignore them, so the same job can quote differently
// twice. WP3 asks for the opposite: a job with a curated recipe +
// priced catalogue must produce identical good/better/best line items
// every time, at the operator's own prices.
//
// THE DESIGN (safe by construction):
//   • PURE + DB-free. run.ts loads the inputs from Supabase and passes
//     them in; this module just composes the already-tested primitives
//     (chooseMaterial + buildBomQuoteLines from ./catalogue).
//   • Per tier, pick the catalogue product whose brand/range resolves
//     to THAT tier (good/better/best); fall back exactly as
//     chooseMaterial already does (shared materials) so a half-built
//     catalogue still quotes.
//   • Markup is applied at the tradie's configured default_markup_pct —
//     the SAME band the grounding validator accepts (default ±5pp), so
//     a deterministic line grounds instead of being bounced.
//   • Returns null (with a reason) whenever it cannot honour the job
//     safely (no recipe / a required category cannot be priced / no
//     usable hourly rate). run.ts then leaves Opus's draft untouched —
//     ZERO regression, never a hole.
//   • The existing grounding validator STILL runs on the output in
//     run.ts. If this builder's math ever drifted, the quote
//     self-corrects to the $99 inspection — the same safety envelope
//     as the Opus path. This module can never ship an ungrounded price.
//
// Unit-tested in deterministic-bom.test.ts.
// ════════════════════════════════════════════════════════════════════

import {
  chooseMaterial,
  chooseTenantMaterial,
  buildBomQuoteLines,
  type TenantMaterial,
  type SharedMaterial,
  type BomLine,
  type Tier,
  type QuoteLine,
  type TierLadderEntry,
  type ChosenProductAnchor,
  resolveTierForBrandRange,
} from './catalogue'
import {
  calculateAuthoritativeQuote,
  exactMarkedUpCents,
  exactPriceCents,
  exactDecimalNumber,
  type ApprovedQuoteSource,
  type QuoteCalculation,
  type QuoteCoreFailureCode,
  type QuoteServiceMode,
} from './quote-core'

const TIERS: Tier[] = ['good', 'better', 'best']

function money(x: number): number {
  return +x.toFixed(2)
}

export interface DeterministicTierInput {
  /** Tenant recipe lines for the matched job (category × qty, required). */
  bom: BomLine[]
  /** This tenant's active catalogue rows (caller pre-filters active). */
  tenantMaterials: TenantMaterial[]
  /** shared_materials rows for the trade — the fallback price source. */
  sharedMaterials: SharedMaterial[]
  /** Effective labour hours for the job (assembly default + any override). */
  labourHours: number
  /** pricing_book.hourly_rate — the validator-accepted labour rate. */
  hourlyRate: number
  /** pricing_book.default_markup_pct — keeps the line inside the
   *  validator's accepted markup band. */
  markupPct: number
  /** v7 Phase 3 — tenant's explicit Good/Better/Best ladder (tenant_tier_ladder,
   *  migration 043). When a (category, tier) ladder hit exists,
   *  chooseMaterial() returns that exact product, beating the
   *  brand/range/tier inference. Optional — empty ladder = unchanged
   *  legacy behaviour. */
  tierLadder?: TierLadderEntry[]
  /** Phase 4 R3 — the product the customer picked, and the tier they saw it
   *  in. Anchors that product into that tier only; the others resolve their
   *  own. Optional — absent means unchanged legacy behaviour, which is also
   *  what a pre-R3 intake row (no tier recorded) gets. */
  chosenProduct?: ChosenProductAnchor | null
  /** Present-recipe authority gate: required categories may only consume an
   * active tenant catalogue price, never a shared/global fallback. */
  requireTenantMaterialAuthority?: boolean
  /** Server attestation from the tenant-scoped, versioned pricing snapshot.
   * Never construct this from model output or assume a shared recipe is approved. */
  authority?: DeterministicQuoteAuthority
}

export interface DeterministicQuoteAuthority {
  tenantId: string
  pricingBookVersionId: string
  recipeSourceId: string
  approvedCatalogueIds: string[]
  gstRegistered: boolean
  serviceMode: QuoteServiceMode
  /** Explicit approved book policy; no hidden fallback to a two-hour charge. */
  minLabourHours: number | string
}

export interface DeterministicTier {
  line_items: QuoteLine[]
  subtotal_ex_gst: number
  /** Phase 4 R9 — the headline product's attributes for THIS tier, so the
   *  caller can decide which steps the tier earns. Per tier, not per quote:
   *  each tier can hold a different product, so a smart light on Better earns
   *  the pairing step while the plain one on Good does not. */
  headlineProperties?: Record<string, unknown> | null
  /** Present only for the strict authority path; persist with the tier snapshot. */
  calculation?: QuoteCalculation
}
export interface DeterministicTiers {
  good: DeterministicTier
  better: DeterministicTier
  best: DeterministicTier
}

export type DeterministicResult =
  | { tiers: DeterministicTiers; reason?: undefined }
  | { tiers: null; reason: string; code?: 'missing_tenant_recipe_price' | QuoteCoreFailureCode }

/**
 * Build good/better/best deterministically from a recipe × catalogue.
 * Returns `{ tiers:null, reason }` whenever the job cannot be honoured
 * safely. With authority supplied, failure requires tradie review and must
 * never fall back to model-authored prices. Legacy callers retain their
 * existing fallback policy.
 */
export function buildDeterministicTiers(
  input: DeterministicTierInput,
): DeterministicResult {
  if (input.authority) return buildAuthoritativeTiers(input, input.authority)
  if (!Array.isArray(input.bom) || input.bom.length === 0) {
    return { tiers: null, reason: 'no recipe for this job' }
  }
  if (!Number.isFinite(input.hourlyRate) || input.hourlyRate <= 0) {
    return { tiers: null, reason: 'no usable hourly_rate' }
  }
  const mk = Number.isFinite(input.markupPct) && input.markupPct > 0 ? input.markupPct : 0
  const labourHours = Number.isFinite(input.labourHours) && input.labourHours > 0
    ? input.labourHours
    : 0

  const out: Partial<DeterministicTiers> = {}

  for (const tier of TIERS) {
    // Per-tier material resolver: pick the catalogue/shared product for
    // this category at THIS tier, then mark up at the configured pct so
    // it lands in the validator's accepted band. chooseMaterial already
    // prefers the operator's active catalogue ahead of shared and falls
    // back to shared when the catalogue doesn't cover the category.
    // Phase 4 R10 — receives the whole BOM line, which R11 uses for the
    // product pin and R7 for include_when (judged by the caller against the
    // `properties` returned below).
    const resolveMaterial = (line: BomLine) => {
      const category = line.material_category
      const choose = input.requireTenantMaterialAuthority
        ? chooseTenantMaterial
        : chooseMaterial
      const chosen = choose({
        tenantRows: input.tenantMaterials,
        sharedRows: input.sharedMaterials,
        category,
        tier,
        tierLadder: input.tierLadder,
        // Phase 4 R3 — chooseMaterial anchors this into ITS tier only, so
        // passing it on every tier is correct: the other two see a tier
        // mismatch and resolve their own product.
        chosenProduct: input.chosenProduct,
        // Phase 4 R11 — the recipe line's own product pin. R10 widened this
        // callback to receive the whole line so this field could reach here.
        pinnedCatalogueId: line.catalogue_id ?? null,
      })
      if (!chosen) return null
      // WP4: when the price came from the operator's own catalogue,
      // carry the product id + photo so the render shows THE EXACT
      // product. Shared rows have neither — left undefined (text-only,
      // exactly as before). Never affects price.
      if (chosen.source === 'tenant') {
        return {
          name: chosen.row.name,
          markedUpPrice: money(chosen.price * (1 + mk / 100)),
          catalogue_id: chosen.row.id ?? null,
          image_path: chosen.row.image_path ?? null,
          // Phase 4 R7 — the tags the caller judges include_when against.
          // Only tenant rows carry them; a shared fallback returns none,
          // which reads as "unknown" and keeps a required line.
          properties: (chosen.row.properties as Record<string, unknown> | null) ?? null,
        }
      }
      return {
        name: chosen.row.name,
        markedUpPrice: money(chosen.price * (1 + mk / 100)),
      }
    }

    const built = buildBomQuoteLines({
      bom: input.bom,
      resolveMaterial,
      labourHours,
      labourRate: input.hourlyRate,
    })

    if (built.missingRequired.length > 0) {
      // A required part has no price anywhere — do NOT ship a hole.
      // Mirrors the grounding validator's safe-failure philosophy.
      return {
        tiers: null,
        reason: `required categories not priceable: ${built.missingRequired.join(', ')}`,
        ...(input.requireTenantMaterialAuthority
          ? { code: 'missing_tenant_recipe_price' as const }
          : {}),
      }
    }

    const subtotal = money(
      built.lines.reduce((s, l) => s + (Number(l.total_ex_gst) || 0), 0),
    )
    out[tier] = {
      line_items: built.lines,
      subtotal_ex_gst: subtotal,
      headlineProperties: built.headlineProperties ?? null,
    }
  }

  return { tiers: out as DeterministicTiers }
}

/** Strict adapter over the existing condition-aware recipe composer. Monetary
 * output is replaced by Quote Core cents, and a failed authority never yields
 * a partial tier. Legacy callers retain their existing selection behaviour. */
function buildAuthoritativeTiers(
  input: DeterministicTierInput,
  authority: DeterministicQuoteAuthority,
): DeterministicResult {
  const fail = (code: QuoteCoreFailureCode, reason: string): DeterministicResult => ({ tiers: null, code, reason })
  const id = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
  if (!id(authority.tenantId) || !id(authority.pricingBookVersionId) || !id(authority.recipeSourceId) ||
      !Array.isArray(authority.approvedCatalogueIds) || typeof authority.gstRegistered !== 'boolean') {
    return fail('missing_authority', 'Verified tenant, pricing book version, recipe and catalogue authority are required')
  }
  // Recipes currently have no component service-role metadata. Guessing which
  // parts remain on install-only/supply-only jobs would create incorrect scope.
  if (authority.serviceMode !== 'supply_and_install') {
    return fail('unsupported_service_mode', 'This recipe does not declare supply-only/install-only component roles; tradie review is required')
  }
  if (!Array.isArray(input.bom) || input.bom.length === 0) return fail('missing_price', 'No approved recipe for this job')
  const hourlyCents = exactPriceCents(input.hourlyRate)
  if (hourlyCents === null || hourlyCents <= 0) return fail('invalid_amount', 'No valid approved hourly rate')
  const minimum = exactDecimalNumber(authority.minLabourHours, 6)
  if (minimum === null || minimum < 0 ||
      exactDecimalNumber(input.labourHours, 6) === null || input.labourHours < 0) {
    return fail('invalid_quantity', 'Recipe labour and minimum labour policy must be explicit non-negative hours')
  }
  if (!Number.isFinite(input.markupPct) || input.markupPct < 0) return fail('invalid_markup', 'Approved markup is invalid')
  const labourHours = Math.max(input.labourHours, minimum)
  for (const line of input.bom) {
    if (exactDecimalNumber(line.quantity, 6) === null) return fail('invalid_quantity', `Recipe quantity must be exact to at most six decimal places: ${line.material_category}`)
  }
  const approved = new Set(authority.approvedCatalogueIds)
  if (approved.size !== authority.approvedCatalogueIds.length || authority.approvedCatalogueIds.some((value) => !id(value))) {
    return fail('ambiguous_source', 'Approved catalogue IDs must be present and unique')
  }
  const allIds = new Set<string>()
  for (const row of input.tenantMaterials) {
    if (row.id && allIds.has(row.id)) return fail('ambiguous_source', `Duplicate catalogue ID: ${row.id}`)
    if (row.id) allIds.add(row.id)
  }
  const categoryKey = (value: string) => value.trim().toLowerCase()
  const tiers: Partial<DeterministicTiers> = {}
  for (const tier of TIERS) {
    let problem: { code: QuoteCoreFailureCode; reason: string } | null = null
    const sources = new Map<string, ApprovedQuoteSource>()
    const resolveMaterial = (line: BomLine) => {
      const category = categoryKey(line.material_category)
      const ladder = (input.tierLadder ?? []).filter((entry) => categoryKey(entry.category) === category && entry.tier === tier)
      if (new Set(ladder.map((entry) => entry.catalogue_id)).size > 1) {
        problem = { code: 'ambiguous_source', reason: `Multiple ${tier} product pins for ${category}` }
        return null
      }
      const customer = input.chosenProduct?.tier === tier && categoryKey(input.chosenProduct.category) === category
        ? input.chosenProduct.catalogue_id : null
      const explicitId = customer ?? ladder[0]?.catalogue_id ?? line.catalogue_id
      const candidates = input.tenantMaterials.filter((row) =>
        categoryKey(row.category) === category && row.active === true && id(row.id) && approved.has(row.id))
      let selected: TenantMaterial | undefined
      if (explicitId) {
        selected = candidates.find((row) => row.id === explicitId)
        if (!selected) {
          problem = { code: 'unapproved_source', reason: `Pinned product is missing, inactive or unapproved: ${explicitId}` }
          return null
        }
      } else {
        const scored = candidates.map((row) => ({ row, score:
          (resolveTierForBrandRange(row.brand, row.range_series, row.tier_hint) === tier ? 2 : 0) +
          (row.is_preferred === true ? 1 : 0),
        })).sort((a, b) => b.score - a.score)
        if (scored.length > 1 && scored[0].score === scored[1].score) {
          problem = { code: 'ambiguous_source', reason: `No unique approved ${tier} product for ${category}` }
          return null
        }
        selected = scored[0]?.row
      }
      if (!selected?.id) {
        problem = { code: 'missing_price', reason: `No approved tenant price for ${category}` }
        return null
      }
      const cents = exactPriceCents(selected.unit_price_ex_gst)
      const markedUp = cents === null ? null : exactMarkedUpCents(cents, input.markupPct)
      if (cents === null || cents <= 0 || markedUp === null) {
        problem = { code: 'invalid_amount', reason: `Invalid approved catalogue price: ${selected.id}` }
        return null
      }
      sources.set(selected.id, {
        id: selected.id, tenantId: authority.tenantId, pricingBookVersionId: authority.pricingBookVersionId,
        approved: true, active: true, kind: 'catalogue', unitPriceCents: cents,
      })
      return { name: selected.name, markedUpPrice: markedUp / 100, catalogue_id: selected.id,
        image_path: selected.image_path, properties: selected.properties }
    }
    const built = buildBomQuoteLines({ bom: input.bom, resolveMaterial, labourHours, labourRate: input.hourlyRate })
    if (problem) {
      const { code, reason } = problem as { code: QuoteCoreFailureCode; reason: string }
      return fail(code, reason)
    }
    if (built.missingRequired.length > 0) return fail('missing_price', `Required recipe lines are not priceable: ${built.missingRequired.join(', ')}`)
    const labourSourceId = `pricing_book:${authority.pricingBookVersionId}:hourly_rate`
    sources.set(labourSourceId, {
      id: labourSourceId, tenantId: authority.tenantId, pricingBookVersionId: authority.pricingBookVersionId,
      approved: true, active: true, kind: 'labour_rate', unitPriceCents: hourlyCents,
    })
    const result = calculateAuthoritativeQuote({
      ...authority,
      sources: [...sources.values()],
      lines: built.lines.map((line, index) => ({
        id: `${tier}:${index}`, sourceId: line.source === 'labour' ? labourSourceId : line.catalogue_id ?? '',
        role: line.source === 'labour' ? 'labour' : 'material',
        quantity: line.quantity, markupPct: line.source === 'labour' ? 0 : input.markupPct,
      })),
    })
    if (!result.ok) return fail(result.code, result.reason)
    tiers[tier] = {
      line_items: built.lines.map((line, index) => ({ ...line,
        unit_price_ex_gst: result.calculation.lines[index].unitPriceCents / 100,
        total_ex_gst: result.calculation.lines[index].totalExGstCents / 100,
      })),
      subtotal_ex_gst: result.calculation.subtotalExGstCents / 100,
      headlineProperties: built.headlineProperties ?? null,
      calculation: { ...result.calculation, labourPolicy: {
        recipeHours: String(input.labourHours), minimumHours: String(authority.minLabourHours), billableHours: String(labourHours),
      } },
    }
  }
  return { tiers: tiers as DeterministicTiers }
}
