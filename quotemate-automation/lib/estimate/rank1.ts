import { buildDeterministicTiers, type DeterministicTier, type DeterministicTierInput } from './deterministic-bom'
import { exactPriceCents } from './quote-core'
import { resolveAssemblyTasks, type AssemblyTask } from './assembly-tasks'
import { evaluateSpecGuard } from './spec-guard'
import { getSpecDefs } from './spec-registry'
import { categoryForJobType } from '@/lib/sms/product-options'
import { strictEvChargerServiceModeFromIntake } from '@/lib/quote/ev-service-mode'
import { resolveInspectionReason } from './inspection-reason'
import { captureQuoteCoreScope, type QuoteCoreScopeSnapshot } from './quote-core-scope'
import type { EstimationResult } from './run'

type Row = Record<string, unknown>
type PricedTier = DeterministicTier & { label: string; tasks: ReturnType<typeof resolveAssemblyTasks>;
  coreScopeSnapshot: QuoteCoreScopeSnapshot; coreScopeOfWorks: string }
export type Rank1QuoteContext = { pricingBookVersionId: string }
export type Rank1QuoteEvidence = {
  version: 'quote-core-v1'
  status: 'priced' | 'review_required' | 'inspection_required'
  tenantId: string | null
  pricingBookVersionId: string | null
  reason?: string
  recipeSourceId?: string
  recipeRowIds?: string[]
  scopeSnapshot?: QuoteCoreScopeSnapshot | null
  scopeOfWorks?: string
  /** Exact server-read inputs retained with the quote, not reloaded on resume. */
  sourceSnapshot?: DeterministicTierInput
}
export type Rank1LoadedInputs = {
  input: DeterministicTierInput
  assemblyName: string
  recipeSourceId: string
  recipeRowIds: string[]
  taskRows: { tenant: AssemblyTask[]; shared: AssemblyTask[] }
} | { input: null; reason: string }

const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
const TRADE_LABELS: Record<string, string> = { electrical: 'Electrical', plumbing: 'Plumbing', roofing: 'Roofing',
  painting: 'Painting', solar: 'Solar', carpentry: 'Carpentry', landscaping: 'Landscaping' }
const tradeLabel = (trade: unknown): string => Object.hasOwn(TRADE_LABELS, String(trade)) ? TRADE_LABELS[String(trade)] : 'Job'

export function rank1ReviewResult(intake: Row, context: Rank1QuoteContext | null, reason: string): EstimationResult {
  const label = tradeLabel(intake.trade)
  const scopeOfWorks = `${label} scope and pricing require tradie review before a quote can be issued.`
  return {
    quoteCore: { version: 'quote-core-v1', status: 'review_required', tenantId: text(intake.tenant_id),
      pricingBookVersionId: context?.pricingBookVersionId ?? null, reason,
      scopeSnapshot: captureQuoteCoreScope(intake),
      scopeOfWorks },
    groundingHold: true,
    draft: {
      good: null, better: null, best: null, selected_tier: null, needs_inspection: false,
      inspection_reason: null, scope_of_works: scopeOfWorks,
      scope_short: `${label} quote requires review`, assumptions: [],
      risk_flags: [`[quote-core] ${reason}`], optional_upsells: [],
      estimated_timeframe: 'To be confirmed by the tradie', gst_note: null,
      pricing_path: 'deterministic',
    },
  }
}

/** No provider calls and no model-produced prices. Unknown authority or scope
 * becomes a review draft, never a paid inspection for an internal data gap. */
export async function buildRank1Estimation(args: {
  intake: Row
  pricingBook: Row | null
  context: Rank1QuoteContext | null
  loadInputs: () => Promise<Rank1LoadedInputs>
}): Promise<EstimationResult> {
  const { intake, pricingBook: book, context } = args
  const hold = (reason: string) => rank1ReviewResult(intake, context, reason)
  const tenantId = text(intake.tenant_id)
  const trade = text(intake.trade)
  if (!tenantId || !trade) return hold('Verified tenant and trade are required before pricing')
  if (!context?.pricingBookVersionId || !book || book.tenant_id !== tenantId || book.trade !== trade || !text(book.id))
    return hold('A captured price-book version belonging to this tenant and trade is required')
  // The system-wide policy does not imply that one trade's recipe contract
  // proves another trade's pricing. Specialist calculators keep their own
  // release paths; unsupported generic jobs remain unpriced for tradie review.
  if (trade !== 'electrical') return hold(`${tradeLabel(trade)} automatic pricing requires an approved trade-specific Quote Core recipe adapter`)
  if (typeof book.gst_registered !== 'boolean') return hold('GST registration must be explicitly configured')
  const scope = row(intake.scope)
  const specs = row(scope.specs)
  const serviceMode = intake.job_type === 'ev_charger'
    ? strictEvChargerServiceModeFromIntake(intake)
    : specs.supplied_by === 'tradie' ? 'supply_and_install'
      : specs.supplied_by === 'customer' ? 'install_only' : undefined
  // A delivery-only sale has no installation site to inspect. Stale intake
  // safety flags or unknown supply intent cannot create a chargeable visit.
  if (intake.job_type === 'ev_charger' && (!serviceMode || serviceMode === 'supply_only')) {
    return hold(serviceMode === 'supply_only'
      ? 'This service mode needs an approved component-specific recipe'
      : 'Supply responsibility and service mode need confirmation')
  }
  if (intake.inspection_required === true) {
    const result = hold('Structured intake requires an on-site inspection')
    result.quoteCore!.status = 'inspection_required'
    result.groundingHold = false
    result.draft.needs_inspection = true
    result.draft.pricing_path = 'inspection'
    result.draft.inspection_reason = resolveInspectionReason('On-site assessment required by the structured intake')
    result.draft.scope_of_works = 'On-site assessment of the requested electrical work. Final work pricing follows tradie review.'
    result.quoteCore!.scopeOfWorks = result.draft.scope_of_works
    result.inspectionCause = 'site_conditions'
    return result
  }
  if (intake.confidence !== 'HIGH' || intake.inspection_required !== false)
    return hold('The intake must establish scope and safety before automatic draft pricing')
  if (!serviceMode) return hold('Supply responsibility and service mode need confirmation')
  // Existing recipes do not identify fitting vs installation component roles.
  if (serviceMode !== 'supply_and_install') return hold('This service mode needs an approved component-specific recipe')
  if (!Number.isSafeInteger(scope.item_count) || Number(scope.item_count) <= 0)
    return hold('An exact positive item count is required')
  if (!text(intake.address)) return hold('The job address needs confirmation')
  const calloutCents = exactPriceCents(book.call_out_minimum as number | string)
  if (calloutCents === null) return hold('The call-out minimum must be explicitly configured')

  try {
    const loaded = await args.loadInputs()
    if (!loaded.input) return hold(loaded.reason)
    if (!loaded.recipeSourceId || !loaded.recipeRowIds.length ||
        loaded.recipeRowIds.some(id => !text(id)) || new Set(loaded.recipeRowIds).size !== loaded.recipeRowIds.length)
      return hold('Approved recipe source rows are required')
    if (scope.chosen_product && !loaded.input.chosenProduct)
      return hold('The customer product choice is incomplete or no longer approved')
    // Unknown product conditions cannot silently include or omit a component.
    // Conditional recipes remain on review until their input contract is evaluated.
    if (loaded.input.bom.some(line => line.include_when != null &&
        (typeof line.include_when !== 'object' || Array.isArray(line.include_when) || Object.keys(line.include_when).length > 0)))
      return hold('Conditional recipe components require a reviewed scope decision')
    const authorityInput: DeterministicTierInput = {
      ...loaded.input,
      sharedMaterials: [], requireTenantMaterialAuthority: true,
      authority: {
        tenantId, pricingBookVersionId: context.pricingBookVersionId,
        recipeSourceId: loaded.recipeSourceId,
        approvedCatalogueIds: loaded.input.tenantMaterials.flatMap(material =>
          material.active === true && material.id ? [material.id] : []),
        serviceMode, gstRegistered: book.gst_registered,
        minLabourHours: book.min_labour_hours as number | string,
      },
    }
    const built = buildDeterministicTiers(authorityInput)
    if (!built.tiers) return hold(`${built.code ?? 'recipe_unavailable'}: ${built.reason}`)
    for (const key of ['good', 'better', 'best'] as const) {
      const tier = built.tiers[key]
      if (!tier.calculation || tier.calculation.subtotalExGstCents < calloutCents)
        return hold('The approved recipe does not meet the configured call-out minimum')
      if (!tier.calculation.lines.some(line => line.role === 'labour' && Number(line.quantity) > 0))
        return hold('An installation quote requires approved labour')
    }
    const draft = {
      good: null as PricedTier | null, better: null as PricedTier | null, best: null as PricedTier | null,
      needs_inspection: false, inspection_reason: null, pricing_path: 'deterministic',
      scope_of_works: `${loaded.assemblyName}. Quantity: ${scope.item_count}. Supply and installation using the approved tenant recipe.`,
      scope_short: loaded.assemblyName, assumptions: [], risk_flags: [], optional_upsells: [],
      estimated_timeframe: 'To be confirmed by the tradie', gst_note: null,
      selected_tier: loaded.input.chosenProduct?.tier ?? 'better',
    }
    const scopeSnapshot = captureQuoteCoreScope(intake)
    if (!scopeSnapshot) return hold('A saved intake scope is required')
    for (const key of ['good', 'better', 'best'] as const) {
      const tier = built.tiers[key]
      draft[key] = { ...tier, label: key[0].toUpperCase() + key.slice(1),
        coreScopeSnapshot: scopeSnapshot, coreScopeOfWorks: draft.scope_of_works,
        tasks: resolveAssemblyTasks({ tenantTasks: loaded.taskRows.tenant, sharedTasks: loaded.taskRows.shared,
          productProperties: tier.headlineProperties ?? null }) }
    }
    // A confirmed customer pick stays a single offer; other tiers cannot undo it.
    if (loaded.input.chosenProduct) {
      for (const key of ['good', 'better', 'best'] as const) if (key !== draft.selected_tier) draft[key] = null
    }
    const requested: Record<string, string> = {}
    for (const [key, value] of Object.entries(row(specs.requested_specs))) {
      if (value == null || value === '' || value === 'unknown') continue
      if (typeof value !== 'string') return hold('Requested product specifications need a verified structured value')
      if (value.trim()) requested[key] = value.trim()
    }
    const category = categoryForJobType(String(intake.job_type ?? ''))
    const supportedSpecKeys = new Set(getSpecDefs('electrical', category).map(def => def.key))
    // The legacy guard deliberately ignores unknown keys. Strict pricing may
    // not turn an ignored requirement (dimmable, IP rating, etc.) into approval.
    if (Object.keys(requested).some(key => !supportedSpecKeys.has(key)))
      return hold('Requested product specifications include a requirement without an approved validation rule')
    if (Object.keys(requested).length > 0) {
      for (const key of ['good', 'better', 'best'] as const) {
        const tier = draft[key]
        if (!tier) continue
        // Recipe descriptions describe work, not the catalogue product's
        // specifications. Only the exact priced product may prove a match.
        const pricedIds = new Set(tier.line_items.flatMap(line =>
          line.source === 'material' && line.catalogue_id ? [line.catalogue_id] : []))
        const products = loaded.input.tenantMaterials.filter(material =>
          material.id && pricedIds.has(material.id) &&
          material.category.trim().toLowerCase() === category?.trim().toLowerCase())
        if (products.length !== 1)
          return hold('Requested product specifications need one unambiguous approved catalogue product')
        const product = products[0]
        const decision = evaluateSpecGuard({ requested, trade: 'electrical', category,
          properties: product.properties, name: product.name, mode: 'enforce' })
        if (decision.verdict !== 'match' || decision.block)
          return hold('Approved product specifications do not establish a match for the requested work')
      }
    }
    return { draft, quoteCore: { version: 'quote-core-v1', status: 'priced', tenantId,
      pricingBookVersionId: context.pricingBookVersionId, recipeSourceId: loaded.recipeSourceId,
      recipeRowIds: loaded.recipeRowIds, sourceSnapshot: authorityInput,
      scopeSnapshot, scopeOfWorks: draft.scope_of_works } }
  } catch {
    return hold('Approved recipe or price sources could not be read or calculated')
  }
}
