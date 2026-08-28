import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pricePaintTakeoff } from '@/lib/commercial-painting/price'
import { resolvePaintRates } from '@/lib/commercial-painting/rates'
import type { PaintRateRow, PaintTakeoffItem, PricedPaintBom } from '@/lib/commercial-painting/types'

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  archiveAndIngestQuote: vi.fn(),
  buildQuoteKbText: vi.fn(() => ({ markdown: 'kb', contentHash: 'hash' })),
  createClient: vi.fn(),
  dispatchQuoteWithPdf: vi.fn(),
  from: vi.fn(),
  generateShareToken: vi.fn(() => 'share-token'),
  loadPaintRates: vi.fn(),
  loadTenantBranding: vi.fn(async () => ({ businessName: 'Tenant Painting' })),
  provisionSessionStore: vi.fn(),
  tenantFromBearer: vi.fn(),
}))

vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/estimation/auth', () => ({
  tenantFromBearer: mocks.tenantFromBearer,
  estimatorSupabase: { from: mocks.from },
}))
vi.mock('@/lib/commercial-painting/rates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/commercial-painting/rates')>(
    '@/lib/commercial-painting/rates',
  )
  return { ...actual, loadPaintRates: mocks.loadPaintRates }
})
vi.mock('@/lib/filestore/ingest-quote', () => ({ archiveAndIngestQuote: mocks.archiveAndIngestQuote }))
vi.mock('@/lib/filestore/minimize', () => ({ buildQuoteKbText: mocks.buildQuoteKbText }))
vi.mock('@/lib/pdf/branding', () => ({ loadTenantBranding: mocks.loadTenantBranding }))
vi.mock('@/lib/pdf/gotenberg', () => ({ gotenbergConfigured: () => false, renderPdfFromHtml: vi.fn() }))
vi.mock('@/lib/sms/send-quote-pdf', () => ({ dispatchQuoteWithPdf: mocks.dispatchQuoteWithPdf }))
vi.mock('@/lib/quote/pdf', () => ({ signQuotePdfUrl: vi.fn() }))
vi.mock('@/lib/stripe/checkout', () => ({ generateShareToken: mocks.generateShareToken }))
vi.mock('@/lib/log/pipeline', () => ({ pipelineLog: () => ({ ok: vi.fn(), err: vi.fn() }) }))
vi.mock('@/lib/filestore/provision', () => ({ provisionSessionStore: mocks.provisionSessionStore }))

const storageUpload = vi.fn(async () => ({ error: null }))
mocks.createClient.mockReturnValue({ storage: { from: () => ({ upload: storageUpload }) } })

import { POST } from './route'

const ITEM: PaintTakeoffItem = {
  surface: 'Internal walls',
  room: 'Retail',
  substrate: 'plasterboard',
  system: 'low_sheen',
  unit: 'm2',
  quantity: 100,
  coats: 2,
  confidence: 'high',
  source: 'plan',
}

const TENANT_ROWS: PaintRateRow[] = [
  { kind: 'labour', code: 'labour:low_sheen:roller', label: 'Tenant labour', tenant_id: 'tenant-1', system: 'low_sheen', method: 'roller', coverage_m2_per_hr: 10, is_default: false },
  { kind: 'material', code: 'mat:wall_low_sheen', label: 'Tenant paint', tenant_id: 'tenant-1', system: 'low_sheen', product: 'Tenant low sheen', spread_m2_per_l: 15, price_per_l_ex_gst: 11, is_default: false },
  { kind: 'modifier', code: 'mod:height_low', label: 'low', tenant_id: 'tenant-1', value: 1, is_default: false },
  { kind: 'modifier', code: 'mod:height_mid', label: 'mid', tenant_id: 'tenant-1', value: 1.25, is_default: false },
  { kind: 'modifier', code: 'mod:height_high', label: 'high', tenant_id: 'tenant-1', value: 1.4, is_default: false },
  { kind: 'modifier', code: 'mod:prep_pct', label: 'prep', tenant_id: 'tenant-1', value: 0.1, is_default: false },
  { kind: 'modifier', code: 'mod:sundries_pct', label: 'sundries', tenant_id: 'tenant-1', value: 0.08, is_default: false },
  { kind: 'modifier', code: 'mod:labour_rate', label: 'rate', tenant_id: 'tenant-1', value: 95, is_default: false },
  { kind: 'modifier', code: 'mod:crew_hours_per_day', label: 'hours', tenant_id: 'tenant-1', value: 7.6, is_default: false },
  { kind: 'modifier', code: 'mod:default_crew_size', label: 'crew', tenant_id: 'tenant-1', value: 3, is_default: false },
]

const tenantBook = resolvePaintRates(TENANT_ROWS)
const validBom = pricePaintTakeoff([ITEM], tenantBook, { gstRegistered: true })
const unmatchedBom = pricePaintTakeoff([{ ...ITEM, system: 'textured' as never }], tenantBook)

type DbState = {
  bom: PricedPaintBom
  book?: { id: string; gst_registered: boolean } | null
  inserts: Array<{ table: string; payload: unknown }>
  updates: Array<{ table: string; payload: unknown }>
}

function chain(result: unknown) {
  const q: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'limit', 'is']) q[method] = vi.fn(() => q)
  q.maybeSingle = vi.fn(async () => result)
  q.single = vi.fn(async () => result)
  q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return q
}

function installDb(state: DbState) {
  mocks.from.mockImplementation((table: string) => {
    let result: unknown
    if (table === 'paint_runs') result = { data: { id: 'run-1', job_name: 'Retail repaint', site_address: '1 Test St' }, error: null }
    else if (table === 'plan_extractions') result = { data: { id: 'ext-1', priced_bom: state.bom, priced_at: '2026-08-28T00:00:00Z', sheets_used: {} }, error: null }
    else if (table === 'pricing_book') result = { data: state.book ?? null, error: null }
    else if (table === 'tenants') result = { data: { business_name: 'Tenant Painting', twilio_sms_number: null }, error: null }
    else if (table === 'intakes') result = { data: { id: 'intake-1' }, error: null }
    else if (table === 'quotes') result = { data: { id: 'quote-1', share_token: 'share-token' }, error: null }
    else throw new Error(`Unexpected table ${table}`)

    const q = chain(result) as Record<string, unknown>
    q.insert = vi.fn((payload: unknown) => {
      state.inserts.push({ table, payload })
      return q
    })
    q.update = vi.fn((payload: unknown) => {
      state.updates.push({ table, payload })
      return chain({ error: null })
    })
    return q
  })
}

function request() {
  return new Request('http://localhost/api/tenant/commercial-painting/save-quote', {
    method: 'POST',
    body: JSON.stringify({ paintRunId: 'run-1', extractionId: 'ext-1' }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createClient.mockReturnValue({ storage: { from: () => ({ upload: storageUpload }) } })
  mocks.tenantFromBearer.mockResolvedValue({ id: 'tenant-1', trade: 'commercial_painting' })
  mocks.loadPaintRates.mockResolvedValue(TENANT_ROWS)
  mocks.generateShareToken.mockReturnValue('share-token')
})

describe('commercial painting save quote authority route', () => {
  it('blocks an unmatched stored BOM before intake or quote insertion', async () => {
    const state: DbState = { bom: unmatchedBom, book: { id: 'book-1', gst_registered: true }, inserts: [], updates: [] }
    installDb(state)

    const response = await POST(request())

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ ok: false, error: 'inspection_required' })
    expect(state.inserts).toEqual([])
  })

  it('blocks seed/default rates before intake or quote insertion', async () => {
    mocks.loadPaintRates.mockResolvedValue(TENANT_ROWS.map((row) => ({ ...row, is_default: true })))
    const state: DbState = { bom: validBom, book: { id: 'book-1', gst_registered: true }, inserts: [], updates: [] }
    installDb(state)

    const response = await POST(request())

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ ok: false, error: 'tenant_pricing_required' })
    expect(state.inserts).toEqual([])
  })

  it('keeps the current tradie-review success path for fully tenant-priced BOMs', async () => {
    const state: DbState = { bom: validBom, book: { id: 'book-1', gst_registered: true }, inserts: [], updates: [] }
    installDb(state)

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, quoteId: 'quote-1', shareToken: 'share-token' })
    expect(state.inserts.map((entry) => entry.table)).toEqual(['intakes', 'quotes'])
    const quote = state.inserts.find((entry) => entry.table === 'quotes')?.payload as Record<string, unknown>
    expect(quote.routing_decision).toBe('tradie_review')
    expect(quote.needs_inspection).toBe(false)
  })
})
