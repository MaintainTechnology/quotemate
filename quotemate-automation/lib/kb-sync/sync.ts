// Flush core for the DB→KB sync. Pure-ish: all side-effecting deps are
// injected so it unit-tests without a DB or network. The cron route and
// the backfill script call this with real pg + kb config.

import { exportTableCsv, type PgQueryable, type TableCsv } from './export-table-csv'
import {
  kbUploadDocument,
  kbDeleteDocument,
  type KbConfig,
} from '../admin-loader/mt-filestore-kb'

export type DirtyRow = {
  table_name: string
  bumped_at: string
  content_hash: string | null
  kb_document_name: string | null
}

export type SyncDeps = {
  db: PgQueryable
  kb: KbConfig
  storeId: string
  maxTables: number
  exportTable?: (db: PgQueryable, table: string) => Promise<TableCsv>
  uploadDocument?: typeof kbUploadDocument
  deleteDocument?: typeof kbDeleteDocument
}

export type SyncResult = {
  table: string
  status: 'uploaded' | 'skipped' | 'failed'
  error?: string
}

export type SyncSummary = {
  attempted: number
  uploaded: number
  skipped: number
  failed: number
  results: SyncResult[]
}

export async function syncDirtyTables(deps: SyncDeps): Promise<SyncSummary> {
  const exportTable = deps.exportTable ?? exportTableCsv
  const upload = deps.uploadDocument ?? kbUploadDocument
  const del = deps.deleteDocument ?? kbDeleteDocument

  const { rows } = await deps.db.query(
    `select table_name, bumped_at, content_hash, kb_document_name
       from kb_sync_state
      where dirty = true
      order by bumped_at asc
      limit $1`,
    [deps.maxTables],
  )
  const dirty = rows as DirtyRow[]
  const summary: SyncSummary = {
    attempted: dirty.length, uploaded: 0, skipped: 0, failed: 0, results: [],
  }

  for (const row of dirty) {
    const seq = row.bumped_at
    try {
      const { csv, hash, rowCount } = await exportTable(deps.db, row.table_name)

      if (hash === row.content_hash) {
        await deps.db.query(
          `update kb_sync_state
              set dirty = (bumped_at <> $2), last_synced_at = now(),
                  row_count = $3, last_error = null
            where table_name = $1`,
          [row.table_name, seq, rowCount],
        )
        summary.skipped++
        summary.results.push({ table: row.table_name, status: 'skipped' })
        continue
      }

      const file = new File([csv], `db__${row.table_name}.csv`, { type: 'text/csv' })
      const doc = await upload(deps.kb, {
        storeId: deps.storeId,
        file,
        displayName: `db__${row.table_name}.csv`,
      })

      // Upload-then-delete: only remove the prior doc once the new one exists.
      if (row.kb_document_name) {
        try {
          await del(deps.kb, row.kb_document_name)
        } catch (e) {
          console.warn(
            `[kb-sync] orphan: failed to delete prior doc for ${row.table_name}:`,
            e instanceof Error ? e.message : e,
          )
        }
      }

      await deps.db.query(
        `update kb_sync_state
            set content_hash = $2, kb_document_name = $3, row_count = $4,
                last_synced_at = now(), last_error = null,
                dirty = (bumped_at <> $5)
          where table_name = $1`,
        [row.table_name, hash, doc?.name ?? null, rowCount, seq],
      )
      summary.uploaded++
      summary.results.push({ table: row.table_name, status: 'uploaded' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await deps.db
        .query(`update kb_sync_state set last_error = $2 where table_name = $1`, [
          row.table_name,
          msg,
        ])
        .catch(() => {})
      summary.failed++
      summary.results.push({ table: row.table_name, status: 'failed', error: msg })
    }
  }
  return summary
}
