// Route-level tests for POST /api/tenant/tasks/fork (Phase 3).
//
// The fork's whole job is to be safe: it must copy the shared checklist once,
// refuse to run a second time over a checklist the tradie has since edited
// (409 already_customised), and say so plainly when there is no baseline to
// copy (404 no_baseline). Both are contract, not cosmetics — the UI hides the
// button in the first case, but this guard is the source of truth.
//
// Pattern mirrors app/api/tenant/bom/fork/route.test.ts: mock
// @supabase/supabase-js BEFORE importing the route, because the route's
// module-level `const supabase = createClient(...)` runs at import time.
//
// Deliberately NOT tested: catalogue gaps. A task has no material_category, so
// the R33/R38 apparatus does not exist on this route.

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Row = Record<string, unknown>

const state: {
  user: { id: string } | null
  tenant: Row | null
  assembly: Row | null
  existingCount: number
  countError: { message: string } | null
  baseline: Row[]
  baselineError: { message: string } | null
  insertError: { message: string } | null
  lastInsertedRows: Row[]
} = {
  user: { id: 'user-1' },
  tenant: null,
  assembly: null,
  existingCount: 0,
  countError: null,
  baseline: [],
  baselineError: null,
  insertError: null,
  lastInsertedRows: [],
}

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
  if (table === 'tenant_assembly_tasks') {
    return {
      // head-count guard for "already customised"
      select: (_cols?: unknown, _opts?: unknown) => ({
        eq: () => ({
          eq: () => Promise.resolve({ count: state.existingCount, error: state.countError }),
        }),
      }),
      insert: (rows: Row[]) => {
        state.lastInsertedRows = rows.map((r, i) => ({ ...r, id: `task-${i}` }))
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
  if (table === 'shared_assembly_tasks') {
    return {
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              data: state.baselineError ? null : state.baseline,
              error: state.baselineError,
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

const { POST } = await import('./route')

const ASSEMBLY_ID = 'a0000000-0000-0000-0000-000000000001'

function req(body: unknown) {
  return new Request('http://localhost/api/tenant/tasks/fork', {
    method: 'POST',
    headers: { authorization: 'Bearer faketoken', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.user = { id: 'user-1' }
  state.tenant = { id: 'tenant-1', trade: 'electrical', trades: ['electrical'] }
  state.assembly = { id: ASSEMBLY_ID, trade: 'electrical' }
  state.existingCount = 0
  state.countError = null
  state.baseline = [
    { title: 'Isolate the circuit', notes: 'test and tag', required: true, sort: 1 },
    { title: 'Cut the opening', notes: null, required: true, sort: 2 },
    { title: 'Make good the ceiling', notes: null, required: false, sort: 3 },
  ]
  state.baselineError = null
  state.insertError = null
  state.lastInsertedRows = []
})

describe('POST /api/tenant/tasks/fork — the happy path', () => {
  it('copies the baseline into tenant rows, in order', async () => {
    const res = await POST(req({ assembly_id: ASSEMBLY_ID }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.forked).toBe(3)
    expect(state.lastInsertedRows.map((r) => r.title)).toEqual([
      'Isolate the circuit',
      'Cut the opening',
      'Make good the ceiling',
    ])
  })

  it('stamps every copied row with the tenant and the assembly trade', async () => {
    await POST(req({ assembly_id: ASSEMBLY_ID }))
    for (const r of state.lastInsertedRows) {
      expect(r.tenant_id).toBe('tenant-1')
      expect(r.assembly_id).toBe(ASSEMBLY_ID)
      expect(r.trade).toBe('electrical')
    }
  })

  it('preserves required/optional and the sort order rather than flattening them', async () => {
    await POST(req({ assembly_id: ASSEMBLY_ID }))
    expect(state.lastInsertedRows.map((r) => r.required)).toEqual([true, true, false])
    expect(state.lastInsertedRows.map((r) => r.sort)).toEqual([1, 2, 3])
  })

  it('carries a null note across as null, not the string "null"', async () => {
    await POST(req({ assembly_id: ASSEMBLY_ID }))
    expect(state.lastInsertedRows[0].notes).toBe('test and tag')
    expect(state.lastInsertedRows[1].notes).toBeNull()
  })
})

describe('POST /api/tenant/tasks/fork — 409 already_customised', () => {
  it('refuses when the tenant already has steps for this job', async () => {
    state.existingCount = 4
    const res = await POST(req({ assembly_id: ASSEMBLY_ID }))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('already_customised')
  })

  it('inserts NOTHING on that refusal — a tradie edit is never merged over', async () => {
    state.existingCount = 1
    await POST(req({ assembly_id: ASSEMBLY_ID }))
    expect(state.lastInsertedRows).toEqual([])
  })

  it('carries a message the UI can show as-is', async () => {
    state.existingCount = 1
    const json = await (await POST(req({ assembly_id: ASSEMBLY_ID }))).json()
    expect(typeof json.message).toBe('string')
    expect(json.message.length).toBeGreaterThan(0)
  })
})

describe('POST /api/tenant/tasks/fork — 404 no_baseline', () => {
  it('404s when the shared table has no steps for this job', async () => {
    state.baseline = []
    const res = await POST(req({ assembly_id: ASSEMBLY_ID }))
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('no_baseline')
  })

  it('tells the tradie to add steps manually instead of failing silently', async () => {
    state.baseline = []
    const json = await (await POST(req({ assembly_id: ASSEMBLY_ID }))).json()
    expect(json.message).toMatch(/manually/i)
  })

  it('inserts nothing when there is no baseline', async () => {
    state.baseline = []
    await POST(req({ assembly_id: ASSEMBLY_ID }))
    expect(state.lastInsertedRows).toEqual([])
  })
})

describe('POST /api/tenant/tasks/fork — guards', () => {
  it('401s with no tenant', async () => {
    state.tenant = null
    const res = await POST(req({ assembly_id: ASSEMBLY_ID }))
    expect(res.status).toBe(401)
  })

  it('400s on a non-uuid assembly_id rather than querying with it', async () => {
    const res = await POST(req({ assembly_id: 'nope' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_assembly_id')
  })

  it('400s on invalid JSON', async () => {
    const res = await POST(
      new Request('http://localhost/api/tenant/tasks/fork', {
        method: 'POST',
        headers: { authorization: 'Bearer faketoken', 'content-type': 'application/json' },
        body: '{not json',
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_json')
  })

  it('refuses an assembly whose trade the tenant does not run', async () => {
    state.assembly = { id: ASSEMBLY_ID, trade: 'plumbing' }
    const res = await POST(req({ assembly_id: ASSEMBLY_ID }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('assembly_trade_mismatch')
  })

  it('400s on a trade the tables cannot store, even when the tenant runs it', async () => {
    // The fork inserts asm.trade RAW — no TRADE_ENUM in this path. A roofing
    // tenant with a roofing baseline would otherwise reach the table CHECK and
    // 500. RECIPE_TRADES is the guard.
    state.tenant = { id: 'tenant-1', trade: 'roofing', trades: ['roofing', 'electrical'] }
    state.assembly = { id: ASSEMBLY_ID, trade: 'roofing' }
    const res = await POST(req({ assembly_id: ASSEMBLY_ID }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('assembly_trade_mismatch')
    expect(json.allowed).toEqual(['electrical', 'plumbing'])
    expect(state.lastInsertedRows).toEqual([])
  })

  it('500s rather than double-forking when the head count cannot be read', async () => {
    // A failed count must not be treated as "zero existing steps" — that
    // would let a second fork duplicate the whole checklist.
    state.countError = { message: 'boom' }
    const res = await POST(req({ assembly_id: ASSEMBLY_ID }))
    expect(res.status).toBe(500)
    expect(state.lastInsertedRows).toEqual([])
  })
})
