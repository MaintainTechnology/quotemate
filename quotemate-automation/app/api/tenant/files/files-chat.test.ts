// Tests for POST /api/tenant/files/chat (spec 2026-06-19, Phase 2): the store id
// is resolved server-side and never leaked; citations resolve to a download id;
// 401/empty-query/no-docs paths behave.

import { describe, it, expect, vi, beforeEach } from 'vitest'

let getUserImpl = vi.fn()
let tenantRow: Record<string, unknown> | null = { id: 'tenant-A', business_name: 'Biz', file_store_id: 'store-A' }
let tfdRows: Array<Record<string, unknown>> = []
let searchImpl = vi.fn()
let ensureImpl = vi.fn()

function tenantsChain() {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: tenantRow, error: null }),
    update: () => chain,
    then: (r: (v: unknown) => unknown) => r({ data: null, error: null }),
  }
  return chain
}
function tfdChain() {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    then: (r: (v: unknown) => unknown) => r({ data: tfdRows, error: null }),
  }
  return chain
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: (t: string) => getUserImpl(t) },
    from: (table: string) => (table === 'tenants' ? tenantsChain() : tfdChain()),
  }),
}))
vi.mock('@/lib/filestore/tenant-store', () => ({
  searchTenantStore: (a: unknown) => searchImpl(a),
  ensureTenantStore: (...a: unknown[]) => ensureImpl(...a),
}))

async function getPost() {
  return (await import('./chat/route')).POST
}
function req(body: unknown, headers: Record<string, string> = { authorization: 'Bearer tok', 'content-type': 'application/json' }) {
  return new Request('http://localhost/api/tenant/files/chat', { method: 'POST', headers, body: JSON.stringify(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
  getUserImpl = vi.fn().mockResolvedValue({ data: { user: { id: 'user-A' } }, error: null })
  tenantRow = { id: 'tenant-A', business_name: 'Biz', file_store_id: 'store-A' }
  tfdRows = []
  searchImpl = vi.fn()
  ensureImpl = vi.fn()
})

describe('POST /api/tenant/files/chat', () => {
  it('401 without a bearer token', async () => {
    getUserImpl = vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'no' } })
    const POST = await getPost()
    const res = await POST(req({ query: 'hi' }, { 'content-type': 'application/json' }))
    expect(res.status).toBe(401)
  })

  it('400 on an empty query', async () => {
    const POST = await getPost()
    const res = await POST(req({ query: '   ' }))
    expect(res.status).toBe(400)
  })

  it('returns "no documents" when the tenant has no store and none can be created', async () => {
    tenantRow = { id: 'tenant-A', business_name: 'Biz', file_store_id: null }
    ensureImpl = vi.fn().mockResolvedValue(null)
    const POST = await getPost()
    const res = await POST(req({ query: 'downlights?' }))
    const body = await res.json()
    expect(body.answer).toMatch(/No documents indexed/i)
    expect(body.citations).toEqual([])
  })

  it('resolves citation documentId by display_name and never leaks the store id', async () => {
    searchImpl = vi.fn().mockResolvedValue({
      answer: 'You quoted $1,100 for downlights.',
      passages: [{ documentTitle: 'quote-electrical-q1.md', text: 'downlights' }],
    })
    tfdRows = [{ id: 'doc-row-1', display_name: 'quote-electrical-q1' }]
    const POST = await getPost()
    const res = await POST(req({ query: 'downlights?' }))
    const body = await res.json()
    expect(body.citations[0].documentId).toBe('doc-row-1')
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('store-A') // the store id is never returned
    expect(raw).not.toContain('file_store_id')
  })
})
