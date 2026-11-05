// The flate-bomb pre-flight (TKO-28): a stream that inflates past its cap
// refuses the file before pdf.js opens it, an image stream is never inflated,
// and real plan sets pass.

import { existsSync, readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { inflatesPastLimit } from './pdf-guard'

const MB = 1024 * 1024
const LIMITS = { stream: 1 * MB, file: 4 * MB }

/** A minimal PDF holding the given streams, each an indirect object. */
function pdfWith(...streams: Array<{ dict: string; data: Buffer }>): Uint8Array {
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n')]
  streams.forEach(({ dict, data }, i) => {
    parts.push(Buffer.from(`${i + 1} 0 obj\n<< /Length ${data.length} ${dict} >>\nstream\n`), data, Buffer.from('\nendstream\nendobj\n'))
  })
  parts.push(Buffer.from('trailer\n<< >>\n%%EOF\n'))
  return new Uint8Array(Buffer.concat(parts))
}
const flate = (bytes: number) => deflateSync(Buffer.alloc(bytes, 0x20))

describe('inflatesPastLimit', () => {
  it('passes a real PDF', async () => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([400, 300])
    page.drawText('ROOF PLAN 1:100', { x: 20, y: 150, size: 18, font: await pdf.embedFont(StandardFonts.Helvetica) })
    expect(inflatesPastLimit(await pdf.save(), LIMITS)).toBe(false)
  })

  it('refuses a content stream that inflates past its cap, without inflating the rest of it', () => {
    const bomb = pdfWith({ dict: '/Filter /FlateDecode', data: flate(2 * MB) })
    expect(bomb.length).toBeLessThan(10_000)
    expect(inflatesPastLimit(bomb, LIMITS)).toBe(true)
  })

  it('refuses streams that together inflate past the file cap', () => {
    const many = pdfWith(...Array.from({ length: 6 }, () => ({ dict: '/Filter /FlateDecode', data: flate(0.9 * MB) })))
    expect(inflatesPastLimit(many, LIMITS)).toBe(true)
    expect(inflatesPastLimit(pdfWith({ dict: '/Filter /FlateDecode', data: flate(0.9 * MB) }), LIMITS)).toBe(false)
  })

  it('inflates each layer of a stream compressed twice', () => {
    const twice = pdfWith({ dict: '/Filter [/FlateDecode /FlateDecode]', data: deflateSync(flate(2 * MB)) })
    expect(inflatesPastLimit(twice, LIMITS)).toBe(true)
  })

  it('leaves an image stream alone, as text extraction never decodes one', () => {
    const image = pdfWith({ dict: '/Type /XObject /Subtype /Image /Width 2048 /Height 1024 /Filter /FlateDecode', data: flate(2 * MB) })
    expect(inflatesPastLimit(image, LIMITS)).toBe(false)
  })

  const fixtures = [
    'docs/tag-roofing-requests/J14997-59-Grange-Rd/Architectural - 59 Grange Rd, Eastern Heights (4) Compressed.pdf',
    'docs/tag-roofing-requests/J14997-59-Grange-Rd/Engineering- 59 GRANGE RD, EASTERN HEIGHTS Compressed.pdf',
    'docs/tag-roofing-requests/J14945-5-Whittaker-St/Sections - 5 Whittaker street.pdf',
    'docs/tag-roofing-requests/J14945-5-Whittaker-St/final Morgans Engineering plans - 5 Whittaker street .pdf',
  ].filter((file) => existsSync(file))
  it.skipIf(!fixtures.length)('passes the real plan sets at the default caps', () => {
    for (const file of fixtures) expect(inflatesPastLimit(new Uint8Array(readFileSync(file))), file).toBe(false)
  })
})
