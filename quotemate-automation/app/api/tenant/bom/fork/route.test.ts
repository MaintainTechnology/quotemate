// Route-level tests for POST /api/tenant/bom/fork (R33).
//
// Focus: the fork must still create the tenant_assembly_bom rows AND
// surface which forked lines reference a material_category the tenant has
// NO active catalogue product for — instead of silently letting those
// lines fall back to a generic price in the estimator.
//
// Pattern (mirrors lib/solar/estimate-route.test.ts): mock
// @supabase/supabase-js BEFORE importing the route, because the route's
// module-level `const supabase = createClient(...)` runs at import time.
// The catalogue helper (lib/estimate/catalogue.ts) is pure (no DB) so it
// is NOT mocked — normaliseCategory runs for real, proving the canonical
// category comparison is the one used by the estimator.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mutable per-test fixtures the supabase stub reads ──────────────────
type Row = Record<string, unknown>

const state: {
  user: { id: string } | null
  tenant: Row | null
  assembly: Row | null
  existingForkCount: number
  baseline: Row[]
  catalogue: Row[]
  catalogueError: { message: string } | null
  insertError: { message: string } | null
  lastInsertedRows: Row[]
} = {
  user: { id: 'user-1' },
  tenant: { id: 'tenant-1', trade: 'electrical', trades: ['electrical'] },
  assembly: { id: 'a0000000-0000-0000-0000-000000000001', trade: 'electrical' },
  existingForkCount: 0,
  baseline: [],
  catalogue: [],
  catalogueError: null,
  insertError: null,
  lastInsertedRows: [],
}

// Build the chainable query stub per table. Each table only needs the
// subset of the supabase-js builder the route actually calls.
function buildQueryStub(table: string) {
  if (table === 'tenants') {
    return {
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.tenant, error: null }) }),
      }),
    }
  }
  if (table === 'shared_assemblies') {
    return {
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.assembly, error: null }) }),
      }),
    }
  }
  if (table === 'tenant_assembly_bom') {
    return {
      // count (head:true) guard for "already customised"
      select: (_cols?: unknown, _opts?: unknown) => ({
        eq: () => ({
          eq: () => Promise.resolve({ count: state.existingForkCount, error: null }),
        }),
      }),
      insert: (rows: Row[]) => {
        state.lastInsertedRows = rows.map((r, i) => ({ ...r, id: `bom-${i}` }))
        return {
          select: () =>
            Promise.resolve({
              data: state.insertError ? null : state.lastInsertedRows,
              error: state.insertError,
            }),
        }
      },
    }
  }
  if (table === 'shared_assembly_bom') {
    return {
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: state.baseline, error: null }),
        }),
      }),
    }
  }
  if (table === 'tenant_material_catalogue') {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            // route appends a third .eq('trade', ...)
            eq: () =>
              Promise.resolve({
                data: state.catalogueError ? null : state.catalogue,
                error: state.catalogueError,
              }),
          }),
        }),
      }),
    }
  }
  throw new Error(`unexpected table in test stub: ${table}`)
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: state.user }, error: null }) },
    from: (table: string) => buildQueryStub(table),
  }),
}))

// Import AFTER the mock is registered.
const { POST } = await import('./route')

function req(body: unknown) {
  return new Request('http://localhost/api/tenant/bom/fork', {
    method: 'POST',
    headers: { authorization: 'Bearer faketoken', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ASSEMBLY_ID = 'a0000000-0000-0000-0000-000000000001'

beforeEach(() => {
  state.user = { id: 'user-1' }
  state.tenant = { id: 'tenant-1', trade: 'electrical', trades: ['electrical'] }
  state.assembly = { id: ASSEMBLY_ID, trade: 'electrical' }
  state.existingForkCount = 0
  state.baseline = [
    { material_category: 'gpo', description: 'Double GPO', quantity: 1, required: true, sort: 0 },
    { material_category: 'cable', description: 'TPS cable', quantity: 5, required: true, sort: 1 },
    { material_category: 'mounting_block', description: 'Block', quantity: 1, required: false, sort: 2 },
  ]
  state.catalogue = []
  state.catalogueError = null
  state.insertError = null
  state.lastInsertedRows = []
})

describe('POST /api/tenant/bom/fork — R33 category-gap surfacing', () => {
  it('still creates the forked rows (fork keeps working)', async () => {
    state.catalogue = [{ category: 'gpo' }, { category: 'cable' }, { category: 'mounting_block' }]
    const res = await POST(req({ assembly_id: ASSEMBLY_ID }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.forked).toBe(3)
    expect(state.lastInsertedRows).toHaveLength(3)
  })

  it('reports NO gaps when every forked line category has an active catalogue product', async () => {
    state.catalogue = [{ category: 'gpo' }, { category: 'cable' }, { category: 'mounting_block' }]
    const res = await POST(req({ assembly_id: ASSEMBLY_ID }))
    const json = await res.json()
    expect(json.has_category_gaps).toBe(false)
    expect(json.category_gaps).toEqual([])
    expect(json.gap_detection_failed).toBe(false)
  })

  it('SURFACES forked lines whose category has no tenant catalogue product', async () => {
    // Tenant stocks only "gpo" — "cable" and "mounting_block" are gaps.
    state.catalogue = [{ category: 'gpo' }]
    const res = await POST(req({ assembly_id: ASSEMBLY_ID }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.forked).toBe(3) // rows STILL created
    expect(json.has_category_gaps).toBe(true)
    // 1-based line positions, in sort order; gpo (line 1) is covered.
    expect(json.category_gaps).toEqual([
      { material_category: 'cable', line: 2 },
      { material_category: 'mounting_block', line: 3 },
    ])
  })

  it('matches categories case/whitespace-insensitively (canonical normaliseCategory)', async () => {
    // Catalogue category differs only by case + surrounding whitespace —
    // must NOT be reported as a gap (same comparison the estimator uses).
    state.baseline = [
      { material_category: 'GPO', description: 'Double GPO', quantity: 1, required: true, sort: 0 },
    ]
    state.catalogue = [{ category: '  gpo  ' }]
    const res = await POST(req({ assembly_id: ASSEMBLY_ID }))
    const json = await res.json()
    expect(json.has_category_gaps).toBe(false)
    expect(json.category_gaps).toEqual([])
  })

  it('reports ALL lines as gaps when the tenant has an empty catalogue', async () => {
    state.catalogue = []
    const res = await POST(req({ assembly_id: ASSEMBLY_ID }))
    const json = await res.json()
    expect(json.has_category_gaps).toBe(true)
    expect(json.category_gaps.map((g: { material_category: string }) => g.material_category)).toEqual([
      'gpo',
      'cable',
      'mounting_block',
    ])
    expect(json.forked).toBe(3) // fork still succeeds
  })

  it('degrades (no gaps, flag set) when the catalogue read errors — never blocks the fork', async () => {
    state.catalogueError = { message: 'boom' }
    const res = await POST(req({ assembly_id: ASSEMBLY_ID }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.forked).toBe(3) // fork STILL works
    expect(json.has_category_gaps).toBe(false)
    expect(json.category_gaps).toEqual([])
    expect(json.gap_detection_failed).toBe(true)
  })

  it('still no-ops with 409 when the tenant already customised this assembly', async () => {
    state.existingForkCount = 2
    const res = await POST(req({ assembly_id: ASSEMBLY_ID }))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('already_customised')
  })

  it('rejects an assembly whose trade the tenant does not run', async () => {
    state.assembly = { id: ASSEMBLY_ID, trade: 'plumbing' }
    const res = await POST(req({ assembly_id: ASSEMBLY_ID }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('assembly_trade_mismatch')
  })
})
