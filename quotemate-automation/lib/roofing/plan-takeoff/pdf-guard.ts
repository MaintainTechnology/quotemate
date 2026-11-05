// A pre-flight on a plan PDF's compressed streams, before pdf.js opens it
// (TKO-28). The API, the worker and the health checks share one process, and
// a flate bomb (255 kB that inflates to 256 MB in one content stream)
// exhausts its memory in text extraction. Each Flate stream that isn't an
// image is inflated by zlib under a cap; past it, the file is refused. Image
// streams are left alone: text extraction never decodes them.
//
// ponytail: a byte scan for stream/endstream, not a PDF parser, so an
// encrypted file's streams don't inflate here and pass. pdf.js run in a child
// process with memory and time limits is the full answer if one is needed.

import { inflateSync } from 'node:zlib'

const MB = 1024 * 1024
export const INFLATE_LIMITS = { stream: 128 * MB, file: 512 * MB }

/** True when the file's Flate streams inflate past the caps. */
export function inflatesPastLimit(bytes: Uint8Array, limits = INFLATE_LIMITS): boolean {
  const pdf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let total = 0
  let at = 0
  while ((at = pdf.indexOf('stream', at, 'latin1')) >= 0) {
    if (at >= 3 && pdf.toString('latin1', at - 3, at) === 'end') {
      at += 6
      continue
    }
    let start = at + 6
    if (pdf[start] === 0x0d) start++
    if (pdf[start] === 0x0a) start++
    const end = pdf.indexOf('endstream', start, 'latin1')
    if (end < 0) return false
    // The stream's dictionary, back to its object's "obj" keyword.
    const before = pdf.toString('latin1', Math.max(0, at - 2048), at)
    const dict = before.slice(before.lastIndexOf('obj') + 3)
    at = end + 9
    const layers = dict.match(/\/FlateDecode\b/g)?.length ?? 0
    if (!layers || /\/Subtype\s*\/Image\b/.test(dict)) continue
    let data: Buffer = pdf.subarray(start, end)
    for (let layer = 0; layer < layers; layer++) {
      try {
        data = inflateSync(data, { maxOutputLength: Math.max(1, Math.min(limits.stream, limits.file - total)) })
      } catch (error) {
        if ((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') return true
        break // a stream zlib can't read is pdf.js's to judge
      }
    }
    total += data.length
    if (total > limits.file) return true
  }
  return false
}
