// Lifecycle of a saved estimator run, derived — never stored — so the
// history panel, tab and full-view page can't disagree:
//   draft     extraction exists, tradie hasn't saved corrections or priced it
//   verified  tradie saved corrected counts (PATCH clears any stale pricing)
//   priced    a grounded BOM is persisted for the current counts

export type RunStatus = 'draft' | 'verified' | 'priced'

export type RunStatusSource = {
  corrected_items?: unknown
  priced_at?: string | null
  priced_total?: unknown
}

export function runStatus(run: RunStatusSource): RunStatus {
  if (run.priced_at || run.priced_total != null) return 'priced'
  if (Array.isArray(run.corrected_items)) return 'verified'
  return 'draft'
}

/** Count of distinct line items on a run (corrected wins over the AI's list). */
export function runItemCount(run: { items?: unknown; corrected_items?: unknown }): number {
  const list = Array.isArray(run.corrected_items) ? run.corrected_items : run.items
  return Array.isArray(list) ? list.length : 0
}

/** Total devices across a run's line items, e.g. 43 downlights + 12 GPOs = 55. */
export function runDeviceCount(run: { items?: unknown; corrected_items?: unknown }): number {
  const list = Array.isArray(run.corrected_items) ? run.corrected_items : run.items
  if (!Array.isArray(list)) return 0
  return list.reduce((sum: number, raw) => {
    const count = Number((raw as Record<string, unknown>)?.count)
    return sum + (Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0)
  }, 0)
}
