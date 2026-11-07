// Reads a zip back the way an unzip tool does, for the pack's tests.
import { inflateRawSync } from 'node:zlib'
import { expect } from 'vitest'

/** A zip read back the way an unzip tool reads it: the end record, then the
 *  central directory, then each entry's local header and its deflated bytes. */
export function readZip(zip: Buffer) {
  const end = zip.length - 22
  expect(zip.readUInt32LE(end)).toBe(0x06054b50)
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const entries: Array<{ name: string; data: Buffer; crc: number; flags: number; method: number; time: number; day: number }> = []
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50)
    const method = zip.readUInt16LE(at + 10)
    const crc = zip.readUInt32LE(at + 16)
    const packed = zip.readUInt32LE(at + 20)
    const size = zip.readUInt32LE(at + 24)
    const nameLength = zip.readUInt16LE(at + 28)
    const extra = zip.readUInt16LE(at + 30)
    const comment = zip.readUInt16LE(at + 32)
    const offset = zip.readUInt32LE(at + 42)
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    expect(zip.readUInt32LE(offset)).toBe(0x04034b50)
    const localName = zip.readUInt16LE(offset + 26)
    const localExtra = zip.readUInt16LE(offset + 28)
    const start = offset + 30 + localName + localExtra
    const data = inflateRawSync(zip.subarray(start, start + packed))
    expect(data.length).toBe(size)
    entries.push({ name, data, crc, flags: zip.readUInt16LE(at + 8), method, time: zip.readUInt16LE(at + 12), day: zip.readUInt16LE(at + 14) })
    at += 46 + nameLength + extra + comment
  }
  return entries
}
