/** Pure monetary authority. Callers load and verify the tenant's approved sources;
 * model output may name a source, but may never supply its price or approval. */
export type QuoteServiceMode = 'supply_only' | 'install_only' | 'supply_and_install'
export type QuoteLineRole = 'supply' | 'installation_material' | 'labour' | 'material'
export type DecimalInput = number | string

export interface ApprovedQuoteSource {
  id: string
  tenantId: string
  pricingBookVersionId: string
  approved: boolean
  active: boolean
  kind: 'catalogue' | 'labour_rate'
  unitPriceCents: number
}

export interface QuoteCoreInput {
  tenantId: string
  pricingBookVersionId: string
  recipeSourceId: string
  serviceMode: QuoteServiceMode
  gstRegistered: boolean
  sources: ApprovedQuoteSource[]
  lines: Array<{
    id: string
    sourceId: string
    role: QuoteLineRole
    quantity: DecimalInput
    markupPct: DecimalInput
  }>
}

export type QuoteCoreFailureCode =
  | 'missing_authority'
  | 'missing_price'
  | 'unapproved_source'
  | 'source_scope_mismatch'
  | 'ambiguous_source'
  | 'invalid_amount'
  | 'invalid_quantity'
  | 'invalid_markup'
  | 'unsupported_service_mode'
  | 'service_mode_conflict'

export interface QuoteCoreFailure {
  ok: false
  code: QuoteCoreFailureCode
  reason: string
}

export interface QuoteCalculation {
  version: 'quote-core-v1'
  currency: 'AUD'
  tenantId: string
  pricingBookVersionId: string
  recipeSourceId: string
  serviceMode: QuoteServiceMode
  rounding: 'half_up_unit_then_line_then_gst'
  gstRegistered: boolean
  labourPolicy?: { recipeHours: string; minimumHours: string; billableHours: string }
  lines: Array<{
    id: string
    sourceId: string
    role: QuoteLineRole
    quantity: string
    markupPct: string
    sourceUnitPriceCents: number
    unitPriceCents: number
    totalExGstCents: number
  }>
  subtotalExGstCents: number
  gstCents: number
  totalIncGstCents: number
}

export type QuoteCoreResult = { ok: true; calculation: QuoteCalculation } | QuoteCoreFailure

const ZERO = BigInt(0)
const ONE = BigInt(1)
const TWO = BigInt(2)
const HUNDRED = BigInt(100)
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)

/** Parse the decimal representation exactly, including numeric scientific notation.
 * Bounded length/exponent avoids allocating huge integers from corrupt input. */
function decimal(value: DecimalInput): { numerator: bigint; denominator: bigint; text: string } | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'number' && !Number.isFinite(value)) return null
  const text = String(value).trim()
  if (text.length > 64) return null
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text)
  if (!match) return null
  const exponent = Number(match[3] ?? 0)
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 20) return null
  const fraction = match[2] ?? ''
  const places = fraction.length - exponent
  if (Math.abs(places) > 40) return null
  const numerator = BigInt(match[1] + fraction) * (places < 0 ? BigInt(10) ** BigInt(-places) : ONE)
  const denominator = places > 0 ? BigInt(10) ** BigInt(places) : ONE
  return { numerator, denominator, text }
}

function rounded(numerator: bigint, denominator: bigint): bigint {
  return (numerator * TWO + denominator) / (denominator * TWO)
}

function safeNumber(value: bigint): number | null {
  return value >= ZERO && value <= MAX_SAFE ? Number(value) : null
}

/** Converts an approved DB price into cents without a binary float multiplication.
 * Sub-cent source prices are invalid, rather than silently altered. */
export function exactPriceCents(value: DecimalInput): number | null {
  const parsed = decimal(value)
  if (!parsed || (parsed.numerator * HUNDRED) % parsed.denominator !== ZERO) return null
  return safeNumber(parsed.numerator * HUNDRED / parsed.denominator)
}

/** A legacy number-valued recipe composer may only consume decimals whose
 * numeric round-trip preserves their exact value. */
export function exactDecimalNumber(value: DecimalInput, maxDecimalPlaces?: number): number | null {
  const parsed = decimal(value)
  if (!parsed) return null
  if (maxDecimalPlaces !== undefined && (!Number.isInteger(maxDecimalPlaces) || maxDecimalPlaces < 0 || maxDecimalPlaces > 20 ||
      parsed.numerator * (BigInt(10) ** BigInt(maxDecimalPlaces)) % parsed.denominator !== ZERO)) return null
  const number = Number(parsed.text)
  const roundTrip = decimal(number)
  return roundTrip && parsed.numerator * roundTrip.denominator === roundTrip.numerator * parsed.denominator ? number : null
}

/** Markup rounds once at the unit-price boundary; quantities round once per line. */
export function exactMarkedUpCents(priceCents: number, markupPct: DecimalInput): number | null {
  const pct = decimal(markupPct)
  if (!Number.isSafeInteger(priceCents) || priceCents < 0 || !pct) return null
  return safeNumber(rounded(BigInt(priceCents) * (HUNDRED * pct.denominator + pct.numerator), HUNDRED * pct.denominator))
}

const failure = (code: QuoteCoreFailureCode, reason: string): QuoteCoreFailure => ({ ok: false, code, reason })
const hasId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

export function calculateAuthoritativeQuote(input: QuoteCoreInput): QuoteCoreResult {
  if (!hasId(input.tenantId) || !hasId(input.pricingBookVersionId) || !hasId(input.recipeSourceId) ||
      typeof input.gstRegistered !== 'boolean') {
    return failure('missing_authority', 'Tenant, pricing book version, recipe source and GST policy are required')
  }
  if (!['supply_only', 'install_only', 'supply_and_install'].includes(input.serviceMode)) {
    return failure('unsupported_service_mode', 'An explicit service mode is required')
  }
  if (!Array.isArray(input.sources) || !Array.isArray(input.lines) || input.lines.length === 0) {
    return failure('missing_price', 'No approved quote lines are available')
  }
  const sources = new Map<string, ApprovedQuoteSource>()
  for (const source of input.sources) {
    if (!hasId(source.id)) return failure('missing_authority', 'Every price source requires an ID')
    if (sources.has(source.id)) return failure('ambiguous_source', `Duplicate price source: ${source.id}`)
    sources.set(source.id, source)
  }
  const lineIds = new Set<string>()
  const lines: QuoteCalculation['lines'] = []
  let subtotal = ZERO
  for (const line of input.lines) {
    if (!hasId(line.id) || lineIds.has(line.id)) return failure('ambiguous_source', 'Quote line IDs must be present and unique')
    lineIds.add(line.id)
    const source = sources.get(line.sourceId)
    if (!source) return failure('missing_price', `Missing price source: ${line.sourceId}`)
    if (source.tenantId !== input.tenantId || source.pricingBookVersionId !== input.pricingBookVersionId) {
      return failure('source_scope_mismatch', `Price source is outside the approved tenant/book: ${source.id}`)
    }
    if (source.approved !== true || source.active !== true) {
      return failure('unapproved_source', `Price source is not approved and active: ${source.id}`)
    }
    if (!['supply', 'installation_material', 'labour', 'material'].includes(line.role) ||
        (line.role === 'labour' ? source.kind !== 'labour_rate' : source.kind !== 'catalogue') ||
        (input.serviceMode === 'supply_only' && line.role !== 'supply') ||
        (input.serviceMode === 'install_only' && (line.role === 'supply' || line.role === 'material'))) {
      return failure('service_mode_conflict', `Line ${line.id} is not authorised for this service mode`)
    }
    if (!Number.isSafeInteger(source.unitPriceCents) || source.unitPriceCents < 0) {
      return failure('invalid_amount', `Invalid source price: ${source.id}`)
    }
    const quantity = decimal(line.quantity)
    if (!quantity || quantity.numerator <= ZERO) return failure('invalid_quantity', `Invalid quantity: ${line.id}`)
    const markup = decimal(line.markupPct)
    if (!markup) return failure('invalid_markup', `Invalid markup: ${line.id}`)
    const unitPriceCents = exactMarkedUpCents(source.unitPriceCents, line.markupPct)
    if (unitPriceCents === null) return failure('invalid_amount', `Marked-up price overflows: ${line.id}`)
    const total = rounded(BigInt(unitPriceCents) * quantity.numerator, quantity.denominator)
    const totalExGstCents = safeNumber(total)
    if (totalExGstCents === null) return failure('invalid_amount', `Line total overflows: ${line.id}`)
    subtotal += total
    lines.push({
      id: line.id, sourceId: source.id, role: line.role,
      quantity: quantity.text, markupPct: markup.text,
      sourceUnitPriceCents: source.unitPriceCents, unitPriceCents, totalExGstCents,
    })
  }
  const gst = input.gstRegistered ? rounded(subtotal, BigInt(10)) : ZERO
  const subtotalExGstCents = safeNumber(subtotal)
  const gstCents = safeNumber(gst)
  const totalIncGstCents = safeNumber(subtotal + gst)
  if (subtotalExGstCents === null || gstCents === null || totalIncGstCents === null) {
    return failure('invalid_amount', 'Quote total exceeds safe integer cents')
  }
  return { ok: true, calculation: {
    version: 'quote-core-v1', currency: 'AUD', tenantId: input.tenantId,
    pricingBookVersionId: input.pricingBookVersionId, recipeSourceId: input.recipeSourceId,
    serviceMode: input.serviceMode, rounding: 'half_up_unit_then_line_then_gst',
    gstRegistered: input.gstRegistered, lines, subtotalExGstCents, gstCents, totalIncGstCents,
  } }
}
