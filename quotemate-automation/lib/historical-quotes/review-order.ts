// Review ordering (spec edge case: low-confidence / 'other' categorisations are
// surfaced FIRST in the review panel so the tradie fixes the weakest matches
// before confirming). PURE — unit-tested.

export function isLowSignal(row: {
  job_type_confidence?: string | null
  job_type?: string | null
}): boolean {
  return row.job_type_confidence === 'low' || !row.job_type || row.job_type === 'other'
}

/** Float low-signal rows to the top, then preserve created_at ascending. */
export function sortForReview<
  T extends { job_type_confidence?: string | null; job_type?: string | null; created_at?: string | null },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const al = isLowSignal(a) ? 0 : 1
    const bl = isLowSignal(b) ? 0 : 1
    if (al !== bl) return al - bl
    return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
  })
}
