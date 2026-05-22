// Batch planning for the admin bulk loader (spec §8 steps 3-5).
//
// Bridges the CSV validation layer to the staging tables: takes an uploaded
// CSV + the DB-derived validation context, and produces a STAGE-ABLE plan —
// the NEW/UPDATE rows to write to import_staged_rows, plus the REJECT rows
// with reasons for the preview.
//
// Pure: every DB-derived input (known trades/categories, existing-row keys,
// the live-tenant predicate) is passed in, so this is unit-testable without
// a database. The admin API route fetches that context, calls a planner,
// then persists `stagedRows` and returns the whole plan as the preview.
//
// Staging model: import_staged_rows.row_class is NEW|UPDATE only (migration
// 049 CHECK), so only valid, classifiable rows are staged. A REJECT row is
// reported in the plan (and the preview response) but never persisted — it
// is "fix your CSV and re-upload" feedback, not part of the committable
// batch. The §8 non-destruction guarantee is unaffected: only valid rows
// are ever candidates for the commit.

import {
  parseServicesCsv,
  validateServicesRow,
  type ServicesRowContext,
} from './services-csv'
import {
  parseMaterialsCsv,
  validateMaterialsRow,
  type MaterialsRowContext,
} from './materials-csv'
import {
  parseCategoriesCsv,
  validateCategoriesRow,
  type CategoriesRowContext,
} from './categories-csv'

export type StagedRow = {
  target_table:
    | 'shared_assemblies'
    | 'shared_materials'
    | 'categories'
    | 'trades'
    | 'trade_pricing_defaults'
    | 'trade_prompts'
  row_class: 'NEW' | 'UPDATE'
  payload: Record<string, unknown>
  /** Smoke-test outcome (spec §8 step 7). Set by the upload route for NEW
   *  service rows; left undefined for everything the harness does not
   *  cover (materials/categories/trade rows, UPDATEs) — stageRows then
   *  persists 'skipped', which commit_import_batch treats as committable. */
  smoke_status?: 'passed' | 'failed' | 'skipped'
  smoke_reason?: string | null
}

export type RejectedRow = {
  /** 1-based CSV line number (includes the header row). */
  line: number
  errors: string[]
}

export type UploadPlan =
  | { ok: false; csv: string; structuralErrors: string[] }
  | {
      ok: true
      csv: string
      target_table: 'shared_assemblies' | 'shared_materials' | 'categories'
      stagedRows: StagedRow[]
      rejected: RejectedRow[]
      summary: { newCount: number; updateCount: number; rejectedCount: number }
      /** §9 rule 3 — how many rows had default_enabled forced false because
       *  the trade has live tenants. Surfaced so the preview can say so. */
      forcedDisabledCount: number
    }

/** Plan a Services CSV upload into shared_assemblies staged rows. */
export function planServicesUpload(
  csvText: string,
  ctx: ServicesRowContext,
): UploadPlan {
  const parsed = parseServicesCsv(csvText)
  if (!parsed.ok) {
    return { ok: false, csv: 'services', structuralErrors: parsed.errors }
  }

  const seen = new Set<string>()
  const stagedRows: StagedRow[] = []
  const rejected: RejectedRow[] = []
  let newCount = 0
  let updateCount = 0
  let forcedDisabledCount = 0

  parsed.records.forEach((rec, i) => {
    const result = validateServicesRow(rec, ctx, seen)
    if (result.rowClass === 'REJECT') {
      rejected.push({ line: i + 2, errors: result.errors })
      return
    }
    stagedRows.push({
      target_table: 'shared_assemblies',
      row_class: result.rowClass,
      payload: result.parsed as unknown as Record<string, unknown>,
    })
    if (result.rowClass === 'NEW') newCount++
    else updateCount++
    if (result.forcedDisabled) forcedDisabledCount++
  })

  return {
    ok: true,
    csv: 'services',
    target_table: 'shared_assemblies',
    stagedRows,
    rejected,
    summary: { newCount, updateCount, rejectedCount: rejected.length },
    forcedDisabledCount,
  }
}

/** Plan a Materials CSV upload into shared_materials staged rows. */
export function planMaterialsUpload(
  csvText: string,
  ctx: MaterialsRowContext,
): UploadPlan {
  const parsed = parseMaterialsCsv(csvText)
  if (!parsed.ok) {
    return { ok: false, csv: 'materials', structuralErrors: parsed.errors }
  }

  const seen = new Set<string>()
  const stagedRows: StagedRow[] = []
  const rejected: RejectedRow[] = []
  let newCount = 0
  let updateCount = 0

  parsed.records.forEach((rec, i) => {
    const result = validateMaterialsRow(rec, ctx, seen)
    if (result.rowClass === 'REJECT') {
      rejected.push({ line: i + 2, errors: result.errors })
      return
    }
    stagedRows.push({
      target_table: 'shared_materials',
      row_class: result.rowClass,
      payload: result.parsed as unknown as Record<string, unknown>,
    })
    if (result.rowClass === 'NEW') newCount++
    else updateCount++
  })

  return {
    ok: true,
    csv: 'materials',
    target_table: 'shared_materials',
    stagedRows,
    rejected,
    summary: { newCount, updateCount, rejectedCount: rejected.length },
    forcedDisabledCount: 0, // materials have no default_enabled flag
  }
}

/** Plan a Categories CSV upload into categories staged rows. Part of a
 *  new-trade bundle (spec §7.1) — defines a trade's category vocabulary.
 *  Wired into the upload route only once migration 053 teaches the commit
 *  function the `categories` target table. */
export function planCategoriesUpload(
  csvText: string,
  ctx: CategoriesRowContext,
): UploadPlan {
  const parsed = parseCategoriesCsv(csvText)
  if (!parsed.ok) {
    return { ok: false, csv: 'categories', structuralErrors: parsed.errors }
  }

  const seen = new Set<string>()
  const stagedRows: StagedRow[] = []
  const rejected: RejectedRow[] = []
  let newCount = 0
  let updateCount = 0

  parsed.records.forEach((rec, i) => {
    const result = validateCategoriesRow(rec, ctx, seen)
    if (result.rowClass === 'REJECT') {
      rejected.push({ line: i + 2, errors: result.errors })
      return
    }
    stagedRows.push({
      target_table: 'categories',
      row_class: result.rowClass,
      payload: result.parsed as unknown as Record<string, unknown>,
    })
    if (result.rowClass === 'NEW') newCount++
    else updateCount++
  })

  return {
    ok: true,
    csv: 'categories',
    target_table: 'categories',
    stagedRows,
    rejected,
    summary: { newCount, updateCount, rejectedCount: rejected.length },
    forcedDisabledCount: 0, // categories have no default_enabled flag
  }
}
