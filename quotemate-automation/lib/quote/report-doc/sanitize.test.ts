import { describe, expect, it } from 'vitest'
import { sanitizeReportDoc } from './sanitize'
import type { ReportDoc } from './types'

describe('sanitizeReportDoc', () => {
  it('keeps a valid document unchanged', () => {
    const doc: ReportDoc = {
      version: 1,
      blocks: [
        { type: 'title', content: [{ text: 'Repaint' }] },
        { type: 'paragraph', content: [{ text: 'bold bit', marks: ['bold'] }] },
        { type: 'pricing' },
        { type: 'bulletList', items: [[{ text: 'a' }], [{ text: 'b' }]] },
      ],
    }
    expect(sanitizeReportDoc(doc)).toEqual(doc)
  })

  it('drops unknown block types', () => {
    const input = {
      version: 1,
      blocks: [
        { type: 'image', attrs: { src: 'http://evil/x' } },
        { type: 'paragraph', content: [{ text: 'kept' }] },
        { type: 'script', content: [{ text: 'alert(1)' }] },
      ],
    }
    expect(sanitizeReportDoc(input)).toEqual({
      version: 1,
      blocks: [{ type: 'paragraph', content: [{ text: 'kept' }] }],
    })
  })

  it('drops unknown inline marks but keeps allow-listed ones', () => {
    const input = {
      version: 1,
      blocks: [{ type: 'paragraph', content: [{ text: 'x', marks: ['bold', 'link', 'evil'] }] }],
    }
    expect(sanitizeReportDoc(input)).toEqual({
      version: 1,
      blocks: [{ type: 'paragraph', content: [{ text: 'x', marks: ['bold'] }] }],
    })
  })

  it('drops runs whose text is not a non-empty string', () => {
    const input = {
      version: 1,
      blocks: [{ type: 'paragraph', content: [{ text: '' }, { text: 42 }, { text: 'keep' }] }],
    }
    expect(sanitizeReportDoc(input)).toEqual({
      version: 1,
      blocks: [{ type: 'paragraph', content: [{ text: 'keep' }] }],
    })
  })

  it('is robust to garbage input (always returns a valid empty doc)', () => {
    expect(sanitizeReportDoc(null)).toEqual({ version: 1, blocks: [] })
    expect(sanitizeReportDoc('nope')).toEqual({ version: 1, blocks: [] })
    expect(sanitizeReportDoc({ blocks: 'x' })).toEqual({ version: 1, blocks: [] })
    expect(sanitizeReportDoc(42)).toEqual({ version: 1, blocks: [] })
  })

  it('clamps very long text', () => {
    const long = 'a'.repeat(9000)
    const out = sanitizeReportDoc({ version: 1, blocks: [{ type: 'paragraph', content: [{ text: long }] }] })
    const block = out.blocks[0]
    expect(block.type).toBe('paragraph')
    if (block.type === 'paragraph') expect(block.content[0].text.length).toBe(5000)
  })
})
