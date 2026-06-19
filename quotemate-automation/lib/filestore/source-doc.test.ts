import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// Mock the heavy PDF render chain — source-doc only needs the ensure* fns.
vi.mock('@/lib/quote/pdf', () => ({
  ensureQuotePdf: vi.fn(),
  ensureRoofQuotePdf: vi.fn(),
  ensureSolarQuotePdf: vi.fn(),
  ensurePaintingPdf: vi.fn(),
}))

import {
  ensureQuotePdf,
  ensureRoofQuotePdf,
  ensureSolarQuotePdf,
  ensurePaintingPdf,
} from '@/lib/quote/pdf'
import { loadAndBuildKbDoc } from './source-doc'

/** Fake Supabase whose maybeSingle() returns the configured row per table. */
function fakeSb(tables: Record<string, unknown>): Pick<SupabaseClient, 'from'> {
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: tables[table] ?? null, error: null }),
      }
      return chain as unknown as ReturnType<SupabaseClient['from']>
    },
  } as Pick<SupabaseClient, 'from'>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loadAndBuildKbDoc', () => {
  it('electrical → ensureQuotePdf(quote.id), builds from the quotes row', async () => {
    vi.mocked(ensureQuotePdf).mockResolvedValue('quotes/q1.pdf')
    const sb = fakeSb({
      quotes: { id: 'q1', tenant_id: 't1', good: { label: 'E', subtotal_ex_gst: 1000, line_items: [] } },
    })
    const out = await loadAndBuildKbDoc(sb, { sourceKind: 'quote', sourceId: 'q1', trade: 'electrical' })
    expect(ensureQuotePdf).toHaveBeenCalledWith('q1')
    expect(out).toMatchObject({ tenantId: 't1', trade: 'electrical', fullDocPath: 'quotes/q1.pdf' })
    expect(out!.kbText).toContain('Trade: electrical')
    expect(out!.contentHash).toBeTruthy()
  })

  it('returns null when ensure*Pdf yields no doc (lockstep)', async () => {
    vi.mocked(ensureQuotePdf).mockResolvedValue(null) // inspection-routed / Gotenberg down
    const sb = fakeSb({ quotes: { id: 'q1', tenant_id: 't1', good: null } })
    const out = await loadAndBuildKbDoc(sb, { sourceKind: 'quote', sourceId: 'q1', trade: 'plumbing' })
    expect(out).toBeNull()
  })

  it('roofing → ensureRoofQuotePdf(public_token), reads combined.tiers', async () => {
    vi.mocked(ensureRoofQuotePdf).mockResolvedValue('roofs/tok.pdf')
    const sb = fakeSb({
      roofing_measurements: { tenant_id: 't2', public_token: 'tok', quote: { combined: { tiers: [{ tier: 'std', inc_gst: 9000 }] } }, routing: 'tradie_review' },
    })
    const out = await loadAndBuildKbDoc(sb, { sourceKind: 'quote', sourceId: 'tok', trade: 'roofing' })
    expect(ensureRoofQuotePdf).toHaveBeenCalledWith('tok')
    expect(out).toMatchObject({ tenantId: 't2', trade: 'roofing', fullDocPath: 'roofs/tok.pdf' })
    expect(out!.kbText).toContain('9000')
  })

  it('solar → ensureSolarQuotePdf(public_token), reads price.tiers', async () => {
    vi.mocked(ensureSolarQuotePdf).mockResolvedValue('solar/tok.pdf')
    const sb = fakeSb({
      solar_estimates: { tenant_id: 't3', public_token: 'tok', estimate: { price: { tiers: [{ tier: 'best', net_inc_gst: 9990 }] } }, routing: 'tradie_review' },
    })
    const out = await loadAndBuildKbDoc(sb, { sourceKind: 'quote', sourceId: 'tok', trade: 'solar' })
    expect(ensureSolarQuotePdf).toHaveBeenCalledWith('tok')
    expect(out).toMatchObject({ tenantId: 't3', trade: 'solar', fullDocPath: 'solar/tok.pdf' })
    expect(out!.kbText).toContain('9990')
  })

  it('painting → ensurePaintingPdf(public_token)', async () => {
    vi.mocked(ensurePaintingPdf).mockResolvedValue('paint/tok.pdf')
    const sb = fakeSb({
      painting_measurements: { tenant_id: 't4', public_token: 'tok', estimate: { totalIncGst: 26400, lines: [] }, routing: 'tradie_review' },
    })
    const out = await loadAndBuildKbDoc(sb, { sourceKind: 'quote', sourceId: 'tok', trade: 'painting' })
    expect(ensurePaintingPdf).toHaveBeenCalledWith('tok')
    expect(out).toMatchObject({ tenantId: 't4', trade: 'painting', fullDocPath: 'paint/tok.pdf' })
  })

  it('invoice → builds from invoice_extractions.raw, fullDocPath from storage_path', async () => {
    const sb = fakeSb({
      invoice_uploads: { id: 'inv1', tenant_id: 't5', storage_path: 'invoices/inv1.jpg' },
      invoice_extractions: { upload_id: 'inv1', raw: { scope_description: 'Replaced 6 downlights', total_inc_gst: 1320, customer_name: 'Jane Doe', customer_suburb: 'Manly' } },
    })
    const out = await loadAndBuildKbDoc(sb, { sourceKind: 'invoice', sourceId: 'inv1' })
    expect(out).toMatchObject({ tenantId: 't5', fullDocPath: 'invoices/inv1.jpg' })
    expect(out!.kbText).toContain('1320')
    expect(out!.kbText).not.toContain('Jane Doe') // PII still stripped on rebuild
  })

  it('returns null when the source row is missing', async () => {
    const out = await loadAndBuildKbDoc(fakeSb({}), { sourceKind: 'quote', sourceId: 'nope', trade: 'electrical' })
    expect(out).toBeNull()
  })
})
