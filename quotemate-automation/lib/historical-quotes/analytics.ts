// Pure analytics over imported historical quotes (spec R10/R11). No DB, no HTTP —
// unit-tested directly. Only CONFIRMED rows with a job_type and an inc-GST price
// contribute; everything else is ignored so pending/rejected/low-signal rows
// never skew an average.

import type { AnalyticsInputRow, JobTypeStats, HintResult } from './types'
import { tradeForJobType } from './job-types'

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return round2(nums.reduce((a, b) => a + b, 0) / nums.length)
}

function isUsable(r: AnalyticsInputRow): boolean {
  return (
    r.status === 'confirmed' &&
    !!r.job_type &&
    r.price_inc_gst != null &&
    Number.isFinite(r.price_inc_gst)
  )
}

/** Aggregate confirmed rows into per-job-type stats, sorted by count desc.
 *  Job types with no usable rows are omitted. */
export function aggregateByJobType(rows: AnalyticsInputRow[]): JobTypeStats[] {
  const groups = new Map<string, AnalyticsInputRow[]>()
  for (const r of rows) {
    if (!isUsable(r)) continue
    const jt = r.job_type as string
    const list = groups.get(jt) ?? []
    list.push(r)
    groups.set(jt, list)
  }

  const out: JobTypeStats[] = []
  for (const [jobType, list] of groups) {
    const inc = list.map((r) => r.price_inc_gst as number)
    const ex = list.map((r) =>
      r.price_ex_gst != null && Number.isFinite(r.price_ex_gst)
        ? (r.price_ex_gst as number)
        : (r.price_inc_gst as number) / (1 + 0.1),
    )
    const dates = list
      .map((r) => r.quoted_at)
      .filter((d): d is string => !!d)
      .sort()
    out.push({
      job_type: jobType,
      trade: list.find((r) => r.trade)?.trade ?? tradeForJobType(jobType),
      count: list.length,
      avg_price_inc_gst: avg(inc),
      avg_price_ex_gst: avg(ex),
      min_price_inc_gst: round2(Math.min(...inc)),
      max_price_inc_gst: round2(Math.max(...inc)),
      most_recent_quoted_at: dates.length ? dates[dates.length - 1] : null,
    })
  }
  out.sort((a, b) => b.count - a.count || a.job_type.localeCompare(b.job_type))
  return out
}

/** Single-job-type hint. Returns a clean `count: 0` marker when there's no
 *  confirmed history for that job type. */
export function hintFor(rows: AnalyticsInputRow[], jobType: string): HintResult {
  const stats = aggregateByJobType(rows.filter((r) => r.job_type === jobType))
  const match = stats.find((s) => s.job_type === jobType)
  if (!match) return { job_type: jobType, trade: tradeForJobType(jobType), count: 0 }
  return match
}
