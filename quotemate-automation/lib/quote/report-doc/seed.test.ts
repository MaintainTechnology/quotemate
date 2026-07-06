import { describe, expect, it } from 'vitest'
import { buildDefaultReportDoc } from './seed'

describe('buildDefaultReportDoc', () => {
  it('builds title + scope + pricing + assumptions in order', () => {
    const doc = buildDefaultReportDoc({
      title: 'Repaint — 12 Smith St',
      scopeOfWorks: 'Two coats to walls.',
      assumptions: ['Access provided', 'Power on site'],
    })
    expect(doc.version).toBe(1)
    const types = doc.blocks.map((b) => b.type)
    expect(types).toEqual(['title', 'heading', 'paragraph', 'pricing', 'heading', 'bulletList'])
  })

  it('always includes exactly one pricing block', () => {
    const doc = buildDefaultReportDoc({ title: 'X' })
    expect(doc.blocks.filter((b) => b.type === 'pricing')).toHaveLength(1)
  })

  it('omits the scope section when there is no scope', () => {
    const doc = buildDefaultReportDoc({ title: 'X' })
    expect(doc.blocks.some((b) => b.type === 'paragraph')).toBe(false)
  })

  it('omits the assumptions section when there are none', () => {
    const doc = buildDefaultReportDoc({ title: 'X', scopeOfWorks: 'Y' })
    expect(doc.blocks.filter((b) => b.type === 'bulletList')).toHaveLength(0)
  })

  it('falls back to a default title when none is given', () => {
    const doc = buildDefaultReportDoc({})
    expect(doc.blocks[0]).toEqual({ type: 'title', content: [{ text: 'Quotation' }] })
  })
})
