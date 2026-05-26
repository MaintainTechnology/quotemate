// Tests for the trade-book extraction orchestrator.
// Mocks the mt-filestore-kb HTTP layer via the fetchImpl injection.

import { describe, expect, it, vi } from 'vitest'
import { extractTradeBook, toAssemblyPayload } from './trade-book-extract'
import type { KbFetch } from './mt-filestore-kb'
import type { ExtractedService } from './trade-book-prompt'

const config = { url: 'https://kb.example.com', apiKey: 'test-key' }

const validService = {
  trade: 'electrical',
  name: 'Install LED downlight (new install)',
  category: 'downlight',
  default_unit: 'each',
  default_unit_price_ex_gst: 35,
  default_labour_hours: 1.75,
  source_citation: 'Page 12, Section 4.2',
}

function mockKbResponse(answer: string): KbFetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ answer }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as KbFetch
}

describe('extractTradeBook', () => {
  it('returns valid rows when the model returns clean JSON', async () => {
    const f = mockKbResponse(JSON.stringify([validService]))
    const result = await extractTradeBook({
      config,
      storeId: 'fileSearchStores/abc',
      fetchImpl: f,
    })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].name).toBe(validService.name)
    expect(result.errors).toHaveLength(0)
    expect(result.kbResult.answer).toContain('Install LED downlight')
    expect(result.promptSent).toContain('default_labour_hours')
  })

  it('returns empty rows + parseErrors when model returns malformed JSON', async () => {
    const f = mockKbResponse('I cannot extract this document')
    const result = await extractTradeBook({
      config,
      storeId: 'abc',
      fetchImpl: f,
    })
    expect(result.rows).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].issues[0]).toContain('not valid JSON')
  })

  it('handles a model response wrapped in markdown fences', async () => {
    const fenced = '```json\n' + JSON.stringify([validService]) + '\n```'
    const f = mockKbResponse(fenced)
    const result = await extractTradeBook({
      config,
      storeId: 'abc',
      fetchImpl: f,
    })
    expect(result.rows).toHaveLength(1)
  })

  it('passes the trade hint into the prompt when provided', async () => {
    const f = mockKbResponse('[]')
    await extractTradeBook({
      config,
      storeId: 'abc',
      trade: 'plumbing',
      fetchImpl: f,
    })
    const [, init] = (f as any).mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.query).toContain('plumbing tradie')
  })

  it('passes the metadataFilter through to the KB call', async () => {
    const f = mockKbResponse('[]')
    await extractTradeBook({
      config,
      storeId: 'abc',
      metadataFilter: 'author="Jon"',
      fetchImpl: f,
    })
    const [, init] = (f as any).mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.metadataFilter).toBe('author="Jon"')
  })

  it('passes the model override through to the KB call', async () => {
    const f = mockKbResponse('[]')
    await extractTradeBook({
      config,
      storeId: 'abc',
      model: 'gemini-2.5-pro',
      fetchImpl: f,
    })
    const [, init] = (f as any).mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.model).toBe('gemini-2.5-pro')
  })

  it('separates valid and invalid rows when the model returns mixed JSON', async () => {
    const mix = [
      validService,
      { ...validService, trade: 'astronaut' }, // invalid
      { ...validService, name: 'Different OK' }, // valid
    ]
    const f = mockKbResponse(JSON.stringify(mix))
    const result = await extractTradeBook({
      config,
      storeId: 'abc',
      fetchImpl: f,
    })
    expect(result.rows).toHaveLength(2)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].index).toBe(1)
  })

  it('throws when storeId is empty', async () => {
    const f = mockKbResponse('[]')
    await expect(
      extractTradeBook({ config, storeId: '', fetchImpl: f }),
    ).rejects.toThrow('storeId is required')
  })

  it('passes a 404 KB error through as a thrown error', async () => {
    const f = vi.fn().mockResolvedValue(
      new Response('not found', { status: 404 }),
    ) as unknown as KbFetch
    await expect(
      extractTradeBook({ config, storeId: 'abc', fetchImpl: f }),
    ).rejects.toThrow(/404/)
  })
})

describe('toAssemblyPayload', () => {
  it('maps a fully-populated ExtractedService into a shared_assemblies-shaped payload', () => {
    const svc: ExtractedService = {
      trade: 'electrical',
      name: 'Install LED downlight (new install)',
      description: 'New install',
      category: 'downlight',
      default_unit: 'each',
      default_unit_price_ex_gst: 35,
      default_labour_hours: 1.75,
      default_exclusions: 'Excludes new wiring',
      clarifying_questions: ['How many?'],
      row_assumptions: { switch_within_metres: 5 },
      inspection_triggers: ['raked ceiling'],
      properties: { weatherproof: false },
      always_inspection: false,
      materials: [{ name: 'LED downlight', unit_price_ex_gst: 28 }],
      source_citation: 'Page 12',
    }
    const payload = toAssemblyPayload(svc)
    expect(payload.trade).toBe('electrical')
    expect(payload.name).toBe(svc.name)
    expect(payload.category).toBe('downlight')
    expect(payload.default_labour_hours).toBe(1.75)
    expect(payload.clarifying_questions).toEqual(['How many?'])
    expect(payload.row_assumptions).toEqual({ switch_within_metres: 5 })
    expect(payload.inspection_triggers).toEqual(['raked ceiling'])
    expect(payload.always_inspection).toBe(false)
    // _materials kept under the _-prefix; the api route splits it out.
    expect((payload._materials as any[]).length).toBe(1)
  })

  it('coerces missing optional collections to safe defaults', () => {
    const svc: ExtractedService = {
      trade: 'electrical',
      name: 'Minimal row',
      category: 'general',
      default_unit: 'each',
      default_unit_price_ex_gst: 10,
      default_labour_hours: 0.5,
      source_citation: 'somewhere',
      // optionals omitted — Zod default()s fill them in upstream
      clarifying_questions: [],
      row_assumptions: {},
      inspection_triggers: [],
      properties: {},
      always_inspection: false,
      materials: [],
      description: null,
      default_exclusions: null,
    }
    const payload = toAssemblyPayload(svc)
    expect(payload.description).toBeNull()
    expect(payload.default_exclusions).toBeNull()
    expect(payload.clarifying_questions).toEqual([])
    expect(payload._materials).toEqual([])
  })
})
