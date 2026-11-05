import type { SupabaseClient } from '@supabase/supabase-js'
import { isDeepStrictEqual } from 'node:util'
import { assertQuoteCoreCustomerReleaseAllowed, QuoteCoreCustomerReleaseError } from './quote-core-release'
import { buildSaveAsQuoteRequest, buildTierObjects, splitAddress } from '@/lib/roofing/save-as-quote-helpers'
import type { MultiRoofQuote } from '@/lib/roofing/types'

type Row = Record<string, unknown>
const obj = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const tiers = ['good', 'better', 'best'] as const
const money = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value)
  ? Math.round(value * 100) : null

/** Roofing's promotion is another server calculator, not an Electrical recipe.
 * It earns compatibility only through the exact tenant-owned source row linked
 * by BOTH quote id and share token. Intake assertions alone are not authority.
 * The final approval RPC still compares the entire generic quote snapshot. */
export async function assertQuoteReleaseAuthority(db: SupabaseClient, quote: Row, tenantId: string, intake?: unknown):
  Promise<ReturnType<typeof assertQuoteCoreCustomerReleaseAllowed>> {
  try { return assertQuoteCoreCustomerReleaseAllowed(quote, tenantId, intake) }
  catch (error) {
    if (!(error instanceof QuoteCoreCustomerReleaseError) || error.reason !== 'draft_requires_core_recalculation' ||
        obj(intake).trade !== 'roofing') throw error
  }
  const reject = (reason: string): never => { throw new QuoteCoreCustomerReleaseError(`roofing_${reason}`) }
  const sourceIntake = obj(intake)
  if (!nonempty(tenantId) || quote.tenant_id !== tenantId || sourceIntake.tenant_id !== tenantId ||
      !nonempty(quote.id) || !nonempty(quote.share_token) || !nonempty(quote.intake_id) || sourceIntake.id !== quote.intake_id)
    return reject('identity_mismatch')
  const { data, error } = await db.from('roofing_measurements')
    .select('id,tenant_id,quote_id,quote_share_token,address,postcode,state,quote,included_indices')
    .eq('tenant_id', tenantId).eq('quote_id', quote.id).eq('quote_share_token', quote.share_token).maybeSingle()
  if (error || !data || data.tenant_id !== tenantId || data.quote_id !== quote.id ||
      data.quote_share_token !== quote.share_token || !nonempty(data.id)) return reject('linked_source_unavailable')
  const authority = obj(obj(data.quote).pricing_authority)
  if (authority.source !== 'tenant_pricing_book' || authority.tenant_id !== tenantId ||
      !nonempty(authority.pricing_book_id) || typeof authority.revision !== 'string' || !/^[a-f0-9]{64}$/.test(authority.revision) ||
      !isDeepStrictEqual(authority, obj(sourceIntake.scope).pricing_authority)) return reject('pricing_authority_mismatch')
  try {
    const trusted = buildSaveAsQuoteRequest({ address: data.address, postcode: data.postcode, state: data.state,
      quote: data.quote as MultiRoofQuote, included_indices: data.included_indices })
    if (!trusted || trusted.price.routing.decision === 'inspection_required' || quote.needs_inspection !== false ||
        sourceIntake.inspection_required !== false || trusted.price.tiers.length !== 3) return reject('source_not_priceable')
    const { inputs, metrics, address, price } = trusted
    const { street, suburb } = splitAddress(address.address)
    const expectedScope = { ...inputs, ...metrics, pricing_authority: authority,
      polygon_geojson: metrics.polygon_geojson ?? null, state: address.state, postcode: address.postcode }
    if (sourceIntake.address !== street || sourceIntake.suburb !== suburb || sourceIntake.job_type !== (inputs.intent || 'full_reroof') ||
        !isDeepStrictEqual(sourceIntake.scope, expectedScope) ||
        obj(sourceIntake.property).levels !== (metrics.storeys ?? null) || quote.scope_of_works !== price.tiers[1].scope)
      return reject('scope_changed')
    const expected = buildTierObjects(price)
    for (const tier of tiers) {
      if (!isDeepStrictEqual(quote[tier], expected[tier]) || !Number.isFinite(expected[tier].subtotal_ex_gst) ||
          !Number.isFinite(expected[tier].total_inc_gst) || expected[tier].subtotal_ex_gst <= 0 || expected[tier].total_inc_gst <= 0)
        return reject('tier_changed')
    }
    if (!tiers.includes(quote.selected_tier as typeof tiers[number])) return reject('selection_invalid')
    const selected = expected[quote.selected_tier as typeof tiers[number]]
    if (money(quote.total_inc_gst) !== money(selected.total_inc_gst) ||
        (quote.subtotal_ex_gst !== undefined && money(quote.subtotal_ex_gst) !== money(selected.subtotal_ex_gst)) ||
        (quote.gst !== undefined && money(quote.gst) !== money(selected.total_inc_gst - selected.subtotal_ex_gst)))
      return reject('total_changed')
  } catch (error) {
    if (error instanceof QuoteCoreCustomerReleaseError) throw error
    return reject('source_malformed')
  }
  return null
}
