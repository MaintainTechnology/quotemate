// Integration tests for the P2 file endpoints (spec 2026-06-19, Phase 2 DoD):
// two-tenant isolation + no store/doc-id leakage. Mocks supabase.auth.getUser +
// the tenant lookup the same way the route resolves the authenticated tenant.

import { describe, it, expect, vi, beforeEach } from 'vitest'

let getUserImpl = vi.fn()
let tenantsRow: { id: string } | null = { id: 'tenant-A' }
let fileDocRow: Record<string, unknown> | null = null
let fileDocList: Array<Record<string, unknown>> = []
let lastSelectCols = ''

function buildFrom(table: string) {
  if (table === 'tenants') {
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tenantsRow, error: null }) }) }) }
  }
  // tenant_file_documents — supports both download (.eq(id).maybeSingle())
  // and list (.eq(tenant_id).order() then awaited).
  const chain: Record<string, unknown> = {
    select: (cols: string) => {
      lastSelectCols = cols
      return chain
    },
    eq: () => chain,
    order: () => chain,
    maybeSingle: async () => ({ data: fileDocRow, error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: fileDocList, error: null }),
  }
  return chain
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: (t: string) => getUserImpl(t) },
    from: (table: string) => buildFrom(table),
  }),
}))

vi.mock('@/lib/quote/pdf', () => ({
  downloadQuotePdf: vi.fn(async () => Buffer.from('FULL-PDF-BYTES')),
}))

const UUID = '11111111-1111-1111-1111-111111111111'

function req(headers: Record<string, string> = { authorization: 'Bearer tok' }) {
  return new Request('http://localhost/api/tenant/files', { headers })
}

async function getDownload() {
  return (await import('./[id]/download/route')).GET
}
async function getList() {
  return (await import('./route')).GET
}

beforeEach(() => {
  vi.clearAllMocks()
  getUserImpl = vi.fn().mockResolvedValue({ data: { user: { id: 'user-A' } }, error: null })
  tenantsRow = { id: 'tenant-A' }
  fileDocRow = null
  fileDocList = []
  lastSelectCols = ''
})

describe('GET /api/tenant/files/[id]/download — isolation', () => {
  it('401 without a bearer token', async () => {
    const GET = await getDownload()
    const res = await GET(req({}), { params: Promise.resolve({ id: UUID }) })
    expect(res.status).toBe(401)
  })

  it("404 (not 403) for another tenant's document — no existence leak", async () => {
    fileDocRow = { id: UUID, tenant_id: 'tenant-B', source_kind: 'quote', storage_path: 'quotes/x.pdf' }
    const GET = await getDownload()
    const res = await GET(req(), { params: Promise.resolve({ id: UUID }) })
    expect(res.status).toBe(404)
  })

  it('streams the full doc from Supabase for the owner', async () => {
    fileDocRow = { id: UUID, tenant_id: 'tenant-A', source_kind: 'quote', display_name: 'quote-electrical-x', storage_path: 'quotes/x.pdf' }
    const GET = await getDownload()
    const res = await GET(req(), { params: Promise.resolve({ id: UUID }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    const { downloadQuotePdf } = await import('@/lib/quote/pdf')
    expect(downloadQuotePdf).toHaveBeenCalledWith('quotes/x.pdf')
  })
})

describe('GET /api/tenant/files — no id leakage', () => {
  it('selects a safe projection (never storage_path / kb_document_id / file_store_id)', async () => {
    fileDocList = [{ id: 'd1', display_name: 'quote-electrical-x', source_kind: 'quote', trade: 'electrical', state: 'active', created_at: 't', bytes: 10 }]
    const GET = await getList()
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    // The route's SELECT must not request the sensitive columns…
    expect(lastSelectCols).not.toContain('storage_path')
    expect(lastSelectCols).not.toContain('kb_document_id')
    expect(lastSelectCols).not.toContain('file_store_id')
    // …and none appear in the serialized response.
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('storage_path')
    expect(raw).not.toContain('kb_document_id')
    expect(raw).not.toContain('file_store_id')
  })

  it('401 without a bearer token', async () => {
    getUserImpl = vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'bad' } })
    const GET = await getList()
    const res = await GET(req({}))
    expect(res.status).toBe(401)
  })
})
