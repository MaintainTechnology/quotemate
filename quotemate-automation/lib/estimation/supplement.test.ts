import { describe, it, expect } from 'vitest'
import {
  buildSupplementQueries,
  findQuantityInSnippets,
  mergeSupplement,
  supplementExtraction,
  type SupplementEvidence,
} from './supplement'
import type { ParsedExtraction } from './extract'
import type { FileStoreClient, FileStoreSearchResult } from './filestore-client'

function extraction(over: Partial<ParsedExtraction> = {}): ParsedExtraction {
  return {
    sheets_used: ['104 Rev B'],
    legend_symbols: [],
    items: [],
    overall_note: '',
    ...over,
  }
}

// ── buildSupplementQueries ────────────────────────────────────────────

describe('buildSupplementQueries', () => {
  it('targets only low/medium-confidence items, low first; skips high', () => {
    const parsed = extraction({
      items: [
        { type: 'Double GPO', symbol: '▲▲', count: 40, confidence: 'medium' },
        { type: 'Downlight 12W', symbol: 'O', count: 53, confidence: 'low' },
        { type: 'Switchboard', symbol: 'DB', count: 1, confidence: 'high' },
      ],
    })
    const qs = buildSupplementQueries(parsed)
    expect(qs.map((q) => q.key)).toEqual(['item:1', 'item:0']) // low (idx1) before medium (idx0); high excluded
    expect(qs[0].query).toContain('Downlight 12W')
  })

  it('adds a query for legend symbols that were never counted', () => {
    const parsed = extraction({
      items: [{ type: 'Double GPO', symbol: '▲▲', count: 40, confidence: 'high' }],
      legend_symbols: [
        { symbol: '▲▲', means: 'Double GPO' }, // already counted → no query
        { symbol: 'E', means: 'Exit sign' }, // gap → query
      ],
    })
    const qs = buildSupplementQueries(parsed)
    expect(qs).toHaveLength(1)
    expect(qs[0].target).toMatchObject({ kind: 'legend', means: 'Exit sign' })
  })

  it('caps the number of queries', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      type: `Item ${i}`,
      symbol: `S${i}`,
      count: i,
      confidence: 'low' as const,
    }))
    expect(buildSupplementQueries(extraction({ items }), 5)).toHaveLength(5)
  })
})

// ── findQuantityInSnippets ────────────────────────────────────────────

describe('findQuantityInSnippets', () => {
  it('reads explicit quantities in several schedule formats', () => {
    expect(findQuantityInSnippets(['Double GPO'], ['Power schedule — Double GPO: 42 total'])).toBe(42)
    expect(findQuantityInSnippets(['GPO'], ['42 x GPO throughout'])).toBe(42)
    expect(findQuantityInSnippets(['GPO'], ['GPO x 42'])).toBe(42)
    expect(findQuantityInSnippets(['Exit sign'], ['Exit sign quantity 3'])).toBe(3)
    expect(findQuantityInSnippets(['Downlight'], ['Downlight = 18'])).toBe(18)
  })

  it('returns null when there is no explicit number', () => {
    expect(findQuantityInSnippets(['Double GPO'], ['Double GPO are shown across the plan'])).toBeNull()
    expect(findQuantityInSnippets(['Double GPO'], [])).toBeNull()
  })

  it('returns null on conflicting quantities across snippets', () => {
    expect(findQuantityInSnippets(['GPO'], ['GPO: 42', 'GPO: 50'])).toBeNull()
  })

  it('ignores needles shorter than two characters (avoids false hits)', () => {
    expect(findQuantityInSnippets(['E'], ['there are 9 E somewhere'])).toBeNull()
  })
})

// ── mergeSupplement ───────────────────────────────────────────────────

describe('mergeSupplement', () => {
  it('corrects a count when the schedule text states a different number', () => {
    const parsed = extraction({ items: [{ type: 'Double GPO', symbol: '▲▲', count: 40, confidence: 'medium' }] })
    const ev: SupplementEvidence[] = [
      { target: { kind: 'item', index: 0, type: 'Double GPO', symbol: '▲▲' }, snippets: ['Double GPO: 42'] },
    ]
    const { parsed: out, changes } = mergeSupplement(parsed, ev)
    expect(out.items[0].count).toBe(42)
    expect(out.items[0].confidence).toBe('high')
    expect(out.items[0].note).toContain('[file-store]')
    expect(changes).toEqual([
      expect.objectContaining({ kind: 'count_corrected', before: 40, after: 42, item_type: 'Double GPO' }),
    ])
  })

  it('raises confidence (no count change) when the text corroborates the count', () => {
    const parsed = extraction({ items: [{ type: 'Double GPO', symbol: '▲▲', count: 42, confidence: 'medium' }] })
    const ev: SupplementEvidence[] = [
      { target: { kind: 'item', index: 0, type: 'Double GPO', symbol: '▲▲' }, snippets: ['Double GPO: 42'] },
    ]
    const { parsed: out, changes } = mergeSupplement(parsed, ev)
    expect(out.items[0].count).toBe(42)
    expect(out.items[0].confidence).toBe('high')
    expect(changes[0].kind).toBe('confidence_raised')
  })

  it('does NOT fabricate: leaves the item untouched when evidence has no number', () => {
    const parsed = extraction({ items: [{ type: 'Double GPO', symbol: '▲▲', count: 40, confidence: 'low' }] })
    const ev: SupplementEvidence[] = [
      { target: { kind: 'item', index: 0, type: 'Double GPO', symbol: '▲▲' }, snippets: ['Double GPO appear on the plan'] },
    ]
    const { parsed: out, changes } = mergeSupplement(parsed, ev)
    expect(out.items[0]).toEqual({ type: 'Double GPO', symbol: '▲▲', count: 40, confidence: 'low' })
    expect(changes).toHaveLength(0)
  })

  it('fills a gap: adds a legend item the visual count missed when the text gives a quantity', () => {
    const parsed = extraction({ items: [], legend_symbols: [{ symbol: 'E', means: 'Exit sign' }] })
    const ev: SupplementEvidence[] = [
      { target: { kind: 'legend', symbol: 'E', means: 'Exit sign' }, snippets: ['Exit sign: 3'] },
    ]
    const { parsed: out, changes } = mergeSupplement(parsed, ev)
    expect(out.items).toHaveLength(1)
    expect(out.items[0]).toMatchObject({ type: 'Exit sign', count: 3, confidence: 'medium' })
    expect(changes[0].kind).toBe('gap_filled')
  })

  it('does not add a gap item when the text has no quantity', () => {
    const parsed = extraction({ items: [], legend_symbols: [{ symbol: 'E', means: 'Exit sign' }] })
    const ev: SupplementEvidence[] = [
      { target: { kind: 'legend', symbol: 'E', means: 'Exit sign' }, snippets: ['Exit signs as required'] },
    ]
    const { parsed: out, changes } = mergeSupplement(parsed, ev)
    expect(out.items).toHaveLength(0)
    expect(changes).toHaveLength(0)
  })
})

// ── supplementExtraction (orchestration) ──────────────────────────────

type FakeOpts = {
  storeName?: string
  searchResult?: FileStoreSearchResult
  createStoreThrows?: boolean
  uploadThrows?: boolean
  searchThrows?: boolean
}

function fakeClient(opts: FakeOpts = {}) {
  const calls = { createStore: 0, uploadPdf: 0, search: 0, deleteStore: 0 }
  const deleted: string[] = []
  const client: FileStoreClient = {
    async createStore() {
      calls.createStore++
      if (opts.createStoreThrows) throw new Error('create boom')
      return { name: opts.storeName ?? 'fileSearchStores/tmp1' }
    },
    async uploadPdf() {
      calls.uploadPdf++
      if (opts.uploadThrows) throw new Error('upload boom')
      return { document: {} }
    },
    async search() {
      calls.search++
      if (opts.searchThrows) throw new Error('search boom')
      return opts.searchResult ?? { answer: '', citations: [] }
    },
    async deleteStore(name: string) {
      calls.deleteStore++
      deleted.push(name)
      return { deleted: true }
    },
  }
  return { client, calls, deleted }
}

const PDF = new Uint8Array([1, 2, 3])

describe('supplementExtraction', () => {
  it('passes through unchanged when the client is null (not configured)', async () => {
    const parsed = extraction({ items: [{ type: 'GPO', symbol: 'G', count: 5, confidence: 'low' }] })
    const out = await supplementExtraction({ parsed, pdf: PDF, filename: 'p.pdf', client: null })
    expect(out.supplemented).toBe(false)
    expect(out.parsed).toBe(parsed)
  })

  it('skips the store entirely when there is nothing to verify', async () => {
    const parsed = extraction({ items: [{ type: 'GPO', symbol: 'G', count: 5, confidence: 'high' }] })
    const { client, calls } = fakeClient()
    const out = await supplementExtraction({ parsed, pdf: PDF, filename: 'p.pdf', client })
    expect(out.supplemented).toBe(false)
    expect(calls.createStore).toBe(0)
  })

  it('corrects counts on the happy path and always deletes the store', async () => {
    const parsed = extraction({ items: [{ type: 'Double GPO', symbol: '▲▲', count: 40, confidence: 'medium' }] })
    const { client, calls, deleted } = fakeClient({
      searchResult: { answer: 'ignore me', citations: [{ snippet: 'Double GPO: 42' }] },
    })
    const out = await supplementExtraction({ parsed, pdf: PDF, filename: 'p.pdf', client })
    expect(out.supplemented).toBe(true)
    expect(out.parsed.items[0].count).toBe(42)
    expect(calls.deleteStore).toBe(1)
    expect(deleted).toEqual(['fileSearchStores/tmp1'])
  })

  it('uses citation snippets, not the unreliable answer field', async () => {
    const parsed = extraction({ items: [{ type: 'Double GPO', symbol: '▲▲', count: 40, confidence: 'medium' }] })
    const { client } = fakeClient({
      searchResult: { answer: 'There are 999 Double GPO', citations: [{ snippet: 'Double GPO: 42' }] },
    })
    const out = await supplementExtraction({ parsed, pdf: PDF, filename: 'p.pdf', client })
    expect(out.parsed.items[0].count).toBe(42) // from snippet, not 999 from answer
  })

  it('deletes the store even when search throws, and degrades gracefully', async () => {
    const parsed = extraction({ items: [{ type: 'GPO', symbol: 'G', count: 5, confidence: 'low' }] })
    const { client, calls } = fakeClient({ searchThrows: true })
    const out = await supplementExtraction({ parsed, pdf: PDF, filename: 'p.pdf', client })
    expect(out.supplemented).toBe(false)
    expect(out.parsed).toBe(parsed) // original returned unchanged
    expect(calls.deleteStore).toBe(1) // cleanup still happened
  })

  it('deletes the store even when upload throws', async () => {
    const parsed = extraction({ items: [{ type: 'GPO', symbol: 'G', count: 5, confidence: 'low' }] })
    const { client, calls } = fakeClient({ uploadThrows: true })
    const out = await supplementExtraction({ parsed, pdf: PDF, filename: 'p.pdf', client })
    expect(out.supplemented).toBe(false)
    expect(calls.deleteStore).toBe(1)
  })

  it('does not attempt deletion when the store was never created', async () => {
    const parsed = extraction({ items: [{ type: 'GPO', symbol: 'G', count: 5, confidence: 'low' }] })
    const { client, calls } = fakeClient({ createStoreThrows: true })
    const out = await supplementExtraction({ parsed, pdf: PDF, filename: 'p.pdf', client })
    expect(out.supplemented).toBe(false)
    expect(calls.deleteStore).toBe(0)
  })
})
