// Pure shaping functions for the admin review queue.
//
// The findings tables live in QuoteMax's Supabase, written by the
// mt-qm-quality-agents service. The admin UI reads them and lets a
// human approve/reject. These helpers turn raw rows into UI-friendly
// shapes (sort order, status guards, value-extraction from jsonb).
//
// Dependency-free so it's unit-testable without DB or React.

export type FindingStatus = 'pending' | 'approved' | 'rejected' | 'applied'

export const FINDING_STATUSES: readonly FindingStatus[] = [
  'pending',
  'approved',
  'rejected',
  'applied',
] as const

export function isFindingStatus(v: unknown): v is FindingStatus {
  return (
    v === 'pending' || v === 'approved' || v === 'rejected' || v === 'applied'
  )
}

/**
 * Raw row from catalogue_findings as it comes out of Supabase.
 * Loose typing on the jsonb columns since their shape varies per
 * finding_type — UI-side narrowing happens in the page component.
 */
export interface CatalogueFindingRow {
  id: string
  source_table: string
  source_row_id: string
  finding_type: string
  current_value: unknown
  suggested_value: unknown
  confidence: number | string | null
  status: FindingStatus
  created_at: string
  reviewed_by: string | null
  reviewed_at: string | null
}

export interface TradieEditPatternRow {
  id: string
  tenant_id: string | null
  trade: string
  job_type: string
  field: string
  edit_direction: string
  median_delta: number | string | null
  sample_count: number
  observed_period_start: string | null
  observed_period_end: string | null
  status: FindingStatus
  created_at: string
  reviewed_by: string | null
  reviewed_at: string | null
}

/**
 * Sort catalogue findings for the queue. Pending first, then by
 * created_at desc within each status. Approved/applied float to the
 * bottom so the admin sees actionable items on top.
 */
export function sortCatalogueFindings(
  rows: CatalogueFindingRow[],
): CatalogueFindingRow[] {
  const priority: Record<FindingStatus, number> = {
    pending: 0,
    approved: 1,
    rejected: 2,
    applied: 3,
  }
  return [...rows].sort((a, b) => {
    const ap = priority[a.status] ?? 99
    const bp = priority[b.status] ?? 99
    if (ap !== bp) return ap - bp
    return b.created_at.localeCompare(a.created_at)
  })
}

/**
 * Same sort logic for tradie-edit patterns.
 */
export function sortTradiePatterns(
  rows: TradieEditPatternRow[],
): TradieEditPatternRow[] {
  const priority: Record<FindingStatus, number> = {
    pending: 0,
    approved: 1,
    rejected: 2,
    applied: 3,
  }
  return [...rows].sort((a, b) => {
    const ap = priority[a.status] ?? 99
    const bp = priority[b.status] ?? 99
    if (ap !== bp) return ap - bp
    if (a.sample_count !== b.sample_count) return b.sample_count - a.sample_count
    return b.created_at.localeCompare(a.created_at)
  })
}

/**
 * Human-readable one-line label for a catalogue finding. Branches on
 * finding_type so the admin queue stays scannable.
 *
 * Examples:
 *   price_drift         → "$1100 → $1265 (+15%) on shared_materials/r1"
 *   description_mismatch → "Description references new-install steps on r2 (0.4hr)"
 *   category_mismatch   → "gpo → downlight on r3 (confidence 0.7)"
 */
export function describeCatalogueFinding(f: CatalogueFindingRow): string {
  const current = (f.current_value ?? {}) as Record<string, unknown>
  const suggested = (f.suggested_value ?? {}) as Record<string, unknown>
  switch (f.finding_type) {
    case 'price_drift': {
      const cur = num(current['unit_price_ex_gst'])
      const sug = num(suggested['unit_price_ex_gst'])
      const drift = num(suggested['drift_pct'])
      if (cur != null && sug != null) {
        const sign = sug >= cur ? '+' : ''
        const driftStr = drift != null ? ` (${sign}${drift}%)` : ''
        return `$${cur} → $${sug}${driftStr}`
      }
      return 'Price drift detected'
    }
    case 'description_mismatch':
      return 'Description contradicts the row\'s labour profile'
    case 'category_mismatch': {
      const cur = String(current['category'] ?? '?')
      const sug = String(suggested['category'] ?? '?')
      return `${cur} → ${sug}`
    }
    case 'sku_missing':
      return 'Supplier stocks a SKU your catalogue doesn\'t carry'
    default:
      return f.finding_type
  }
}

/**
 * Human-readable one-line label for a tradie-edit pattern.
 *
 * Examples:
 *   "tradies bumped labour_hours by +0.5 on hot_water (n=12)"
 *   "tradies swapped material on downlights (n=4)"
 */
export function describeTradiePattern(p: TradieEditPatternRow): string {
  const verb =
    p.edit_direction === 'up'
      ? 'bumped'
      : p.edit_direction === 'down'
        ? 'reduced'
        : p.edit_direction === 'swap'
          ? 'swapped'
          : 'renamed'
  const delta = num(p.median_delta)
  const deltaStr =
    (p.edit_direction === 'up' || p.edit_direction === 'down') && delta != null
      ? ` by ${delta > 0 ? '+' : ''}${delta}`
      : ''
  return `${p.trade} · ${p.job_type} · tradies ${verb} ${p.field}${deltaStr} (n=${p.sample_count})`
}

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : null
}

/**
 * Group catalogue findings by source_table so the queue can show a
 * collapsed tree (e.g. "shared_materials (3) · shared_assemblies (2)").
 */
export function groupCatalogueBySourceTable(
  rows: CatalogueFindingRow[],
): Record<string, CatalogueFindingRow[]> {
  const out: Record<string, CatalogueFindingRow[]> = {}
  for (const r of rows) {
    if (!out[r.source_table]) out[r.source_table] = []
    out[r.source_table].push(r)
  }
  return out
}

/**
 * Format an ISO timestamp as a short relative string ("2h ago", "yesterday").
 * Pure — doesn't read `now` from the system clock, takes it as an arg.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const diffMs = now.getTime() - t
  // Use floor everywhere so "30 seconds ago" reads "just now" instead of
  // rounding up to "1m ago" — and "4 hr 50 min" stays "4h ago" rather than
  // overshooting to "5h ago" mid-hour.
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay === 1) return 'yesterday'
  if (diffDay < 14) return `${diffDay}d ago`
  return new Date(t).toISOString().slice(0, 10)
}
