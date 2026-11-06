import * as zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { readZip } from './test-zip'
import { crc32, zipFiles } from './zip'

describe('crc32', () => {
  it('is the IEEE CRC a zip records', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
  })

  it('agrees with zlib on any bytes', () => {
    const bytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7919) % 256))
    const zlibCrc = (zlib as unknown as { crc32?: (data: Uint8Array) => number }).crc32
    if (zlibCrc) expect(crc32(bytes)).toBe(zlibCrc(bytes))
  })
})

describe('zipFiles', () => {
  const modified = new Date('2026-11-06T03:04:10Z')

  it('stores each file deflated, in order, with its name and CRC', () => {
    const files = [
      { name: 'roof-outline.dxf', data: Buffer.from('0\nSECTION\n'.repeat(200)) },
      { name: 'takeoff.csv', data: Buffer.from('record,structure_id\r\nplane,S1\r\n') },
      { name: 'manifest.json', data: Buffer.from('{"version":1}') },
    ]
    const entries = readZip(zipFiles(files, modified))
    expect(entries.map((e) => e.name)).toEqual(['roof-outline.dxf', 'takeoff.csv', 'manifest.json'])
    for (const [i, entry] of entries.entries()) {
      expect(entry.data.equals(files[i].data)).toBe(true)
      expect(entry.crc).toBe(crc32(files[i].data))
      expect(entry.method).toBe(8)
      expect(entry.flags & 0x0800).toBe(0x0800) // names are UTF-8
    }
  })

  it('stamps the modified time as a DOS date and time', () => {
    const [entry] = readZip(zipFiles([{ name: 'a.txt', data: Buffer.from('a') }], modified))
    expect(entry.day).toBe(((2026 - 1980) << 9) | (11 << 5) | 6)
    expect(entry.time).toBe((3 << 11) | (4 << 5) | 5)
  })

  it('takes an empty file and a name outside ASCII', () => {
    const entries = readZip(zipFiles([{ name: 'résumé.txt', data: new Uint8Array() }], modified))
    expect(entries[0].name).toBe('résumé.txt')
    expect(entries[0].data.length).toBe(0)
  })

  it('refuses more entries than a zip without zip64 can hold', () => {
    const many = Array.from({ length: 65_535 }, (_, i) => ({ name: `${i}`, data: new Uint8Array() }))
    expect(() => zipFiles(many, modified)).toThrow(/at most/)
  })
})
