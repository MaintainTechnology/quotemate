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

/** The exact assumption a tradie-supplied EV quote carries when the charger
 *  unit itself is not priced. Exported so the estimator and its test agree on
 *  one string instead of two that drift apart. */
export const CHARGER_SUPPLIED_SEPARATELY_ASSUMPTION =
  'Charger unit supplied separately — model and price confirmed before booking.'

/**
 * R7 (2026-09-02) — TRADIE SUPPLIES, NOTHING STOCKED.
 *
 * The seeded "Install EV charger" assembly explicitly excludes the unit, and
 * almost no tenant stocks chargers yet. That is a gap in the price book, not a
 * hazard on site — the installation is still quotable, and the honest output
 * is a priced install with the unit called out as separate.
 *
 * Stamped deterministically, because a customer reading "supply and install a
 * 7kW EV charger" while no unit is priced is exactly the confusion the
 * 2026-09-01 incident produced. PURE: returns a new draft, never mutates the
 * input, and no-ops unless every condition holds:
 *   - the job is ev_charger
 *   - the customer is NOT supplying (that path has its own fence above)
 *   - no priced tier already carries a charger-unit line
 */
export function ensureChargerSuppliedSeparatelyAssumption<T extends DraftWithTiers>(
  draft: T,
  opts: { jobType?: string | null; chargerSupply?: string | null },
): T {
  if (normalise(opts.jobType) !== 'ev_charger') return draft
  if (normalise(opts.chargerSupply) === CUSTOMER_SUPPLIES_EV_CHARGER) return draft
  if (inspectionDraft(draft)) return draft

  const hasUnitLine = TIERS.some((tierName) => {
    const tier = draft[tierName]
    if (!tier || !Array.isArray(tier.line_items)) return false
    return tier.line_items.some(
      (line) => !isProtectedInstallationLine(line) && looksLikeEvChargerUnit(line),
    )
  })
  if (hasUnitLine) return draft

  const existing = Array.isArray((draft as Record<string, unknown>).assumptions)
    ? ((draft as Record<string, unknown>).assumptions as unknown[]).map((a) => String(a ?? ''))
    : []
  if (existing.some((a) => /charger unit supplied separately/i.test(a))) return draft

  return {
    ...draft,
    assumptions: [...existing, CHARGER_SUPPLIED_SEPARATELY_ASSUMPTION],
  } as T
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
