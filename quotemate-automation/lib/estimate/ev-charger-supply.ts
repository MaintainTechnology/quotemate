import type { DraftLineItem, DraftTier, DraftWithTiers } from './merge-recipes'
import type { CandidatePrices } from './validate'
import {
  deriveEvSupplyPresentation,
  reconcileEvSupplyAssumptions,
  reconcileEvSupplyExclusions,
  reconcileEvSupplyScope,
  type EvSupplyPresentation,
} from '../quote/ev-supply-presentation'
import { resolveAuthorizedEvManualChargerLineIndexes } from '../quote/ev-supply-presentation'
import type { EvServiceMode } from '../quote/ev-service-mode'

/** The exact dashboard answer which means the customer, not the tradie,
 * supplies the charger unit. Keep this aligned with `job-fields.ts`. */
export const CUSTOMER_SUPPLIES_EV_CHARGER = 'customer already has the charger'

const TIERS = ['good', 'better', 'best'] as const
type TierName = (typeof TIERS)[number]

export type EvChargerMaterialRow = {
  id?: string | null
  category?: string | null
}

export type EvChargerSupplyViolation = {
  code:
    | 'unanchored_ev_charger_line'
    | 'missing_installation_work'
    | 'invalid_surviving_line_price'
  tier: TierName
  lineIndex?: number
  description?: string
}

export type RemovedEvChargerUnit = {
  tier: TierName
  lineIndex: number
  description: string
  catalogueId: string
}

export type EvChargerSupplyFenceResult<T extends DraftWithTiers = DraftWithTiers> =
  | {
      status: 'unchanged'
      changed: false
      draft: T
      removed: []
    }
  | {
      status: 'stripped'
      changed: true
      draft: T
      removed: RemovedEvChargerUnit[]
    }
  | {
      status: 'review_required'
      changed: false
      draft: T
      removed: []
      violation: EvChargerSupplyViolation
    }

export type EnforceEvChargerCustomerSupplyInput<T extends DraftWithTiers = DraftWithTiers> = {
  jobType?: string | null
  chargerSupply?: string | null
  draft: T
  /** The same candidates used by the grounding validator. Candidate ids are
   * authoritative because they came from the current tenant's price rows. */
  candidates?: CandidatePrices | null
  /** Raw catalogue rows are accepted as a second authoritative category
   * source. This is useful before candidate expansion and in focused tests. */
  materialRows?: readonly EvChargerMaterialRow[] | null
}

function normalise(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function positiveFinite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function typedSourceId(line: DraftLineItem): string | null {
  const match = String(line.source ?? '').trim().match(/^(?:material|assembly):([^\s]+)$/i)
  return match ? normalise(match[1]) : null
}

function lineAnchorIds(line: DraftLineItem): string[] {
  const ids = new Set<string>()
  const catalogueId = normalise(line.catalogue_id)
  const sourceId = typedSourceId(line)
  if (catalogueId) ids.add(catalogueId)
  if (sourceId) ids.add(sourceId)
  return [...ids]
}

function isProtectedInstallationLine(line: DraftLineItem): boolean {
  const source = normalise(line.source)
  return (
    source === 'labour' ||
    source === 'callout' ||
    source === 'call_out' ||
    source === 'sundry' ||
    source === 'sundries' ||
    source === 'risk_buffer' ||
    source === 'after_hours' ||
    source === 'tradie_manual' ||
    source === 'assembly' ||
    source.startsWith('assembly:')
  )
}

function isInstallationWork(line: DraftLineItem): boolean {
  const source = normalise(line.source)
  if (!(
    source === 'labour' ||
    source === 'after_hours' ||
    source === 'risk_buffer' ||
    source === 'assembly' ||
    source.startsWith('assembly:')
  )) return false
  const quantity = positiveFinite(line.quantity)
  return quantity === null || quantity > 0
}

/** Deliberately narrow: this is only a fail-closed ambiguity detector. A
 * positively identified unit is removed by its tenant catalogue anchor, not
 * by words in its description. */
function looksLikeEvChargerUnit(line: DraftLineItem): boolean {
  const text = normalise(line.description).replace(/[–—]/g, '-')
  if (!text) return false
  return (
    /\b(?:ev|electric vehicle)\b.{0,48}\b(?:charger|charging unit|wallbox|wall box|wall connector)\b/.test(text) ||
    /\b(?:charger|charging unit|wallbox|wall box|wall connector)\b.{0,48}\b(?:ev|electric vehicle|tesla|byd)\b/.test(text) ||
    /\b(?:tesla|byd)\b.{0,48}\b(?:charger|wallbox|wall box|wall connector)\b/.test(text) ||
    /\bwall\s*connector\b/.test(text)
  )
}

function evChargerCatalogueIds(
  candidates: CandidatePrices | null | undefined,
  materialRows: readonly EvChargerMaterialRow[] | null | undefined,
): Set<string> {
  const ids = new Set<string>()
  for (const candidate of candidates?.material ?? []) {
    const id = normalise(candidate.sourceId)
    if (id && candidate.categories.has('ev_charger')) ids.add(id)
  }
  for (const row of materialRows ?? []) {
    const id = normalise(row.id)
    if (id && normalise(row.category) === 'ev_charger') ids.add(id)
  }
  return ids
}

function recomputeSubtotal(lines: readonly DraftLineItem[]): number | null {
  let subtotal = 0
  for (const line of lines) {
    const quantity = positiveFinite(line.quantity)
    const unitPrice = positiveFinite(line.unit_price_ex_gst)
    if (quantity === null || unitPrice === null) return null
    subtotal += quantity * unitPrice
  }
  return roundMoney(subtotal)
}

function inspectionDraft(draft: DraftWithTiers): boolean {
  if (draft.needs_inspection === true) return true
  const hasTierKey = TIERS.some((tier) => Object.prototype.hasOwnProperty.call(draft, tier))
  return hasTierKey && TIERS.every((tier) => draft[tier] == null)
}

/**
 * Deterministic last-mile fence for the customer-supplied EV-charger branch.
 *
 * Charger units are removed only when their `catalogue_id` or
 * `source:material:<id>` resolves to an EV-charger row in the current
 * tenant's grounding inputs. Description matching never authorises removal;
 * it only detects an ambiguous, unanchored unit and fails closed to the
 * inspection path. The input draft is never mutated.
 */
export function enforceEvChargerCustomerSupplyFence<T extends DraftWithTiers>(
  input: EnforceEvChargerCustomerSupplyInput<T>,
): EvChargerSupplyFenceResult<T> {
  const { draft } = input
  if (
    normalise(input.jobType) !== 'ev_charger' ||
    normalise(input.chargerSupply) !== CUSTOMER_SUPPLIES_EV_CHARGER ||
    inspectionDraft(draft)
  ) {
    return { status: 'unchanged', changed: false, draft, removed: [] }
  }

  const evIds = evChargerCatalogueIds(input.candidates, input.materialRows)
  const removals = new Map<TierName, Set<number>>()
  const removed: RemovedEvChargerUnit[] = []

  // Validate the complete draft before cloning or removing anything. A single
  // ambiguous line routes the whole quote to human review and the exact input
  // object is returned for diagnostics.
  for (const tierName of TIERS) {
    const tier = draft[tierName]
    if (!tier || !Array.isArray(tier.line_items)) continue
    for (let lineIndex = 0; lineIndex < tier.line_items.length; lineIndex++) {
      const line = tier.line_items[lineIndex]
      if (isProtectedInstallationLine(line)) continue

      const anchors = lineAnchorIds(line)
      const evAnchor = anchors.find((id) => evIds.has(id))
      const source = normalise(line.source)
      const coherentSource = !source || source === 'material' || /^material:[a-z0-9_-]+$/.test(source)
      if (evAnchor && (anchors.length > 1 || !coherentSource)) {
        return {
          status: 'review_required', changed: false, draft, removed: [],
          violation: {
            code: 'unanchored_ev_charger_line', tier: tierName, lineIndex,
            description: String(line.description ?? ''),
          },
        }
      }
      if (evAnchor) {
        const tierRemovals = removals.get(tierName) ?? new Set<number>()
        tierRemovals.add(lineIndex)
        removals.set(tierName, tierRemovals)
        removed.push({
          tier: tierName,
          lineIndex,
          description: String(line.description ?? ''),
          catalogueId: evAnchor,
        })
        continue
      }

      if (looksLikeEvChargerUnit(line)) {
        return {
          status: 'review_required',
          changed: false,
          draft,
          removed: [],
          violation: {
            code: 'unanchored_ev_charger_line',
            tier: tierName,
            lineIndex,
            description: String(line.description ?? ''),
          },
        }
      }
    }
  }

  if (removed.length === 0) {
    return { status: 'unchanged', changed: false, draft, removed: [] }
  }

  const nextDraft: DraftWithTiers = { ...draft }
  for (const [tierName, tierRemovals] of removals) {
    const tier = draft[tierName] as DraftTier
    const survivors = (tier.line_items ?? []).filter((_line, index) => !tierRemovals.has(index))

    if (!survivors.some(isInstallationWork)) {
      return {
        status: 'review_required',
        changed: false,
        draft,
        removed: [],
        violation: { code: 'missing_installation_work', tier: tierName },
      }
    }

    const subtotal = recomputeSubtotal(survivors)
    if (subtotal === null) {
      const invalidIndex = survivors.findIndex(
        (line) => positiveFinite(line.quantity) === null || positiveFinite(line.unit_price_ex_gst) === null,
      )
      return {
        status: 'review_required',
        changed: false,
        draft,
        removed: [],
        violation: {
          code: 'invalid_surviving_line_price',
          tier: tierName,
          ...(invalidIndex >= 0
            ? {
                lineIndex: invalidIndex,
                description: String(survivors[invalidIndex]?.description ?? ''),
              }
            : {}),
        },
      }
    }

    nextDraft[tierName] = { ...tier, line_items: survivors, subtotal_ex_gst: subtotal }
  }

  return {
    status: 'stripped',
    changed: true,
    draft: nextDraft as T,
    removed,
  }
}

/** The exact assumption a tradie-supplied EV quote carries when the charger
 *  unit itself is not priced. Exported so the estimator and its test agree on
 *  one string instead of two that drift apart. */
export const CHARGER_SUPPLIED_SEPARATELY_ASSUMPTION =
  'Charger unit supplied separately — model and price confirmed before booking.'

/** Reconcile every EV tier after grounding and the customer-supply fence.
 * The historic name is retained for callers; the old assumption-only repair
 * left a contradictory main scope and treated any EV-looking line as a unit.
 * This changes presentation only. Catalogue-backed unit prices and installation
 * amounts remain the grounding validator's responsibility. */
export function ensureChargerSuppliedSeparatelyAssumption<T extends DraftWithTiers>(
  draft: T,
  opts: {
    jobType?: string | null
    serviceMode?: EvServiceMode | null
    chargerSupply?: string | null
    suppliedBy?: string | null
    candidates?: CandidatePrices | null
  },
): T {
  if (normalise(opts.jobType) !== 'ev_charger') return draft
  if (inspectionDraft(draft)) return draft
  const chargerCatalogueRows = [...evChargerCatalogueIds(opts.candidates, null)]
    .map((id) => ({ id, category: 'ev_charger' }))
  const suppliedBy = opts.suppliedBy ?? opts.chargerSupply
  const presentations = new Map<TierName, EvSupplyPresentation>()
  const next: DraftWithTiers = { ...draft }
  for (const tierName of TIERS) {
    const tier = draft[tierName]
    if (!tier || !Array.isArray(tier.line_items)) continue
    const presentation = deriveEvSupplyPresentation({
      jobType: opts.jobType, serviceMode: opts.serviceMode, suppliedBy, tier, chargerCatalogueRows,
    })!
    presentations.set(tierName, presentation)
    next[tierName] = {
      ...tier,
      label: `${tierName[0].toUpperCase()}${tierName.slice(1)} — ${presentation.priceLabel}`,
      description: reconcileEvSupplyScope(tier.description, presentation),
      ...(tier.scope_of_works !== undefined
        ? { scope_of_works: reconcileEvSupplyScope(tier.scope_of_works, presentation) } : {}),
    }
  }
  const selected = presentations.get(draft.selected_tier as TierName)
    ?? presentations.get('better') ?? presentations.get('good') ?? presentations.get('best')
  if (!selected) return draft
  return {
    ...next,
    scope_of_works: reconcileEvSupplyScope(draft.scope_of_works, selected),
    scope_short: selected.title,
    assumptions: reconcileEvSupplyAssumptions(draft.assumptions, selected),
    exclusions: reconcileEvSupplyExclusions(draft.exclusions, selected),
  } as unknown as T
}

/** A real GPO/outlet price is not evidence of an EV installation. Hold an EV
 * draft that substitutes only non-EV assemblies for the installation assembly.
 * Additional RCBO/outlet assemblies alongside a grounded EV assembly are kept.
 * This is a scope check, not permission to replace a line or invent a price. */
export function findEvInstallationAssemblyMismatches(
  draft: DraftWithTiers,
  opts: { jobType?: string | null; candidates: CandidatePrices },
): import('./validate').GroundingFailure[] {
  if (normalise(opts.jobType) !== 'ev_charger' || inspectionDraft(draft)) return []
  const failures: import('./validate').GroundingFailure[] = []
  for (const tierName of TIERS) {
    const lines = draft[tierName]?.line_items
    if (!Array.isArray(lines)) continue
    const assemblies = lines.flatMap((line, index) => {
      const source = normalise(line.source)
      if (!(source === 'assembly' || source.startsWith('assembly:'))) return []
      const id = source.startsWith('assembly:') ? source.slice('assembly:'.length) : normalise(line.catalogue_id)
      const rows = opts.candidates.assembly.filter((candidate) => normalise(candidate.sourceId) === id)
      return [{ line, index, rows }]
    })
    const hasValidEvAssembly = assemblies.some(({ line, rows }) => {
      const quantity = Number(line.quantity)
      const price = Number(line.unit_price_ex_gst)
      const valid = line.quantity != null && line.quantity !== '' && Number.isFinite(quantity) && quantity > 0
        && line.unit_price_ex_gst != null && line.unit_price_ex_gst !== '' && Number.isFinite(price) && price >= 0
      return valid && rows.some((row) => row.categories.has('ev_charger'))
    })
    if (!assemblies.length || hasValidEvAssembly) continue
    // Missing anchors cannot prove EV compatibility either. A loose name/price
    // grounding match must not let an unanchored outlet bypass this service
    // check. Keep it for tradie correction; never guess its category by words.
    const wrong = assemblies.find(({ rows }) => rows.length > 0) ?? assemblies[0]
    failures.push({
      tier: tierName,
      lineIndex: wrong.index,
      description: String(wrong.line.description ?? ''),
      unit: String(wrong.line.unit ?? ''),
      unit_price_ex_gst: Number(wrong.line.unit_price_ex_gst),
      expected: 'EV installation assembly required: an outlet, non-EV or unanchored assembly does not establish the requested charger installation scope.',
    })
  }
  return failures
}

export type EvServiceModeQuoteViolation = {
  code:
    | 'missing_service_mode'
    | 'missing_priced_tier'
    | 'empty_present_tier'
    | 'missing_grounded_charger_unit'
    | 'missing_chosen_product'
    | 'charger_unit_not_selected'
    | 'unexpected_charger_unit'
    | 'ungrounded_charger_unit'
    | 'missing_grounded_installation'
    | 'unexpected_installation_work'
    | 'service_mode_check_failed'
  tier?: TierName
  lineIndex?: number
  description?: string
}

export type EvServiceModeQuoteConsistency =
  | { ok: true; mode?: EvServiceMode; failures: [] }
  | { ok: false; mode?: EvServiceMode; failures: EvServiceModeQuoteViolation[] }

function hasPositivePricedQuantity(line: DraftLineItem): boolean {
  const quantity = positiveFinite(line.quantity)
  const price = positiveFinite(line.unit_price_ex_gst)
  return quantity !== null && quantity > 0 && price !== null && price > 0
}

function groundedCandidateForLine(
  line: DraftLineItem,
  candidates: CandidatePrices['material'] | CandidatePrices['assembly'],
): boolean {
  if (!hasPositivePricedQuantity(line)) return false
  const anchors = lineAnchorIds(line)
  if (anchors.length !== 1) return false
  const price = Number(line.unit_price_ex_gst)
  return candidates.some((candidate) =>
    normalise(candidate.sourceId) === anchors[0] &&
    candidate.categories.has('ev_charger') &&
    Math.abs(candidate.price - price) <= 0.5,
  )
}

/**
 * Binding EV-service invariant used both after estimation and immediately
 * before customer release. It validates every priced tier. Catalogue anchors
 * and candidate prices are the authority; description matching only detects
 * an ungrounded charger claim and never grants it.
 */
export function validateEvChargerServiceModeQuote(input: {
  jobType?: string | null
  serviceMode?: EvServiceMode | null
  draft: DraftWithTiers
  candidates: CandidatePrices
  riskFlags?: unknown
  chosenProduct?: { catalogue_id?: unknown } | null
}): EvServiceModeQuoteConsistency {
  if (normalise(input.jobType) !== 'ev_charger') {
    // This validator is deliberately EV-scoped. Non-EV callers should not use
    // the result as a general quote-readiness decision.
    return { ok: true, failures: [] }
  }
  if (!input.serviceMode) {
    return { ok: false, failures: [{ code: 'missing_service_mode' }] }
  }

  const failures: EvServiceModeQuoteViolation[] = []
  const presentTiers = TIERS.filter((tierName) => input.draft[tierName] != null)
  const pricedTiers = presentTiers.filter((tierName) => {
    const tier = input.draft[tierName]
    return !!tier && Array.isArray(tier.line_items) && tier.line_items.length > 0
  })
  for (const tierName of presentTiers) {
    if (!pricedTiers.includes(tierName)) failures.push({ code: 'empty_present_tier', tier: tierName })
  }
  if (pricedTiers.length === 0) {
    return {
      ok: false,
      mode: input.serviceMode,
      failures: [...failures, { code: 'missing_priced_tier' }],
    }
  }

  for (const tierName of pricedTiers) {
    const tier = input.draft[tierName]!
    const lines = tier.line_items ?? []
    const authorisedManual = new Set(resolveAuthorizedEvManualChargerLineIndexes({
      tierName,
      tier,
      riskFlags: input.riskFlags ?? input.draft.risk_flags,
    }))
    let groundedUnit = false
    const groundedUnitAnchors = new Set<string>()
    let hasAuthorisedManualUnit = false
    let groundedInstall = false
    let hasAnyUnit = false
    let hasInstallationWork = false

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex]
      const groundedMaterial = groundedCandidateForLine(line, input.candidates.material)
      const groundedAssembly = groundedCandidateForLine(line, input.candidates.assembly)
      const manualUnit = authorisedManual.has(lineIndex)
      const suspiciousUnit = looksLikeEvChargerUnit(line) && !isProtectedInstallationLine(line)

      if (groundedMaterial || manualUnit || suspiciousUnit) hasAnyUnit = true
      if (groundedMaterial || manualUnit) groundedUnit = true
      if (groundedMaterial) {
        for (const anchor of lineAnchorIds(line)) groundedUnitAnchors.add(anchor)
      }
      if (manualUnit) hasAuthorisedManualUnit = true
      if (suspiciousUnit && !groundedMaterial && !manualUnit) {
        failures.push({
          code: 'ungrounded_charger_unit', tier: tierName, lineIndex,
          description: String(line.description ?? ''),
        })
      }

      if (isInstallationWork(line)) {
        hasInstallationWork = true
      }
      if (groundedAssembly) groundedInstall = true
    }

    if (input.serviceMode === 'supply_only') {
      if (!groundedUnit) failures.push({ code: 'missing_grounded_charger_unit', tier: tierName })
      if (hasInstallationWork) failures.push({ code: 'unexpected_installation_work', tier: tierName })
    } else if (input.serviceMode === 'install_only') {
      if (hasAnyUnit) failures.push({ code: 'unexpected_charger_unit', tier: tierName })
      if (!groundedInstall) failures.push({ code: 'missing_grounded_installation', tier: tierName })
    } else {
      if (!groundedUnit) failures.push({ code: 'missing_grounded_charger_unit', tier: tierName })
      if (!groundedInstall) failures.push({ code: 'missing_grounded_installation', tier: tierName })
    }

    if (input.serviceMode !== 'install_only' && !hasAuthorisedManualUnit) {
      const chosenId = normalise(input.chosenProduct?.catalogue_id)
      if (!chosenId) {
        failures.push({ code: 'missing_chosen_product', tier: tierName })
      } else if (!groundedUnitAnchors.has(chosenId) || [...groundedUnitAnchors].some((id) => id !== chosenId)) {
        failures.push({ code: 'charger_unit_not_selected', tier: tierName })
      }
    }
  }

  return failures.length > 0
    ? { ok: false, mode: input.serviceMode, failures }
    : { ok: true, mode: input.serviceMode, failures: [] }
}

/**
 * Drop a HALLUCINATED, ZERO-PRICED EV charger unit line before the main
 * grounding pass.
 *
 * ponytail: this exists because of an ordering bug, not a new policy. The
 * real fence (enforceEvChargerCustomerSupplyFence) is wired at run.ts:1406,
 * but the grounding pass runs at run.ts:866 and bails straight to the
 * "hold priced draft for tradie review" branch — so on a customer-supplied
 * charger the fence never got a turn.
 *
 * Live 2026-09-04 (Sparky, +61468048422, intake 31799f4f): Opus turned the
 * WP5 description prefix "Customer to supply - ..." into the ref
 * `material:customer` and emitted it as a $0 line in all three tiers. That
 * ref matches no candidate row, so grounding failed 3/3, the quote was held
 * at quote_integrity_grounding_failed, and the customer — already told
 * "quote's on its way shortly" — received nothing at all.
 *
 * Deliberately narrow, so it can never move money:
 *   - job_type must be ev_charger;
 *   - the line must read as a charger UNIT (looksLikeEvChargerUnit);
 *   - its unit price AND total must both be zero — a priced line is left for
 *     the real fence and the grounding validator to judge;
 *   - it must NOT be an installation/labour/assembly line;
 *   - it must NOT be anchored to a real candidate row (an anchored unit is
 *     the existing fence's job).
 * A zero-priced line contributes nothing to any subtotal, so removing it
 * cannot change a quoted figure — it only removes an ungrounded ref.
 */
export function dropUnpricedPhantomEvChargerLines<T extends DraftWithTiers>(
  draft: T,
  opts: { jobType?: string | null; candidates?: CandidatePrices | null },
): { draft: T; dropped: RemovedEvChargerUnit[] } {
  if (normalise(opts.jobType) !== 'ev_charger') return { draft, dropped: [] }

  const knownIds = new Set<string>(evChargerCatalogueIds(opts.candidates, null))
  for (const candidate of opts.candidates?.material ?? []) {
    const id = normalise(candidate.sourceId)
    if (id) knownIds.add(id)
  }

  const dropped: RemovedEvChargerUnit[] = []
  let next: DraftWithTiers = draft

  for (const tierName of TIERS) {
    const tier = next[tierName] as DraftTier | undefined
    if (!tier || !Array.isArray(tier.line_items)) continue

    const keep = tier.line_items.filter((line, lineIndex) => {
      if (isProtectedInstallationLine(line)) return true
      if (!looksLikeEvChargerUnit(line)) return true
      const price = Number(line.unit_price_ex_gst ?? 0)
      const total = Number(line.total_ex_gst ?? 0)
      if (!(price === 0 && total === 0)) return true
      // Anchored to a real catalogue row → leave it to the existing fence.
      if (lineAnchorIds(line).some((id) => knownIds.has(id))) return true
      dropped.push({
        tier: tierName,
        lineIndex,
        description: String(line.description ?? ''),
        catalogueId: normalise(line.source) || 'unanchored',
      })
      return false
    })

    if (keep.length !== tier.line_items.length) {
      next = { ...next, [tierName]: { ...tier, line_items: keep } }
    }
  }

  return { draft: next as T, dropped }
}
