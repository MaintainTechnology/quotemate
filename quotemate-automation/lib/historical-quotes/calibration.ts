// Pure calibration proposal builder (spec R13/R14). Turns per-job-type analytics
// into proposed tenant_custom_assemblies upserts. NO DB — the preview route maps
// these to a diff; the apply route persists the approved subset.

import type { JobTypeStats } from './types'
import { assemblyNameForJobType, tradeForJobType, type Trade } from './job-types'

/** A job type needs at least this many confirmed historical quotes before it's
 *  considered enough signal to calibrate the pricing book. */
export const MIN_SAMPLES = 3

export type CalibrationProposal = {
  job_type: string
  trade: Trade
  /** The tenant_custom_assemblies.name this would write to. */
  name: string
  /** ex-GST average — the proposed default_unit_price_ex_gst. */
  proposed_unit_price_ex_gst: number
  sample_count: number
  /** Current price on the existing custom assembly (null if it's new). */
  existing_price_ex_gst: number | null
  is_new: boolean
}

/**
 * Build calibration proposals from job-type stats.
 * @param existingByName lower(name) → existing default_unit_price_ex_gst.
 * Job types below `minSamples`, mapped to 'other', or with no trade are skipped.
 */
export function buildCalibrationProposals(
  stats: JobTypeStats[],
  existingByName: Map<string, number>,
  opts?: { minSamples?: number },
): CalibrationProposal[] {
  const minSamples = opts?.minSamples ?? MIN_SAMPLES
  const proposals: CalibrationProposal[] = []
  for (const s of stats) {
    if (s.count < minSamples) continue
    const name = assemblyNameForJobType(s.job_type)
    const trade = ((s.trade as Trade | null) ?? tradeForJobType(s.job_type)) as Trade | null
    if (!name || !trade) continue
    const existing = existingByName.get(name.toLowerCase())
    proposals.push({
      job_type: s.job_type,
      trade,
      name,
      proposed_unit_price_ex_gst: s.avg_price_ex_gst,
      sample_count: s.count,
      existing_price_ex_gst: existing ?? null,
      is_new: existing == null,
    })
  }
  return proposals
}
