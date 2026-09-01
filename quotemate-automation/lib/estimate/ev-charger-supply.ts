import type { DraftLineItem, DraftTier, DraftWithTiers } from './merge-recipes'
import type { CandidatePrices } from './validate'

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
      status: 'inspection_required'
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

function materialSourceId(line: DraftLineItem): string | null {
  const match = String(line.source ?? '').trim().match(/^material:([^\s]+)$/i)
  return match ? normalise(match[1]) : null
}

function lineAnchorIds(line: DraftLineItem): string[] {
  const ids = new Set<string>()
  const catalogueId = normalise(line.catalogue_id)
  const sourceId = materialSourceId(line)
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
  if (!(source === 'labour' || source === 'assembly' || source.startsWith('assembly:'))) return false
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
          status: 'inspection_required',
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
        status: 'inspection_required',
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
        status: 'inspection_required',
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
