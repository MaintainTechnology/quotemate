import { describe, expect, it, vi } from 'vitest'
import { syncDirtyTables } from './sync'
import type { PgQueryable, TableCsv } from './export-table-csv'

function fakeDb(dirtyRows: any[]) {
  const calls: { sql: string; params?: unknown[] }[] = []
  const db: PgQueryable = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params })
      if (/from kb_sync_state\s+where dirty = true/i.test(sql)) {
        return { rows: dirtyRows }
      }
      return { rows: [] }
    }) as any,
  }
  return { db, calls }
}

const kb = { url: 'https://kb.example.com', apiKey: 'k' }
const storeId = 'fileSearchStores/store1'

it('skips a table whose hash is unchanged (no upload)', async () => {
  const { db } = fakeDb([
    { table_name: 'pricing_book', bumped_at: 't1', content_hash: 'H', kb_document_name: 'd1' },
  ])
  const exportTable = vi.fn(async (): Promise<TableCsv> => ({
    table: 'pricing_book', csv: 'x', hash: 'H', rowCount: 3,
  }))
  const uploadDocument = vi.fn()
  const deleteDocument = vi.fn()
  const s = await syncDirtyTables({ db, kb, storeId, maxTables: 8, exportTable, uploadDocument, deleteDocument })
  expect(uploadDocument).not.toHaveBeenCalled()
  expect(s.skipped).toBe(1)
  expect(s.uploaded).toBe(0)
})

it('uploads a changed table then deletes the prior doc', async () => {
  const { db } = fakeDb([
    { table_name: 'shared_assemblies', bumped_at: 't1', content_hash: 'OLD', kb_document_name: 'prior-doc' },
  ])
  const exportTable = vi.fn(async (): Promise<TableCsv> => ({
    table: 'shared_assemblies', csv: 'a,b\r\n1,2\r\n', hash: 'NEW', rowCount: 1,
  }))
  const uploadDocument = vi.fn(async () => ({ name: 'new-doc' }))
  const deleteDocument = vi.fn(async () => undefined)
  const s = await syncDirtyTables({ db, kb, storeId, maxTables: 8, exportTable, uploadDocument, deleteDocument })
  expect(uploadDocument).toHaveBeenCalledOnce()
  const uploadArgs = (uploadDocument as any).mock.calls[0]
  expect(uploadArgs[1].storeId).toBe(storeId)
  expect(uploadArgs[1].displayName).toBe('db__shared_assemblies.csv')
  expect(deleteDocument).toHaveBeenCalledWith(kb, 'prior-doc')
  expect(s.uploaded).toBe(1)
})

it('isolates a per-table failure and records last_error', async () => {
  const { db, calls } = fakeDb([
    { table_name: 'quotes', bumped_at: 't1', content_hash: null, kb_document_name: null },
  ])
  const exportTable = vi.fn(async () => { throw new Error('boom') })
  const s = await syncDirtyTables({ db, kb, storeId, maxTables: 8, exportTable, uploadDocument: vi.fn(), deleteDocument: vi.fn() })
  expect(s.failed).toBe(1)
  const errUpdate = calls.find((c) => /set last_error/i.test(c.sql))
  expect(errUpdate?.params).toContain('boom')
})

it('does not delete when there is no prior document (first upload)', async () => {
  const { db } = fakeDb([
    { table_name: 'trades', bumped_at: 't1', content_hash: null, kb_document_name: null },
  ])
  const exportTable = vi.fn(async (): Promise<TableCsv> => ({
    table: 'trades', csv: 'h\r\n1\r\n', hash: 'NEW', rowCount: 1,
  }))
  const uploadDocument = vi.fn(async () => ({ name: 'doc-1' }))
  const deleteDocument = vi.fn(async () => undefined)
  const s = await syncDirtyTables({ db, kb, storeId, maxTables: 8, exportTable, uploadDocument, deleteDocument })
  expect(uploadDocument).toHaveBeenCalledOnce()
  expect(deleteDocument).not.toHaveBeenCalled()
  expect(s.uploaded).toBe(1)
})

it('counts the table uploaded even if deleting the prior doc fails', async () => {
  const { db } = fakeDb([
    { table_name: 'categories', bumped_at: 't1', content_hash: 'OLD', kb_document_name: 'prior' },
  ])
  const exportTable = vi.fn(async (): Promise<TableCsv> => ({
    table: 'categories', csv: 'a\r\n1\r\n', hash: 'NEW', rowCount: 1,
  }))
  const uploadDocument = vi.fn(async () => ({ name: 'new-doc' }))
  const deleteDocument = vi.fn(async () => { throw new Error('delete failed') })
  const s = await syncDirtyTables({ db, kb, storeId, maxTables: 8, exportTable, uploadDocument, deleteDocument })
  expect(uploadDocument).toHaveBeenCalledOnce()
  expect(deleteDocument).toHaveBeenCalledOnce()
  expect(s.uploaded).toBe(1)
  expect(s.failed).toBe(0)
})

it('processes a mixed batch: skip + upload + fail, with consistent counts', async () => {
  const { db } = fakeDb([
    { table_name: 'a_skip', bumped_at: 't1', content_hash: 'SAME', kb_document_name: 'd' },
    { table_name: 'b_up', bumped_at: 't2', content_hash: 'OLD', kb_document_name: null },
    { table_name: 'c_fail', bumped_at: 't3', content_hash: null, kb_document_name: null },
  ])
  const exportTable = vi.fn(async (_db: PgQueryable, table: string): Promise<TableCsv> => {
    if (table === 'a_skip') return { table, csv: 'x', hash: 'SAME', rowCount: 1 }
    if (table === 'b_up') return { table, csv: 'y', hash: 'NEW', rowCount: 2 }
    throw new Error('export boom')
  })
  const uploadDocument = vi.fn(async () => ({ name: 'doc' }))
  const deleteDocument = vi.fn(async () => undefined)
  const s = await syncDirtyTables({ db, kb, storeId, maxTables: 8, exportTable, uploadDocument, deleteDocument })
  expect(s.attempted).toBe(3)
  expect(s.skipped).toBe(1)
  expect(s.uploaded).toBe(1)
  expect(s.failed).toBe(1)
  expect(s.results.map((r) => r.status).sort()).toEqual(['failed', 'skipped', 'uploaded'])
})
