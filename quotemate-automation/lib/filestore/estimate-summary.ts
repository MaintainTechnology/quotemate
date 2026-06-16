// Plain-text summaries of an estimate RESULT, indexed into a session's store so
// the chatbot can explain the numbers line by line. The electrical dashboard
// flow produces no result PDF (only the SMS path does), so a grounded text
// summary IS the result document for that estimator — and reads better for the
// model than a rendered PDF would. Pure, unit-tested.

import type { PricedBom } from '../estimation/price'

const aud = (n: number): string =>
  '$' + (Number.isFinite(n) ? Math.round(n) : 0).toLocaleString('en-AU')

/**
 * A readable summary of a priced electrical take-off: every priced line (count,
 * matched assembly, unit material price, labour, line total), any unmatched
 * items, the totals, and the pricing assumptions. Deterministic.
 */
export function electricalEstimateSummaryText(
  bom: PricedBom,
  opts?: { jobLabel?: string | null; pricedAt?: string | null },
): string {
  const out: string[] = []
  out.push('QuoteMate electrical estimate — result summary')
  if (opts?.jobLabel) out.push(`Job: ${opts.jobLabel}`)
  if (opts?.pricedAt) out.push(`Priced at: ${opts.pricedAt}`)
  out.push('')

  out.push('Priced line items (ex GST):')
  if ((bom.lines ?? []).length === 0) {
    out.push('- (no priced lines)')
  } else {
    for (const l of bom.lines) {
      out.push(
        `- ${l.count} × ${l.type} (matched to "${l.matched}"): ` +
          `${aud(l.unitPriceExGst)}/unit material, ${l.labourHours}h labour, ` +
          `line total ${aud(l.lineExGst)} ex GST`,
      )
    }
  }

  if ((bom.unmatched ?? []).length > 0) {
    out.push('')
    out.push('Items with no catalogue match (not priced — need a closer look):')
    for (const u of bom.unmatched) out.push(`- ${u.count} × ${u.type}`)
  }

  out.push('')
  out.push('Totals:')
  out.push(`- Materials ex GST: ${aud(bom.materialExGst)}`)
  out.push(`- Labour ex GST: ${aud(bom.labourExGst)}`)
  if (bom.labourFloorAddedExGst) {
    out.push(`- Minimum-labour top-up ex GST: ${aud(bom.labourFloorAddedExGst)}`)
  }
  out.push(`- Subtotal ex GST: ${aud(bom.subtotalExGst)}`)
  out.push(`- GST: ${aud(bom.gstExGst)}`)
  out.push(`- Total inc GST: ${aud(bom.totalIncGst)}`)

  out.push('')
  out.push(
    `Assumptions: hourly rate ${aud(bom.assumptions?.hourlyRate)}, ` +
      `markup ${bom.assumptions?.markupPct ?? 0}%, ` +
      `minimum labour ${bom.assumptions?.minLabourHours ?? 0}h. ` +
      `${bom.gstRegistered ? 'GST registered.' : 'Not GST registered.'} ` +
      `Indicative — a qualified electrician verifies the take-off before it is sent.`,
  )

  return out.join('\n')
}
