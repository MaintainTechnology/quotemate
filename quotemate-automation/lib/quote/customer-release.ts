import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { OutboundOptions } from '@/lib/sms/durable-outbox'
import {
  buildCandidatePrices,
  type CandidatePrices,
  type PricingBookForValidation,
  type RawCandidateRow,
} from '@/lib/estimate/validate'
import { validateEvChargerServiceModeQuote } from '@/lib/estimate/ev-charger-supply'
import { strictEvChargerServiceModeFromIntake } from '@/lib/quote/ev-service-mode'
import { deriveEvSupplyOnlyDisplayTier } from '@/lib/quote/ev-supply-presentation'
import { assertQuoteReleaseAuthority } from '@/lib/quote/release-authority'

export class EvQuoteCustomerReleaseError extends Error {
  readonly code = 'ev_service_mode_review_required'
  readonly status = 409
  constructor(readonly failures: readonly { code: string; tier?: string }[]) {
    super('EV charger service scope or catalogue pricing is incomplete. Review the quote before customer release.')
    this.name = 'EvQuoteCustomerReleaseError'
  }
}

type EvReleaseIntake = {
  job_type?: unknown
  trade?: unknown
  scope?: {
    specs?: { service_mode?: unknown } | null
    chosen_product?: { catalogue_id?: unknown } | null
  } | null
}

function normalise(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[–—]/g, '-')
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** A supply-only product sale cannot carry any persisted route back to the
 * generic $99 site-visit funnel. Shared by the release fence and the public
 * page's defensive legacy-row rendering. */
export function evSupplyOnlyHasInspectionRouteState(quote: Record<string, unknown>): boolean {
  const stripeLinks = asRecord(quote.stripe_links)
  const payLinks = asRecord(quote.pay_links)
  const routing = normalise(quote.routing_decision)
  const status = normalise(quote.status)
  return quote.needs_inspection === true ||
    normalise(quote.selected_tier) === 'inspection' ||
    routing.includes('inspection') || routing.includes('site_visit') ||
    status.includes('inspection') ||
    normalise(quote.inspection_reason).length > 0 ||
    normalise(quote.inspection_cause).length > 0 ||
    normalise(stripeLinks.inspection).length > 0 ||
    normalise(payLinks.inspection).length > 0
}

function evScopeSentences(scope: unknown): string[] {
  return normalise(scope).split(/(?<=[.!?])\s+|\r?\n|;/).map((part) => part.trim()).filter(Boolean)
}

function excludedClaim(sentence: string): boolean {
  return /\b(?:exclude[ds]?|excluding|not included|no installation|without installation)\b/.test(sentence)
}

/** Contract-text backstop. The line-item matrix alone is not enough because
 * the customer SMS includes scope_of_works verbatim. Fail release when that
 * saved contract text contradicts the canonical service mode. */
function evServiceModeScopeCompatible(mode: 'supply_only' | 'install_only' | 'supply_and_install', scope: unknown): boolean {
  const sentences = evScopeSentences(scope)
  if (sentences.length === 0) return false
  const text = sentences.join(' ')
  const supplyAndInstall = /\bsuppl(?:y|ied)\s*(?:and|&|\/)\s*install(?:ation|ed|ing)?\b/.test(text)
  const installClaim = sentences.some((sentence) =>
    /\b(?:install(?:ation|ed|ing|s)?|electrical connection|dedicated circuit|circuit work|terminat(?:e|ion)|commission(?:ing)?|test(?:ing)?|certif(?:y|ied|ication))\b/.test(sentence) &&
    !excludedClaim(sentence),
  )
  const customerSupplies =
    /\bcustomer[- ]supplied\b/.test(text) ||
    /\bcustomer\b[^.;]{0,48}\bsuppl(?:y|ies|ied)\b[^.;]{0,48}\b(?:charger|unit|wallbox|wall connector)\b/.test(text) ||
    /\b(?:charger|unit|wallbox|wall connector)\b[^.;]{0,48}\bsuppl(?:y|ied)\b[^.;]{0,24}\bby (?:the )?customer\b/.test(text)
  const tradieSupplies = supplyAndInstall ||
    /\b(?:we|tradie|contractor|business|this option)\b[^.;]{0,48}\b(?:suppl(?:y|ies|ied)|provid(?:e|es|ed)|includes?)\b[^.;]{0,48}\b(?:charger|unit|wallbox|wall connector)\b/.test(text) ||
    /\b(?:charger|unit|wallbox|wall connector)\b[^.;]{0,48}\b(?:is|will be)?\s*(?:suppl(?:y|ied)|provid(?:e|ed)|includes?)\b[^.;]{0,30}\b(?:we|tradie|contractor|business|this option)\b/.test(text)
  const unitDeferredOrExcluded = sentences.some((sentence) =>
    /\b(?:charger|charging unit|wallbox|wall connector)\b/.test(sentence) &&
    /\b(?:exclude[ds]?|excluding|not included|pending|to be confirmed|supplied separately|price[^.;]{0,24}confirm)\b/.test(sentence),
  )

  if (mode === 'supply_only') {
    const supplyOnly = /\bsupply[- ]only\b/.test(text) ||
      (/\bsuppl(?:y|ied)\b/.test(text) && /\b(?:charger|unit|wallbox|wall connector)\b/.test(text))
    const excludesInstallation = sentences.some((sentence) =>
      /\binstall(?:ation|ed|ing|s)?\b/.test(sentence) && excludedClaim(sentence))
    const excludesElectricalWork = sentences.some((sentence) =>
      /\belectrical work\b/.test(sentence) && excludedClaim(sentence))
    return supplyOnly && excludesInstallation && excludesElectricalWork &&
      !supplyAndInstall && !installClaim && !/\bcertif(?:y|ied|ication)\b/.test(text)
  }
  if (mode === 'install_only') {
    return installClaim && customerSupplies && !supplyAndInstall && !tradieSupplies
  }
  return installClaim && tradieSupplies && !unitDeferredOrExcluded
}

async function loadEvReleaseCandidates(
  db: SupabaseClient,
  input: { tenantId: string; trade: string; pricingBook: PricingBookForValidation },
) {
  const sharedMaterials = db.from('shared_materials').select('*').eq('trade', input.trade)
  const sharedAssemblies = db.from('shared_assemblies').select('*').eq('trade', input.trade)
  const tenantMaterials = db.from('tenant_material_catalogue').select('*')
    .eq('tenant_id', input.tenantId).eq('trade', input.trade)
  const tenantAssemblies = db.from('tenant_custom_assemblies').select('*')
    .eq('tenant_id', input.tenantId).eq('trade', input.trade)
  const results = await Promise.all([
    sharedMaterials, sharedAssemblies, tenantMaterials, tenantAssemblies,
  ])
  const failed = results.find((result) => result.error)
  if (failed?.error) throw new EvQuoteCustomerReleaseError([{ code: 'catalogue_evidence_unavailable' }])

  const [sharedMaterialRows, sharedAssemblyRows, tenantMaterialRows, tenantAssemblyRows] =
    results.map((result) => Array.isArray(result.data) ? result.data as Record<string, unknown>[] : [])
  const materials: RawCandidateRow[] = [
    ...sharedMaterialRows.map((row) => ({
      id: String(row.id ?? ''), name: String(row.name ?? ''),
      price: row.default_unit_price_ex_gst as number | string | null | undefined,
      category: typeof row.category === 'string' ? row.category : null,
    })),
    ...tenantMaterialRows.flatMap((row) => {
      const base = {
        id: String(row.id ?? ''), name: String(row.name ?? ''),
        category: typeof row.category === 'string' ? row.category : null,
      }
      return [
        { ...base, price: row.unit_price_ex_gst as number | string | null | undefined },
        { ...base, price: row.customer_supply_price_ex_gst as number | string | null | undefined },
      ]
    }),
  ]
  const assemblies: RawCandidateRow[] = [
    ...sharedAssemblyRows,
    ...tenantAssemblyRows,
  ].map((row) => ({
    id: String(row.id ?? ''), name: String(row.name ?? ''),
    price: row.default_unit_price_ex_gst as number | string | null | undefined,
    category: typeof row.category === 'string' ? row.category : null,
  }))
  return buildCandidatePrices(materials, assemblies, input.pricingBook)
}

export async function assertEvQuoteCustomerReleaseAllowed(db: SupabaseClient, input: {
  quote: Record<string, unknown>
  intake?: EvReleaseIntake | null
  tenantId: string
  pricingBook?: Record<string, unknown> | null
  /** Reuse candidates already loaded by a trusted caller (for example the
   * edit grounding gate) so release validation does not perform a second,
   * potentially different catalogue read. */
  candidates?: CandidatePrices | null
}): Promise<void> {
  if (String(input.intake?.job_type ?? '').trim().toLowerCase() !== 'ev_charger') return
  // A balance row is a tier-less payment request and the generic send route
  // rejects it before customer delivery. A final quote still contains binding
  // EV scope and prices, so it must pass the same service-mode fence as an
  // initial quote.
  if (String(input.quote.quote_kind ?? '').trim().toLowerCase() === 'balance') return

  const mode = strictEvChargerServiceModeFromIntake(input.intake)
  const trade = String(input.intake?.trade ?? '').trim().toLowerCase()
  const pricingBook = input.pricingBook as PricingBookForValidation | null | undefined
  if (!mode || !trade || !pricingBook || !Number.isFinite(Number(pricingBook.default_markup_pct))) {
    throw new EvQuoteCustomerReleaseError([{ code: !mode ? 'missing_service_mode' : 'catalogue_evidence_unavailable' }])
  }
  const releaseFailures: Array<{ code: string; tier?: string }> = []
  if (mode === 'supply_only' && evSupplyOnlyHasInspectionRouteState(input.quote)) {
    releaseFailures.push({ code: 'supply_only_inspection_route' })
  }
  if (mode === 'supply_only') {
    for (const tier of ['good', 'better', 'best'] as const) {
      if (input.quote[tier] != null &&
          deriveEvSupplyOnlyDisplayTier(input.quote[tier] as Parameters<typeof deriveEvSupplyOnlyDisplayTier>[0]).status === 'review_required') {
        releaseFailures.push({ code: 'supply_only_tier_presentation_conflict', tier })
      }
    }
  }
  if (!evServiceModeScopeCompatible(mode, input.quote.scope_of_works)) {
    releaseFailures.push({ code: 'service_mode_scope_conflict' })
  }
  if (releaseFailures.length > 0) throw new EvQuoteCustomerReleaseError(releaseFailures)
  const candidates = input.candidates ?? await loadEvReleaseCandidates(db, {
    tenantId: input.tenantId, trade, pricingBook,
  })
  const consistency = validateEvChargerServiceModeQuote({
    jobType: 'ev_charger', serviceMode: mode,
    draft: input.quote,
    candidates,
    riskFlags: input.quote.risk_flags,
    chosenProduct: input.intake?.scope?.chosen_product ?? null,
  })
  if (!consistency.ok) throw new EvQuoteCustomerReleaseError(consistency.failures)
}

export function genericQuoteReleased(quote: Record<string, unknown>): boolean {
  return !!quote.customer_released_at || !!quote.paid_at || !!quote.sent_at ||
    ['sent', 'accepted', 'paid'].includes(String(quote.status))
}

/** Stable across approve/send entry points and retries; only deliberate resends get a new ID. */
export function genericQuoteSendKey(quoteId: string, requestId?: unknown): string {
  if (requestId !== undefined && (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))) {
    throw new Error('invalid_request_id')
  }
  // PostgreSQL UUID identity is case-insensitive. The route parameter, returned
  // row and recovery query must select the same durable intent for that ID.
  return `quote-release:generic:${quoteId.toLowerCase()}:${requestId ? `resend:${(requestId as string).toLowerCase()}` : 'initial'}`
}

const SNAPSHOT_FIELDS = ['share_token','intake_id','good','better','best','total_inc_gst','selected_tier',
  'scope_of_works','assumptions','estimated_timeframe','needs_inspection','inspection_reason','deposit_pct',
  'display_mode','applied_discount_pct','quote_kind','parent_quote_id','pricing_book_version_id','report_doc','report_style'] as const

function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical)
  if(value && typeof value === 'object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,canonical(entry)]))
  return value ?? null
}
/** The complete saved content checked atomically by migration215 before release. */
export function quoteCustomerReleaseSnapshot(quote:Record<string,unknown>):Record<string,unknown> {
  return Object.fromEntries(SNAPSHOT_FIELDS.map(key => [key, quote[key] ?? null]))
}
export function quoteCustomerReleaseRevision(quote:Record<string,unknown>):string {
  return createHash('sha256').update(JSON.stringify(canonical(quoteCustomerReleaseSnapshot(quote)))).digest('hex')
}
export function quoteReleaseReviewMatches(quote:Record<string,unknown>,expected:unknown):boolean {
  if(expected === undefined && genericQuoteReleased(quote))return true
  return typeof expected === 'string' && expected === quoteCustomerReleaseRevision(quote)
}

export async function persistGenericQuoteRelease(db: SupabaseClient, input: {
  quote: Record<string, unknown>; tenantId: string; ownerId: string; holdUntil: string | null
  intake?: EvReleaseIntake | null
  pricingBook?: Record<string, unknown> | null
  outbound?: OutboundOptions
  signMediaUrl?: (path: string) => Promise<string>
}): Promise<{ outbound: OutboundOptions | null; outboxId: string | null }> {
  const core = await assertQuoteReleaseAuthority(db, input.quote, input.tenantId, input.intake)
  // Keep every existing EV scope guard, but verify a core quote against its
  // captured catalogue rather than today's mutable tenant prices.
  const frozenCandidates = core?.status === 'priced' ? buildCandidatePrices(
    core.sourceSnapshot.tenantMaterials.map(material => ({ id: material.id, name: material.name,
      price: material.unit_price_ex_gst, category: material.category })),
    [], { ...(input.pricingBook ?? {}), default_markup_pct: core.sourceSnapshot.markupPct } as PricingBookForValidation,
    { strictMarkup: true },
  ) : undefined
  await assertEvQuoteCustomerReleaseAllowed(db, { ...input, ...(frozenCandidates ? { candidates: frozenCandidates } : {}) })
  const snapshot = quoteCustomerReleaseSnapshot(input.quote)
  const outbound = input.outbound ? { ...input.outbound, quoteReleaseId: input.quote.id,
    quoteReleaseRevision: quoteCustomerReleaseRevision(input.quote), quoteReleaseSnapshot: snapshot } : null
  if (outbound && process.env.SMS_QUOTE_PDF_MMS === '1' && typeof outbound.mediaKey === 'string' && input.signMediaUrl) {
    try { outbound.mediaUrl = await input.signMediaUrl(outbound.mediaKey) } catch { /* Body retains the stable PDF link. */ }
  }
  const hash = outbound ? createHash('sha256').update(JSON.stringify([
    outbound.tenantId ?? null, outbound.to, outbound.from ?? null, outbound.text,
    outbound.mediaKey ?? null, outbound.audience ?? 'customer',
  ])).digest('hex') : null
  const { data, error } = await db.rpc('approve_generic_quote_release', {
    p_quote_id: input.quote.id, p_tenant_id: input.tenantId, p_owner_id: input.ownerId,
    p_snapshot: snapshot,
    p_hold_until: input.holdUntil, p_outbound: outbound, p_hash: hash,
  })
  if (error || !data?.approved) throw new Error('Could not save approval and customer delivery. Refresh the quote before retrying.')
  return { outbound: data.outbound ?? null, outboxId: data.outbox_id ?? null }
}
