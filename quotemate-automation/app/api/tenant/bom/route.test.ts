import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  resolveTenantRequest: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/tenant/from-request', () => ({ resolveTenantRequest: mocks.resolveTenantRequest }))

import { GET } from './route'

type Row = Record<string, unknown>

function installTables(tables: Record<string, Row[]>) {
  mocks.from.mockImplementation((table: string) => {
    let rows = [...(tables[table] ?? [])]
    const q: Record<string, unknown> = {}
    q.select = vi.fn(() => q)
    q.eq = vi.fn((column: string, value: unknown) => {
      rows = rows.filter((row) => row[column] === value)
      return q
    })
    q.in = vi.fn((column: string, values: unknown[]) => {
      rows = rows.filter((row) => values.includes(row[column]))
      return q
    })
    q.order = vi.fn(() => q)
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve)
    return q
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveTenantRequest.mockResolvedValue({
    identity: { provider: 'clerk', userId: 'user-1' },
    tenant: { id: 'tenant-1', trade: 'electrical', trades: ['electrical', 'plumbing'] },
  })
})

describe('GET /api/tenant/bom catalogue price readiness', () => {
  it('returns active finite tenant-priced categories keyed by trade', async () => {
    installTables({
      shared_assemblies: [
        { id: 'e-1', name: 'Downlights', trade: 'electrical' },
        { id: 'p-1', name: 'Tap', trade: 'plumbing' },
      ],
      tenant_assembly_bom: [],
      shared_assembly_bom: [],
      tenant_material_catalogue: [
        { tenant_id: 'tenant-1', trade: 'electrical', category: 'downlight', active: true, unit_price_ex_gst: 22 },
        { tenant_id: 'tenant-1', trade: 'electrical', category: 'cable', active: true, unit_price_ex_gst: null },
        { tenant_id: 'tenant-1', trade: 'electrical', category: 'switch', active: true, unit_price_ex_gst: 'NaN' },
        { tenant_id: 'tenant-1', trade: 'electrical', category: 'inactive', active: false, unit_price_ex_gst: 10 },
        { tenant_id: 'tenant-1', trade: 'plumbing', category: 'downlight', active: true, unit_price_ex_gst: 45 },
      ],
    })

    const response = await GET(new Request('http://localhost/api/tenant/bom'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.catalogue_categories_by_trade).toEqual({
      electrical: ['downlight'],
      plumbing: ['downlight'],
    })
    expect(body.catalogue_categories).toBeUndefined()
  })
})
