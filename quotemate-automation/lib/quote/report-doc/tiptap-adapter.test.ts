import { describe, expect, it } from 'vitest'
import { reportDocToTiptap, tiptapToReportDoc, PRICING_NODE } from './tiptap-adapter'
import type { ReportDoc } from './types'

const doc: ReportDoc = {
  version: 1,
  blocks: [
    { type: 'title', content: [{ text: 'Commercial Repaint' }] },
    { type: 'heading', content: [{ text: 'Scope of works' }] },
    { type: 'paragraph', content: [{ text: 'Two coats', marks: ['bold'] }, { text: ' to walls' }] },
    { type: 'pricing' },
    { type: 'bulletList', items: [[{ text: 'Valid 30 days' }], [{ text: '20% deposit' }]] },
  ],
}

describe('reportDocToTiptap / tiptapToReportDoc round-trip', () => {
  it('preserves the supported block + mark subset exactly', () => {
    expect(tiptapToReportDoc(reportDocToTiptap(doc))).toEqual(doc)
  })

  it('maps title to heading level 1 and heading to level 2', () => {
    const tt = reportDocToTiptap(doc)
    expect(tt.content[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } }) // title -> h1
    expect(tt.content[1]).toMatchObject({ type: 'heading', attrs: { level: 2 } }) // heading -> h2
  })

  it('emits the custom pricing node', () => {
    const tt = reportDocToTiptap(doc)
    expect(tt.content.some((n) => n.type === PRICING_NODE)).toBe(true)
  })
})

describe('tiptapToReportDoc allow-list sanitisation', () => {
  it('drops unknown block node types (e.g. a pasted image/table)', () => {
    const json = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'http://evil/x.png' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'kept' }] },
        { type: 'table', content: [] },
      ],
    }
    const out = tiptapToReportDoc(json)
    expect(out.blocks).toEqual([{ type: 'paragraph', content: [{ text: 'kept' }] }])
  })

  it('drops unknown inline marks, keeps allow-listed ones', () => {
    const json = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
          ],
        },
      ],
    }
    const out = tiptapToReportDoc(json)
    expect(out.blocks).toEqual([{ type: 'paragraph', content: [{ text: 'x', marks: ['bold'] }] }])
  })

  it('is robust to garbage input', () => {
    expect(tiptapToReportDoc(null)).toEqual({ version: 1, blocks: [] })
    expect(tiptapToReportDoc('nope')).toEqual({ version: 1, blocks: [] })
    expect(tiptapToReportDoc({ type: 'doc' })).toEqual({ version: 1, blocks: [] })
  })
})

describe('reportDocToTiptap validity', () => {
  it('never emits an empty text node', () => {
    const d: ReportDoc = { version: 1, blocks: [{ type: 'paragraph', content: [{ text: '' }] }] }
    const tt = reportDocToTiptap(d)
    const para = tt.content[0]
    expect(para.content).toBeUndefined() // empty paragraph, no empty text child
  })

  it('always produces at least one block (ProseMirror requires it)', () => {
    const tt = reportDocToTiptap({ version: 1, blocks: [] })
    expect(tt.content.length).toBeGreaterThanOrEqual(1)
  })
})
