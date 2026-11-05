/** One price/scope interpretation for EV estimates, public quotes and documents.
 * Catalogue identity proves what the line supplies; the grounding validator owns
 * price authority. Renderers deliberately do not reprice historical quotes. */
import { normaliseEvServiceMode, type EvServiceMode } from './ev-service-mode'

export type EvSupplyLine = {
  source?: unknown
  catalogue_id?: unknown
  description?: unknown
  quantity?: unknown
  unit_price_ex_gst?: unknown
  total_ex_gst?: unknown
}

export type EvSupplyCatalogueRow = {
  id?: string | null
  category?: string | null
  active?: boolean | null
}

export type EvSupplyPresentation = {
  state: 'customer_supplied' | 'tradie_supply_included' | 'tradie_supply_pending' | 'supply_unresolved'
  title: string
  priceLabel: string
  supplyNotice: string
  exclusions: string[]
  unitLineIndexes: number[]
  unitExcluded: boolean
  serviceMode?: EvServiceMode
  installationIncluded: boolean
}

export type EvSupplyOnlyDisplayTier = {
  label?: unknown
  subtotal_ex_gst?: unknown
  line_items?: readonly EvSupplyLine[]
}

export type EvSupplyOnlyDisplayTierResult =
  | { status: 'safe'; tier: EvSupplyOnlyDisplayTier; rejectedLineIndexes: [] }
  | { status: 'review_required'; tier: null; rejectedLineIndexes: number[] }

type EvSupplyInput = {
  jobType?: string | null
  serviceMode?: unknown
  suppliedBy?: string | null
  tier?: { line_items?: readonly EvSupplyLine[] } | null
  chargerCatalogueRows?: readonly EvSupplyCatalogueRow[] | null
  /** Only pass indexes independently authorised by the tradie write boundary.
   * A model-emitted source='tradie_manual' is never authority by itself. */
  authorizedManualChargerLineIndexes?: readonly number[]
}

const NOTICES = {
  supply_only_included: 'Supply only. This option includes the EV charger unit listed in its priced items. Installation and all electrical work are excluded.',
  supply_only_pending: 'Supply-only request pending. A charger model and positive supply price must be selected by the tradie before this quote can be released. Installation and all electrical work are excluded.',
  customer_supplied: 'Installation only. The customer supplies the charger unit; its supply cost is excluded from this estimate.',
  tradie_supply_included: 'This option includes the charger unit listed in its priced items and the listed installation work.',
  tradie_supply_pending: 'Installation estimate excluding the charger unit. You have requested that we supply the charger. Its model, specification and supply price require tradie confirmation; the complete supply-and-install total is pending.',
  supply_unresolved: 'Charger supply responsibility has not been confirmed. This amount must not be treated as a complete supply-and-install quote; the charger and its supply price require tradie confirmation.',
} as const

function normalise(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function amount(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function hasPricedQuantity(line: EvSupplyLine): boolean {
  const quantity = amount(line.quantity)
  const price = amount(line.unit_price_ex_gst)
  if (quantity === null || quantity <= 0 || price === null || price <= 0) return false
  if (line.total_ex_gst != null) {
    const total = amount(line.total_ex_gst)
    if (total === null || total <= 0 || Math.abs(total - quantity * price) > 0.5) return false
  }
  return true
}

function anchoredCharger(line: EvSupplyLine, ids: ReadonlySet<string>): boolean {
  const source = normalise(line.source)
  // Assemblies, labour and manual lines can never masquerade as a product by
  // carrying an enriched catalogue_id. Unknown/malformed sources fail closed.
  if (source && source !== 'material' && !/^material:[a-z0-9_-]+$/.test(source)) return false
  const sourceId = source.startsWith('material:') ? source.slice('material:'.length) : ''
  const catalogueId = normalise(line.catalogue_id)
  if (catalogueId && !/^[a-z0-9_-]+$/.test(catalogueId)) return false
  if (sourceId && catalogueId && sourceId !== catalogueId) return false
  const id = sourceId || catalogueId
  return !!id && ids.has(id)
}

export function deriveEvSupplyPresentation(input: EvSupplyInput): EvSupplyPresentation | null {
  if (normalise(input.jobType) !== 'ev_charger') return null
  const ids = new Set((input.chargerCatalogueRows ?? [])
    .filter((row) => row.active !== false && normalise(row.category) === 'ev_charger')
    .map((row) => normalise(row.id)).filter(Boolean))
  const authorizedManual = new Set(input.authorizedManualChargerLineIndexes ?? [])
  const unitLineIndexes: number[] = []
  for (const [index, line] of (input.tier?.line_items ?? []).entries()) {
    if (!line || !hasPricedQuantity(line)) continue
    const isAuthorizedManual = normalise(line.source) === 'tradie_manual' && authorizedManual.has(index)
    if (isAuthorizedManual || anchoredCharger(line, ids)) unitLineIndexes.push(index)
  }
  const serviceMode = normaliseEvServiceMode(input.serviceMode)
  const supplyOnly = serviceMode === 'supply_only'
  const supplier = normalise(input.suppliedBy)
  const customer = serviceMode === 'install_only' ||
    (!serviceMode && (supplier === 'customer' || supplier === 'customer already has the charger'))
  const tradie = serviceMode === 'supply_only' || serviceMode === 'supply_and_install' ||
    (!serviceMode && (supplier === 'tradie' || supplier === 'we supply the charger'))
  const state = customer ? 'customer_supplied'
    : !tradie ? 'supply_unresolved'
    : unitLineIndexes.length > 0 ? 'tradie_supply_included' : 'tradie_supply_pending'
  const unitExcluded = state === 'customer_supplied' || state === 'tradie_supply_pending'
  const supplyNotice = supplyOnly
    ? unitLineIndexes.length > 0 ? NOTICES.supply_only_included : NOTICES.supply_only_pending
    : NOTICES[state]
  return {
    state,
    title: supplyOnly ? 'EV charger supply only'
      : state === 'tradie_supply_included' ? 'EV charger supply and installation'
      : state === 'supply_unresolved' ? 'EV charger estimate — supply pending confirmation'
      : 'EV charger installation estimate',
    priceLabel: supplyOnly ? (unitLineIndexes.length > 0 ? 'EV charger supply only' : 'Supply-only price pending')
      : state === 'tradie_supply_included' ? 'Supply and installation estimate'
      : state === 'supply_unresolved' ? 'Estimate — charger supply unconfirmed'
      : 'Installation estimate (charger unit excluded)',
    supplyNotice,
    exclusions: supplyOnly ? [
      'Installation and all electrical work, including connection and circuit work.',
      ...(unitLineIndexes.length > 0 ? [] : ['EV charger unit until a model and positive supply price are confirmed.']),
    ] : state === 'customer_supplied' ? ['Charger unit supply — supplied by the customer.']
      : state === 'tradie_supply_pending' ? ['Charger unit supply and its cost — to be confirmed and priced by the tradie.'] : [],
    unitLineIndexes,
    unitExcluded,
    serviceMode,
    installationIncluded: !supplyOnly,
  }
}

/**
 * Defensive public-surface boundary for a supply-only tier.
 *
 * A renderer must never hide installation rows while retaining the stored tier
 * subtotal: that would make the item allocation disagree with the immutable
 * quote total. Instead, any assembly/labour/electrical-install line makes the
 * complete tier unavailable for priced display. A safe result is a shallow
 * copy so customer renderers have an explicit display view rather than reading
 * the mutable persistence object directly.
 */
export function deriveEvSupplyOnlyDisplayTier(
  tier: EvSupplyOnlyDisplayTier | null | undefined,
): EvSupplyOnlyDisplayTierResult {
  if (!tier || !Array.isArray(tier.line_items) || tier.line_items.length === 0) {
    return { status: 'review_required', tier: null, rejectedLineIndexes: [] }
  }

  const rejectedLineIndexes: number[] = []
  for (const [index, line] of tier.line_items.entries()) {
    const source = normalise(line?.source)
    const description = normalise(line?.description).replace(/[–—]/g, '-')
    const installationSource =
      source === 'labour' || source === 'after_hours' || source === 'risk_buffer' ||
      source === 'callout' || source === 'call_out' || source === 'sundry' ||
      source === 'sundries' || source === 'assembly' || source.startsWith('assembly:')
    const installationDescription =
      /\b(?:install(?:ation|ing)?|licensed electrician|electrical (?:connection|work)|dedicated circuit|circuit protection|rcbo|isolation switch|terminat(?:e|ion)|commission(?:ing)?|test(?:ing)?|certif(?:y|ied|ication))\b/.test(description)
    if (installationSource || installationDescription) rejectedLineIndexes.push(index)
  }

  if (rejectedLineIndexes.length > 0) {
    return { status: 'review_required', tier: null, rejectedLineIndexes }
  }
  return {
    status: 'safe',
    tier: { ...tier, label: 'EV charger supply only', line_items: [...tier.line_items] },
    rejectedLineIndexes: [],
  }
}

/** Resolve the existing authenticated quote-editor audit markers. Call only
 * with stored server risk_flags; generation strips these markers from model
 * output. A marker for a different tier or a reassigned non-unit line grants
 * no supply authority. This classifies a manual line, never changes its price. */
export function resolveAuthorizedEvManualChargerLineIndexes(input: {
  tierName: string
  tier?: { line_items?: readonly EvSupplyLine[] } | null
  riskFlags: unknown
}): number[] {
  if (!['good', 'better', 'best'].includes(input.tierName)) return []
  const flags = new Set(Array.isArray(input.riskFlags)
    ? input.riskFlags.filter((flag): flag is string => typeof flag === 'string') : [])
  const indexes: number[] = []
  for (const [index, line] of (input.tier?.line_items ?? []).entries()) {
    if (!line || normalise(line.source) !== 'tradie_manual' || !hasPricedQuantity(line)) continue
    if (!flags.has(`tradie_manual_line:${input.tierName}#${index}`)) continue
    const description = normalise(line.description)
    const unitDescription = /\b(?:ev|electric vehicle)\b.{0,40}\bcharger\b|\b(?:charger unit|wallbox|wall box|wall connector)\b/.test(description)
    const installOnly = /\b(?:install(?:ation)?[- ]only|labour|labor|assembly|sundr(?:y|ies)|accessor(?:y|ies)|bracket|adapter|circuit|cabl(?:e|ing)|rcbo|assessment|health check|repair|service|maintenance|customer[- ]supplied|customer (?:to|will) supply)\b/.test(description)
      || (/\b(?:install|installation|mount|mounting)\b/.test(description) && !/\bsuppl(?:y|ied|ies)\b/.test(description))
    if (unitDescription && !installOnly) indexes.push(index)
  }
  return indexes
}

const CHARGER_WORDS = /\b(?:charger|charging unit|wallbox|wall box|wall connector)\b/i

function isChargerSupplyStatement(value: string): boolean {
  if (!CHARGER_WORDS.test(value)) return false
  // "RCBO included in the charger installation" is installation detail, not
  // a claim that the charger unit is supplied. Match the unit/supplier clause.
  return /\b(?:suppl(?:y|ied|ies|ying)|provid(?:e|ed|es)|exclud(?:e[ds]?|ing))\b[^.;]{0,45}\b(?:charger|wallbox|wall connector)\b/i.test(value)
    || /\b(?:charger(?:\s+unit)?|wallbox|wall connector)\s+(?:(?:is|will|be|to|must|not|already)\s+)*(?:suppl(?:y|ied)|includ(?:e[ds]?|ing)|exclud(?:e[ds]?|ing)|(?:model|price|model and price)[^.;]{0,45}(?:confirm|separate|pending))/i.test(value)
}

function sentences(value: string): string[] {
  // A decimal distance (6.5 m) is one detail, not two sentences.
  return value.split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean)
}

function withoutGeneratedNotice(text: string): string {
  let result = text
  for (const notice of Object.values(NOTICES)) result = result.replaceAll(notice, '')
  return result.trim()
}

function removeUnitSupplyClauses(text: string): string {
  if (!isChargerSupplyStatement(text)) return text
  return sentences(text).flatMap((sentence) => {
    if (!isChargerSupplyStatement(sentence)) return [sentence]
    // Preserve the rest of a compound assumption/exclusion. Only split a
    // clause further if it still carries the unit-supply statement, so
    // "trenching and asbestos removal excluded" remains together.
    return sentence.split(/;\s*|,\s+(?=[a-z])/i).flatMap((clause) => {
      if (!isChargerSupplyStatement(clause)) return [clause]
      return clause.split(/\s+and\s+(?!price\b|model\b|specifications?\b)/i)
        .filter((part) => !isChargerSupplyStatement(part))
    })
  }).filter(Boolean).join(' ').trim()
}

/** Preserve the job location, distances and work details while replacing the
 * unverified supply promise. The prominent amount label is supplied separately. */
export function reconcileEvSupplyScope(scope: unknown, presentation: EvSupplyPresentation): string {
  if (presentation.serviceMode === 'supply_only') return presentation.supplyNotice
  let detail = withoutGeneratedNotice(typeof scope === 'string' ? scope : '')
  // Supply responsibility and inclusion are stated once by the deterministic
  // notice. Normalise the installation verb before removing obsolete supply
  // clauses, otherwise a mixed "supply and install ... at the garage" sentence
  // could discard the actual installation detail.
  detail = sentences(detail).map((part) => {
    if (!CHARGER_WORDS.test(part)) return part
    return part
      .replace(/\bsupply\s*(?:and|&|\/)\s*install(?:ation of)?(?=[^.\n]{0,120}\b(?:charger|wallbox|wall connector)\b)/gi, 'Install')
      .replace(/\bsupplied\s*(?:and|&)\s*installed(?=[^.\n]{0,120}\b(?:charger|wallbox|wall connector)\b)/gi, 'installed')
      .replace(/\b(?:customer|tradie|contractor|business)[- ]supplied\b/gi, '')
      .replace(/\bsupply\s*(?:and|&|\/)\s*install(?:ation)?\b/gi, 'installation')
  }).join(' ')
  detail = removeUnitSupplyClauses(detail)
  if (presentation.state === 'tradie_supply_included') {
    detail = detail.replace(/\binstallation[- ]only\b/gi, 'installation')
  } else {
    if (presentation.state !== 'customer_supplied') {
      // The property supply does not specify charger power/phase. Without a
      // priced unit, keep site phase/distance details but do not certify a
      // model-generated "7kW three-phase charger" as the supplied product.
      detail = detail
      .replace(/\b(?:\d+(?:\.\d+)?\s*kW|(?:single|three|one|1|3)[-\s]*phase)[,\s]*(?=(?:(?:\d+(?:\.\d+)?\s*kW|(?:single|three|one|1|3)[-\s]*phase)[,\s]*)?(?:EV\s+|electric vehicle\s+)?(?:charger|wallbox|wall connector)\b)/gi, '')
    }
  }
  detail = detail.trim()
  if (detail && !/[.!?]$/.test(detail)) detail += '.'
  return [detail, presentation.supplyNotice].filter(Boolean).join(' ')
}

function reconcileList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const retained: string[] = []
  for (const entry of values) {
    if (typeof entry !== 'string') continue
    const cleaned = withoutGeneratedNotice(entry)
    if (!cleaned) continue
    // Split only when a charger-supply statement conflicts with the authoritative
    // notice. Unrelated site/capacity/wiring assumptions survive verbatim.
    const remaining = removeUnitSupplyClauses(cleaned)
    if (remaining) retained.push(remaining)
  }
  return [...new Set(retained)]
}

export function reconcileEvSupplyAssumptions(assumptions: unknown, presentation: EvSupplyPresentation): string[] {
  if (presentation.serviceMode === 'supply_only') return [presentation.supplyNotice]
  return [...reconcileList(assumptions), presentation.supplyNotice]
}

export function reconcileEvSupplyExclusions(exclusions: unknown, presentation: EvSupplyPresentation): string[] {
  if (presentation.serviceMode === 'supply_only') return presentation.exclusions
  return [...reconcileList(exclusions), ...presentation.exclusions]
}
