// Single source of truth for turning a Postgres table into CSV.
// Used by the cron sync worker, the backfill script, and the disk-dump
// script. Uses raw pg (not supabase-js) so it isn't capped at PostgREST's
// 1000-row limit and gets true ordinal column order even for empty tables.

import { createHash } from 'node:crypto'

/** Anything with a node-postgres-shaped `query`. */
export type PgQueryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>
}

export type TableCsv = {
  table: string
  csv: string
  hash: string
  rowCount: number
}

export function toCsvField(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s: string
  if (Buffer.isBuffer(v)) s = v.toString('base64')
  else if (v instanceof Date) s = v.toISOString()
  else if (typeof v === 'object') s = JSON.stringify(v)
  else s = String(v)
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

export function rowsToCsv(
  fieldNames: string[],
  rows: Record<string, unknown>[],
): string {
  const lines = [fieldNames.map(toCsvField).join(',')]
  for (const row of rows) {
    lines.push(fieldNames.map((f) => toCsvField(row[f])).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

export async function listColumns(db: PgQueryable, table: string): Promise<string[]> {
  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by ordinal_position`,
    [table],
  )
  return rows.map((r) => r.column_name as string)
}

export async function listPublicTables(db: PgQueryable): Promise<string[]> {
  const { rows } = await db.query(
    `select c.relname as t
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`,
  )
  return rows.map((r) => r.t as string)
}

export async function exportTableCsv(db: PgQueryable, table: string): Promise<TableCsv> {
  // We must interpolate the identifier (cannot parameterize it), so guard it.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new Error(`exportTableCsv: unsafe table name "${table}"`)
  }
  const fieldNames = await listColumns(db, table)
  const { rows } = await db.query(`select * from "${table}"`)
  const csv = rowsToCsv(fieldNames, rows as Record<string, unknown>[])
  const hash = createHash('sha256').update(csv).digest('hex')
  return { table, csv, hash, rowCount: rows.length }
}
