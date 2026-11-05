import { buildDeterministicTiers, type DeterministicTierInput } from '@/lib/estimate/deterministic-bom'
import { exactPriceCents } from '@/lib/estimate/quote-core'
import { captureQuoteCoreScope, quoteCoreScopeMatches } from '@/lib/estimate/quote-core-scope'
import { rank1QuoteCoreEnabled } from '@/lib/estimate/rank1-policy'

type Row = Record<string, unknown>
const TIERS = ['good', 'better', 'best'] as const
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const id = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]))
    : value ?? null
const equal = (left: unknown, right: unknown) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
const cents = (value: unknown) => typeof value === 'number' || typeof value === 'string' ? exactPriceCents(value) : null

export class QuoteCoreCustomerReleaseError extends Error {
  readonly code = 'quote_core_review_required'
  readonly status = 409
  constructor(readonly reason: string) {
    super('Quote pricing has changed or is incomplete. Recalculate and review the quote before customer release.')
    this.name = 'QuoteCoreCustomerReleaseError'
  }
}

/** Recompute only from the saved server sources. Current catalogue edits cannot
 * reprice an approved historical draft. Tier calculations and displayed lines
 * are included in the existing atomic customer-release snapshot. */
export function assertQuoteCoreCustomerReleaseAllowed(quote: Row, tenantId: string, intake?: unknown):
  { status: 'priced'; sourceSnapshot: DeterministicTierInput } | { status: 'inspection_required' } | null {
  const evidence = row(row(quote.grounding_result).quote_core)
  const hasEvidence = Object.prototype.hasOwnProperty.call(row(quote.grounding_result), 'quote_core')
  const hasTrace = TIERS.some(tier => ['calculation', 'coreScopeSnapshot', 'coreScopeOfWorks']
    .some(key => Object.prototype.hasOwnProperty.call(row(quote[tier]), key)))
  const reject = (reason: string): never => { throw new QuoteCoreCustomerReleaseError(reason) }
  const historical = !!quote.customer_released_at || !!quote.sent_at || !!quote.paid_at ||
    ['sent', 'accepted', 'paid'].includes(String(quote.status))
  // Only the explicit manual-final and balance paths have another authority
  // contract. A missing/unknown kind cannot act as an initial-quote bypass.
  const requiresInitialAuthority = quote.quote_kind !== 'final' && quote.quote_kind !== 'balance'
  if (!hasEvidence && !hasTrace) {
    if (!historical && requiresInitialAuthority &&
        rank1QuoteCoreEnabled()) return reject('draft_requires_core_recalculation')
    return null
  }
  if (evidence.version !== 'quote-core-v1' || !id(tenantId) || quote.tenant_id !== tenantId || evidence.tenantId !== tenantId ||
      !id(quote.pricing_book_version_id) || evidence.pricingBookVersionId !== quote.pricing_book_version_id) {
    return reject('core_identity_mismatch')
  }
  if (evidence.status === 'review_required') return reject('core_review_required')
  const savedScope = captureQuoteCoreScope(evidence.scopeSnapshot)
  if (!savedScope || savedScope.trade !== 'electrical' || !equal(savedScope, evidence.scopeSnapshot) ||
      !id(evidence.scopeOfWorks) || evidence.scopeOfWorks !== quote.scope_of_works) {
    return reject('core_scope_snapshot_missing_or_changed')
  }
  if (!historical && requiresInitialAuthority &&
      !quoteCoreScopeMatches(savedScope, captureQuoteCoreScope(intake))) {
    return reject('core_intake_scope_changed')
  }
  if (evidence.status === 'inspection_required') {
    if (quote.needs_inspection !== true || TIERS.some(tier => quote[tier] != null)) return reject('core_inspection_state_conflict')
    return { status: 'inspection_required' }
  }
  if (evidence.status !== 'priced' || quote.needs_inspection !== false || row(quote.grounding_result).held_for_review === true) {
    return reject('core_status_invalid')
  }
  const source = row(evidence.sourceSnapshot)
  const authority = row(source.authority)
  if (authority.tenantId !== tenantId || authority.pricingBookVersionId !== quote.pricing_book_version_id ||
      !id(evidence.recipeSourceId) || authority.recipeSourceId !== evidence.recipeSourceId ||
      !Array.isArray(evidence.recipeRowIds) || evidence.recipeRowIds.length === 0 ||
      evidence.recipeRowIds.some(value => !id(value)) || new Set(evidence.recipeRowIds).size !== evidence.recipeRowIds.length) {
    return reject('core_source_snapshot_missing')
  }
  let rebuilt: ReturnType<typeof buildDeterministicTiers>
  try { rebuilt = buildDeterministicTiers(source as unknown as DeterministicTierInput) }
  catch { return reject('core_source_snapshot_malformed') }
  if (!rebuilt.tiers) return reject('core_source_snapshot_unpriceable')
  const chosen = row(source.chosenProduct)
  const requiredTier = id(chosen.catalogue_id) ? chosen.tier : null
  let priced = 0
  for (const tier of TIERS) {
    const saved = quote[tier]
    if (requiredTier && tier !== requiredTier) {
      if (saved != null) return reject('core_customer_choice_changed')
      continue
    }
    if (saved == null) return reject('core_priced_tier_missing')
    const storedTier = row(saved)
    if (!quoteCoreScopeMatches(storedTier.coreScopeSnapshot, savedScope) || storedTier.coreScopeOfWorks !== evidence.scopeOfWorks) {
      return reject('core_tier_scope_changed')
    }
    const expected = rebuilt.tiers[tier]
    if (!expected.calculation || !equal(storedTier.calculation, expected.calculation) ||
        cents(storedTier.subtotal_ex_gst) !== expected.calculation.subtotalExGstCents ||
        !Array.isArray(storedTier.line_items) || storedTier.line_items.length !== expected.line_items.length) {
      return reject('core_calculation_changed')
    }
    for (let index = 0; index < expected.line_items.length; index++) {
      const line = row(storedTier.line_items[index])
      const original = expected.line_items[index]
      // Product identity, scope and display math all belong to the saved recipe.
      for (const key of ['description', 'quantity', 'unit', 'unit_price_ex_gst', 'total_ex_gst', 'source', 'catalogue_id'] as const) {
        if (!equal(line[key], original[key])) return reject('core_line_changed')
      }
    }
    priced++
  }
  const selected = quote.selected_tier
  if (!priced || !TIERS.includes(selected as typeof TIERS[number]) || (requiredTier && selected !== requiredTier)) {
    return reject('core_selected_tier_invalid')
  }
  const calculation = rebuilt.tiers[selected as typeof TIERS[number]].calculation!
  if (cents(quote.total_inc_gst) !== calculation.totalIncGstCents ||
      (quote.subtotal_ex_gst !== undefined && cents(quote.subtotal_ex_gst) !== calculation.subtotalExGstCents) ||
      (quote.gst !== undefined && cents(quote.gst) !== calculation.gstCents)) {
    return reject('core_selected_total_changed')
  }
  return { status: 'priced', sourceSnapshot: source as unknown as DeterministicTierInput }
}
