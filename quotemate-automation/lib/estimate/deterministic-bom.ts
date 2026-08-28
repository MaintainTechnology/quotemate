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
} from './catalogue'

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
}

export interface DeterministicTier {
  line_items: QuoteLine[]
  subtotal_ex_gst: number
  /** Phase 4 R9 — the headline product's attributes for THIS tier, so the
   *  caller can decide which steps the tier earns. Per tier, not per quote:
   *  each tier can hold a different product, so a smart light on Better earns
   *  the pairing step while the plain one on Good does not. */
  headlineProperties?: Record<string, unknown> | null
}
export interface DeterministicTiers {
  good: DeterministicTier
  better: DeterministicTier
  best: DeterministicTier
}

export type DeterministicResult =
  | { tiers: DeterministicTiers; reason?: undefined }
  | { tiers: null; reason: string; code?: 'missing_tenant_recipe_price' }

/**
 * Build good/better/best deterministically from a recipe × catalogue.
 * Returns `{ tiers:null, reason }` whenever the job cannot be honoured
 * safely — the caller MUST then fall back to the existing Opus draft
 * (no regression, never a partial/holed quote).
 */
export function buildDeterministicTiers(
  input: DeterministicTierInput,
): DeterministicResult {
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
