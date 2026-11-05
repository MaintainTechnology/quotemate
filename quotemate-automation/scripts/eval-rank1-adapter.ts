/** Controlled replay of the actual Rank 1 estimator over frozen source records.
 * No provider/database/SMS clients are imported. This measures Quote Core only;
 * worker delivery, natural-language intake and owner release have separate tests. */
import { buildRank1Estimation, type Rank1LoadedInputs } from '../lib/estimate/rank1'
import type { QuoteCalculation } from '../lib/estimate/quote-core'
import { collectRank1SourceEvidence } from './eval-rank1-evidence.mjs'

type Row = Record<string, unknown>
type Input = { id: string; intake: Row; context: {
  tenant_id: string
  pricing_book_version_id: string
  gst_rate_bps: number
  pricing_book: Row
  resolved_recipe: Rank1LoadedInputs
} }
export const evaluationContract = { effects: 'read_only', environment: 'isolated_evaluation' } as const

const evidence = collectRank1SourceEvidence()
export const run = {
  kind: 'estimator_capture',
  evidence_scope: 'deterministic_quote_core_replay',
  source_revision: evidence.sourceRevision,
  source_files: evidence.sourceFiles,
  config_sha256: evidence.configSha256,
  captured_at: new Date().toISOString(),
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

/** Exact conversion: an unsupported precision fails the capture, never rounds it. */
function scaledInteger(value: string, scale: number, field: string): number {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value)
  if (!match || value.length > 64) throw new Error(`${field}: invalid decimal quantity`)
  const exponent = Number(match[3] ?? 0)
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 20) throw new Error(`${field}: invalid decimal exponent`)
  const fraction = match[2] ?? ''
  const places = fraction.length - exponent
  const numerator = BigInt(match[1] + fraction) * BigInt(scale) * (places < 0 ? BigInt(10) ** BigInt(-places) : BigInt(1))
  const denominator = places > 0 ? BigInt(10) ** BigInt(places) : BigInt(1)
  if (numerator % denominator !== BigInt(0) || numerator / denominator > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${field}: source precision cannot be represented without rounding; extend the evaluation contract before promotion`)
  }
  return Number(numerator / denominator)
}

function mapTier(calculation: QuoteCalculation | undefined, context: Input['context']) {
  if (!calculation || calculation.version !== 'quote-core-v1' || calculation.currency !== 'AUD' ||
      calculation.rounding !== 'half_up_unit_then_line_then_gst' || calculation.tenantId !== context.tenant_id ||
      calculation.pricingBookVersionId !== context.pricing_book_version_id) throw new Error('Missing or mismatched authoritative calculation trace')
  const catalogueId = (line: QuoteCalculation['lines'][number]) => `${line.role === 'labour' ? 'labour' : 'tenant'}:${line.sourceId}`
  const labourMinutes = calculation.lines.filter((line) => line.role === 'labour')
    .reduce((sum, line) => sum + scaledInteger(line.quantity, 60, 'labour_minutes'), 0)
  if (!Number.isSafeInteger(labourMinutes)) throw new Error('Labour minutes overflow')
  return {
    total_ex_gst_cents: calculation.subtotalExGstCents,
    gst_cents: calculation.gstCents,
    total_inc_gst_cents: calculation.totalIncGstCents,
    gst_rate_bps: calculation.gstRegistered ? 1000 : 0,
    labour_minutes: labourMinutes,
    material_catalogue_ids: [...new Set(calculation.lines.filter((line) => line.role !== 'labour').map(catalogueId))],
    line_items: calculation.lines.map((line) => ({ catalogue_item_id: catalogueId(line),
      quantity_milli: scaledInteger(line.quantity, 1000, 'quantity_milli'),
      unit_price_ex_gst_cents: line.unitPriceCents, line_total_ex_gst_cents: line.totalExGstCents })),
  }
}

export async function estimate(input: Input) {
  const context = input.context
  if (!context?.pricing_book || !context.resolved_recipe || !context.pricing_book_version_id || !context.tenant_id) {
    throw new Error('Replay requires tenant, version, pricing_book and resolved_recipe source snapshots')
  }
  // Case ownership must be explicit; never silently repair a mismatched intake.
  if (input.intake.tenant_id !== context.tenant_id) throw new Error('Intake tenant must match the recorded evaluation context')
  const immutable = freeze(structuredClone(input))
  const result = await buildRank1Estimation({ intake: immutable.intake,
    pricingBook: immutable.context.pricing_book,
    context: { pricingBookVersionId: immutable.context.pricing_book_version_id },
    loadInputs: async () => immutable.context.resolved_recipe,
  })
  if (!result.quoteCore) throw new Error('Rank 1 result lacks Quote Core evidence')
  const route = result.quoteCore.status === 'priced' ? 'awaiting_tradie_approval'
    : result.quoteCore.status === 'inspection_required' ? 'inspection_required' : 'review_required'
  return {
    tenant_id: result.quoteCore.tenantId,
    pricing_book_version_id: result.quoteCore.pricingBookVersionId,
    route,
    // This pure builder produces drafts and has no release capability. It does
    // not attest that the separately tested platform release endpoint is safe.
    customer_release_allowed: false,
    good: result.draft.good ? mapTier(result.draft.good.calculation, context) : null,
    better: result.draft.better ? mapTier(result.draft.better.calculation, context) : null,
    best: result.draft.best ? mapTier(result.draft.best.calculation, context) : null,
    review_reason: result.quoteCore.reason ?? null,
  }
}
