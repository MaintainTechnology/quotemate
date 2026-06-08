import { describe, expect, it, vi } from 'vitest'
import {
  toCsvField,
  rowsToCsv,
  exportTableCsv,
  type PgQueryable,
} from './export-table-csv'

describe('toCsvField', () => {
  it('renders null/undefined as empty', () => {
    expect(toCsvField(null)).toBe('')
    expect(toCsvField(undefined)).toBe('')
  })
  it('quotes and escapes fields with comma/quote/newline', () => {
    expect(toCsvField('a,b')).toBe('"a,b"')
    expect(toCsvField('he said "hi"')).toBe('"he said ""hi"""')
    expect(toCsvField('line1\nline2')).toBe('"line1\nline2"')
  })
  it('JSON-stringifies objects and arrays', () => {
    expect(toCsvField({ a: 1 })).toBe('"{""a"":1}"')
    expect(toCsvField([1, 2])).toBe('"[1,2]"')
  })
  it('renders Date as ISO and Buffer as base64', () => {
    expect(toCsvField(new Date('2026-01-02T03:04:05.000Z'))).toBe(
      '2026-01-02T03:04:05.000Z',
    )
    expect(toCsvField(Buffer.from('hi'))).toBe('aGk=')
  })
})

describe('rowsToCsv', () => {
  it('emits header + rows with CRLF and trailing newline', () => {
    const csv = rowsToCsv(['id', 'name'], [{ id: 1, name: 'A,B' }])
    expect(csv).toBe('id,name\r\n1,"A,B"\r\n')
  })
})

describe('exportTableCsv', () => {
  it('uses ordinal column order and hashes the CSV', async () => {
    const db: PgQueryable = {
      query: vi.fn(async (sql: string) => {
        if (/information_schema\.columns/.test(sql)) {
          return { rows: [{ column_name: 'id' }, { column_name: 'name' }] }
        }
        return { rows: [{ id: 1, name: 'x' }] }
      }) as any,
    }
    const out = await exportTableCsv(db, 'widgets')
    expect(out.csv).toBe('id,name\r\n1,x\r\n')
    expect(out.rowCount).toBe(1)
    expect(out.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects an unsafe table name without querying', async () => {
    const db: PgQueryable = { query: vi.fn() as any }
    await expect(exportTableCsv(db, 'a; drop table x')).rejects.toThrow(
      /unsafe table name/,
    )
    expect(db.query).not.toHaveBeenCalled()
  })
})
