// A zip writer for the Roof Wizard pack (TKO-18): deflated entries, then the
// central directory and its end record, as PKWARE's APPNOTE sets them out.
// Four small files need nothing more, so the pack adds no dependency to the
// service. No zip64: an entry or a zip of 4 GB, or 65,535 entries, is refused.

import { deflateRawSync } from 'node:zlib'

const TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** The CRC-32 a zip entry records: IEEE 802.3's, as zlib computes it. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export type ZipEntry = { name: string; data: Uint8Array }

const MAX_ENTRIES = 0xffff - 1
const MAX_BYTES = 0xffffffff - 1
const UTF8_NAMES = 0x0800
const DEFLATE = 8
const VERSION = 20 // 2.0: deflate

/** A DOS date and time, as a zip stores a file's modified time. In UTC: the
 *  format has no zone, and the manifest carries the exact time. */
function dosTime(date: Date) {
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    day: ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  }
}

/** The entries as one zip, each deflated, in the order given. */
export function zipFiles(entries: ZipEntry[], modified: Date): Buffer {
  if (entries.length > MAX_ENTRIES) throw new Error(`A zip here holds at most ${MAX_ENTRIES} entries`)
  const { time, day } = dosTime(modified)
  const parts: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const packed = deflateRawSync(entry.data, { level: 9 })
    if (entry.data.length > MAX_BYTES || packed.length > MAX_BYTES) throw new Error(`${entry.name} is too large for a zip without zip64`)
    const crc = crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(VERSION, 4)
    local.writeUInt16LE(UTF8_NAMES, 6)
    local.writeUInt16LE(DEFLATE, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    parts.push(local, name, packed)

    const central = Buffer.alloc(46) // extra, comment, disk and attributes stay 0
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(VERSION, 4)
    central.writeUInt16LE(VERSION, 6)
    central.writeUInt16LE(UTF8_NAMES, 8)
    central.writeUInt16LE(DEFLATE, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(day, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    directory.push(central, name)

    offset += local.length + name.length + packed.length
    if (offset > MAX_BYTES) throw new Error('The zip is too large without zip64')
  }
  const central = Buffer.concat(directory)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, central, end])
}
