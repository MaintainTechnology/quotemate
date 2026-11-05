// A checked takeoff priced on the tenant's own roofing rate card (TKO-17), as
// a preview that writes nothing, or saved as the roofing measurement the
// website's /m page opens (TKO-16): Service Spec §5.4, DEC-022. The pricer is
// the platform's own, and the model never sees a price (DEC-004).
//
// Callers pass the service-role client, which bypasses RLS, so every query
// here also filters on tenant_id.

import type { SupabaseClient } from '@supabase/supabase-js'
import { priceMultiRoof } from '@/lib/roofing/pricing'
import { loadTenantRoofingPricingContext, type RoofingPricingAuthority } from '@/lib/roofing/pricing-authority'
import { newMeasurementTokens } from '@/lib/roofing/tokens'
import type { MultiRoofQuote } from '@/lib/roofing/types'
import { TAKEOFF_INTENT, toRoofStructures, type PriceOptions, type Unpriced } from './metrics'
import { RoofPlanTakeoffSchema, type RoofPlanTakeoff } from './schema'

const failure = (what: string, error: { message: string }) => new Error(`takeoff ${what} failed: ${error.message}`)

/** A run with a takeoff and no stage running: it can be priced. */
const PRICEABLE = ['ready', 'needs_review', 'saved']

type RunRow = {
  id: string
  tenant_id: string
  status: string
  site_address: string
  postcode: string | null
  state: string | null
  latest_extraction_id: string | null
  job_ref: string | null
  job_name: string | null
  builder: { business?: string | null } | null
}

/** The run in the tenant's scope, with its takeoff: the correction when there is one. */
export async function runWithTakeoff(db: SupabaseClient, tenantId: string, runId: string) {
  const found = await db.from('roof_takeoff_runs')
    .select('id, tenant_id, status, site_address, postcode, state, latest_extraction_id, job_ref, job_name, builder')
    .eq('id', runId).eq('tenant_id', tenantId)
    .maybeSingle()
  if (found.error) throw failure('run lookup', found.error)
  const run = found.data as RunRow | null
  if (!run) return null
  let takeoff: RoofPlanTakeoff | null = null
  if (run.latest_extraction_id) {
    const got = await db.from('plan_extractions')
      .select('items, corrected_items')
      .eq('id', run.latest_extraction_id).eq('tenant_id', tenantId)
      .maybeSingle()
    if (got.error) throw failure('reading lookup', got.error)
    const stored = got.data?.corrected_items ?? got.data?.items
    takeoff = stored ? RoofPlanTakeoffSchema.parse(stored) : null
  }
  return { run, takeoff }
}

type Refusal =
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'run_not_ready'; status: string }
  | { ok: false; error: 'unknown_structures'; ids: string[] }
  | { ok: false; error: 'no_rate_card' }

/** The takeoff priced on the tenant's own roofing rate card, never the default one. */
async function priceTakeoff(db: SupabaseClient, tenantId: string, takeoff: RoofPlanTakeoff, options: PriceOptions) {
  const mapped = toRoofStructures(takeoff, options)
  if (mapped.unknown.length) return { ok: false, error: 'unknown_structures', ids: mapped.unknown } as const
  // ponytail: the loader answers null on a database error too, so a failed
  // lookup reads as no rate card. Nothing is written either way.
  const pricing = await loadTenantRoofingPricingContext(db, tenantId, 'roofing')
  if (!pricing) return { ok: false, error: 'no_rate_card' } as const
  const quote = mapped.structures.length ? priceMultiRoof({ structures: mapped.structures, rateCard: pricing.rateCard }) : null
  return { ok: true, quote, unpriced: mapped.unpriced, authority: pricing.authority } as const
}

export type PriceOutcome =
  | {
      ok: true
      run_id: string
      intent: typeof TAKEOFF_INTENT
      pricing_authority: RoofingPricingAuthority
      quote: MultiRoofQuote | null
      unpriced: Unpriced[]
    }
  | Refusal

/** The price preview: the run's takeoff priced, and nothing written. */
export async function previewPrice(db: SupabaseClient, input: {
  tenantId: string
  runId: string
  options?: PriceOptions
}): Promise<PriceOutcome> {
  const found = await runWithTakeoff(db, input.tenantId, input.runId)
  if (!found) return { ok: false, error: 'not_found' }
  if (!PRICEABLE.includes(found.run.status) || !found.takeoff) return { ok: false, error: 'run_not_ready', status: found.run.status }
  const priced = await priceTakeoff(db, input.tenantId, found.takeoff, input.options ?? {})
  if (!priced.ok) return priced
  return {
    ok: true,
    run_id: found.run.id,
    intent: TAKEOFF_INTENT,
    pricing_authority: priced.authority,
    quote: priced.quote,
    unpriced: priced.unpriced,
  }
}

export type SaveOutcome =
  | { ok: true; created: boolean; run_id: string; status: 'saved'; measurement_id: string; measure_url: string }
  | Refusal
  | { ok: false; error: 'unpriceable'; structures: Unpriced[] }

type SavedRow = { id: string; measure_token: string }

const round2 = (n: number) => Math.round(n * 100) / 100

/** The list views' summary, summed as the website sums an included selection:
 *  over the roofs not sent to inspection, to the cent and the hundredth of a m².
 *  ponytail: mirrors narrowQuoteToStructures, which lives in the SMS module and
 *  stays out of this export; save.test.ts checks the two agree. */
function summaryOf(quote: MultiRoofQuote) {
  const quotable = quote.structures.filter((s) => s.price.routing.decision !== 'inspection_required')
  return {
    combined_area_m2: round2(quotable.reduce((total, s) => total + s.price.area_m2, 0)),
    combined_better_inc_gst: round2(quotable.reduce((total, s) => total + s.price.tiers[1].inc_gst, 0)),
  }
}

// An Australian address ends with its state and postcode: "… QLD 4305".
const STATE_POSTCODE = /\b(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\s+(\d{4})\s*$/i
const STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'] as const

/** The site's postcode and state: the run's own, else its address's tail. */
export function postcodeAndState(run: { site_address: string; postcode: string | null; state: string | null }) {
  const tail = STATE_POSTCODE.exec(run.site_address)
  const state = (run.state ?? tail?.[1] ?? '').toUpperCase()
  return {
    postcode: run.postcode ?? tail?.[2] ?? null,
    state: (STATES as readonly string[]).includes(state) ? (state as (typeof STATES)[number]) : null,
  }
}

/** Every column the save writes on roofing_measurements. The service's
 *  readiness check selects them, so a column production lacks fails readiness
 *  at deploy rather than a tradie's save; save.test.ts keeps the two in step. */
export const SAVED_COLUMNS = [
  'tenant_id', 'address', 'postcode', 'state', 'provider', 'structure_count',
  'combined_area_m2', 'combined_better_inc_gst', 'routing', 'structures', 'quote',
  'included_indices', 'public_token', 'measure_token', 'source_request_key', 'confirmed_at',
] as const

/** Saves the run's takeoff, priced, as one roofing_measurements row, and marks
 *  the run `saved`. A `needs_review` run saves only with `acceptReview`. A
 *  second save returns the same row: `source_request_key` is unique per
 *  tenant, and a saved run takes no correction. */
export async function saveTakeoff(db: SupabaseClient, input: {
  tenantId: string
  runId: string
  options?: PriceOptions
  acceptReview?: boolean
  /** The website's origin, for the /m link. */
  appUrl: string
  now?: Date
}): Promise<SaveOutcome> {
  const now = input.now ?? new Date()
  const found = await runWithTakeoff(db, input.tenantId, input.runId)
  if (!found) return { ok: false, error: 'not_found' }
  const { run, takeoff } = found
  const key = `takeoff:${run.id}`
  const answer = (row: SavedRow, created: boolean) => ({
    ok: true as const,
    created,
    run_id: run.id,
    status: 'saved' as const,
    measurement_id: row.id,
    measure_url: `${input.appUrl.replace(/\/+$/, '')}/m/${row.measure_token}`,
  })

  if (run.status === 'saved') {
    const existing = await savedRow(db, input.tenantId, key)
    if (existing) return answer(existing, false)
    // Deleted on the website since: the run's takeoff is final, so it saves again.
  } else if (run.status !== 'ready' && !(run.status === 'needs_review' && input.acceptReview)) {
    return { ok: false, error: 'run_not_ready', status: run.status }
  }
  if (!takeoff) return { ok: false, error: 'run_not_ready', status: run.status }

  const priced = await priceTakeoff(db, input.tenantId, takeoff, input.options ?? {})
  if (!priced.ok) return priced
  if (priced.unpriced.length || !priced.quote) return { ok: false, error: 'unpriceable', structures: priced.unpriced }
  const quote = { ...priced.quote, pricing_authority: priced.authority }

  const site = postcodeAndState(run)
  // A roof merged from aerial data makes the measurement a hybrid (TKO-21).
  const saved = new Set(quote.structures.map((s) => s.buildingId))
  const hybrid = takeoff.structures.some((s) => saved.has(s.id) && s.source === 'hybrid')
  const inserted = await db.from('roofing_measurements')
    .insert({
      tenant_id: run.tenant_id,
      address: run.site_address,
      postcode: site.postcode,
      state: site.state,
      provider: hybrid ? 'hybrid' : 'plans',
      structure_count: quote.structures.length,
      ...summaryOf(quote),
      routing: quote.routing.decision,
      structures: quote.structures.map(({ buildingId, role, label, inputs }) => ({ buildingId, role, label, inputs })),
      quote,
      // The save prices only the included roofs, so every saved roof is in the job.
      included_indices: quote.structures.map((_, i) => i + 1),
      ...newMeasurementTokens(),
      source_request_key: key,
      // Saving is the tradie's confirmation. released_at stays empty, and no
      // customer's name is written (Service Spec §9, §10).
      confirmed_at: now.toISOString(),
    })
    .select('id, measure_token')
    .single()
  // A save racing this one holds the key, and its row is the run's row.
  const row = (inserted.data as SavedRow | null) ?? (await savedRow(db, input.tenantId, key))
  if (!row) throw failure('measurement insert', inserted.error ?? { message: 'no row came back' })

  const linked = await db.from('roof_takeoff_runs')
    .update({ status: 'saved', roofing_measurement_id: row.id, updated_at: now.toISOString() })
    .eq('id', run.id).eq('tenant_id', run.tenant_id).in('status', PRICEABLE)
    .select('id')
  if (linked.error) throw failure('run update', linked.error)
  // ponytail: a run deleted mid-save leaves its measurement behind, as deleting a saved run does.
  if (!linked.data?.length) return { ok: false, error: 'not_found' }
  return answer(row, !inserted.error)
}

async function savedRow(db: SupabaseClient, tenantId: string, key: string): Promise<SavedRow | null> {
  const found = await db.from('roofing_measurements')
    .select('id, measure_token')
    .eq('tenant_id', tenantId).eq('source_request_key', key)
    .maybeSingle()
  if (found.error) throw failure('measurement lookup', found.error)
  return found.data as SavedRow | null
}
