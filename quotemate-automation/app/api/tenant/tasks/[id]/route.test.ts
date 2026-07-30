// Route-level tests for PATCH/DELETE /api/tenant/tasks/[id] (Phase 3).
//
// The load-bearing rule: a PATCH must never move a step to a different job or
// a different trade. `TenantTaskLinePatchSchema` is the full schema `.partial()`,
// so assembly_id and trade VALIDATE — they are then deliberately dropped when
// the update payload is built. That gap is the thing worth a test: a future
// refactor to `.update(parsed.data)` would silently reintroduce the hole and
// let a tradie relocate a step across the tenant/trade boundary.
//
// Also covers the ownership guard: the update and delete both carry
// .eq('tenant_id', …), so someone else's row id affects zero rows and 404s.

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Row = Record<string, unknown>

const state: {
  user: { id: string } | null
  tenant: Row | null
  updateFields: Row | null
  updateEqs: Array<[string, unknown]>
  updateResult: { data: Row | null; error: Row | null }
  deleteEqs: Array<[string, unknown]>
  deleteResult: { count: number | null; error: Row | null }
} = {
  user: { id: 'user-1' },
  tenant: null,
  updateFields: null,
  updateEqs: [],
  updateResult: { data: null, error: null },
  deleteEqs: [],
  deleteResult: { count: 1, error: null },
}

function buildQueryStub(table: string) {
  if (table === 'tenants') {
    return {
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.tenant, error: null }) }),
      }),
    }
  }
  if (table === 'tenant_assembly_tasks') {
    return {
      update: (fields: Row) => {
        state.updateFields = fields
        const chain = {
          eq: (col: string, val: unknown) => {
            state.updateEqs.push([col, val])
            return chain
          },
          select: () => ({ single: () => Promise.resolve(state.updateResult) }),
        }
        return chain
      },
      delete: (_opts?: unknown) => {
        const chain = {
          eq: (col: string, val: unknown) => {
            state.deleteEqs.push([col, val])
            // The route awaits the second .eq(), so the chain has to be
            // thenable as well as chainable.
            return Object.assign(chain, {
              then: (
                onOk: (v: { count: number | null; error: Row | null }) => unknown,
              ) => Promise.resolve(state.deleteResult).then(onOk),
            })
          },
        }
        return chain
      },
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

const { PATCH, DELETE } = await import('./route')

const TASK_ID = 'b0000000-0000-0000-0000-000000000009'
// Must be a version-4 UUID: TenantTaskLinePatchSchema validates assembly_id
// with Zod's version-aware .uuid(), so a shape-only string is rejected as
// invalid_payload before the immutability logic is ever reached.
const OTHER_ASSEMBLY = 'c0000000-0000-4000-8000-0000000000ff'
const ctx = { params: Promise.resolve({ id: TASK_ID }) }

function patchReq(body: unknown) {
  return new Request(`http://localhost/api/tenant/tasks/${TASK_ID}`, {
    method: 'PATCH',
    headers: { authorization: 'Bearer faketoken', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.user = { id: 'user-1' }
  state.tenant = { id: 'tenant-1' }
  state.updateFields = null
  state.updateEqs = []
  state.updateResult = {
    data: { id: TASK_ID, title: 'Isolate the circuit', sort: 1 },
    error: null,
  }
  state.deleteEqs = []
  state.deleteResult = { count: 1, error: null }
})

describe('PATCH /api/tenant/tasks/[id] — assembly_id and trade are immutable', () => {
  it('ignores assembly_id in the body', async () => {
    const res = await PATCH(
      patchReq({ title: 'Renamed', assembly_id: OTHER_ASSEMBLY }),
      { params: Promise.resolve({ id: TASK_ID }) },
    )
    expect(res.status).toBe(200)
    expect(state.updateFields).toEqual({ title: 'Renamed' })
    expect(state.updateFields).not.toHaveProperty('assembly_id')
  })

  it('ignores trade in the body', async () => {
    await PATCH(patchReq({ title: 'Renamed', trade: 'plumbing' }), {
      params: Promise.resolve({ id: TASK_ID }),
    })
    expect(state.updateFields).toEqual({ title: 'Renamed' })
    expect(state.updateFields).not.toHaveProperty('trade')
  })

  it('400s when assembly_id/trade are the ONLY fields sent — nothing to update', async () => {
    // Not a silent 200: a caller trying to relocate a step gets told the
    // request did nothing, rather than believing it worked.
    const res = await PATCH(
      patchReq({ assembly_id: OTHER_ASSEMBLY, trade: 'plumbing' }),
      { params: Promise.resolve({ id: TASK_ID }) },
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('empty_update')
    expect(state.updateFields).toBeNull()
  })
})

describe('PATCH /api/tenant/tasks/[id] — the editable fields', () => {
  it('passes title, notes, required and sort through', async () => {
    await PATCH(
      patchReq({ title: 'Cut the opening', notes: 'use the jig', required: false, sort: 4 }),
      { params: Promise.resolve({ id: TASK_ID }) },
    )
    expect(state.updateFields).toEqual({
      title: 'Cut the opening',
      notes: 'use the jig',
      required: false,
      sort: 4,
    })
  })

  it('turns an emptied note into NULL rather than an empty string', async () => {
    await PATCH(patchReq({ notes: '   ' }), { params: Promise.resolve({ id: TASK_ID }) })
    expect(state.updateFields).toEqual({ notes: null })
  })

  it('scopes the update to the caller tenant, so a foreign id touches nothing', async () => {
    await PATCH(patchReq({ title: 'Renamed' }), { params: Promise.resolve({ id: TASK_ID }) })
    expect(state.updateEqs).toEqual([
      ['id', TASK_ID],
      ['tenant_id', 'tenant-1'],
    ])
  })

  it('404s when the row is not the callers (PGRST116 no rows)', async () => {
    state.updateResult = { data: null, error: { code: 'PGRST116', message: 'no rows' } }
    const res = await PATCH(patchReq({ title: 'Renamed' }), {
      params: Promise.resolve({ id: TASK_ID }),
    })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })

  it('rejects an empty title instead of storing a blank step', async () => {
    const res = await PATCH(patchReq({ title: '   ' }), {
      params: Promise.resolve({ id: TASK_ID }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_payload')
  })

  it('401s with no tenant', async () => {
    state.tenant = null
    const res = await PATCH(patchReq({ title: 'Renamed' }), {
      params: Promise.resolve({ id: TASK_ID }),
    })
    expect(res.status).toBe(401)
  })

  it('400s on a non-uuid id rather than querying with it', async () => {
    const res = await PATCH(patchReq({ title: 'Renamed' }), {
      params: Promise.resolve({ id: 'nope' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_id')
  })
})

describe('DELETE /api/tenant/tasks/[id]', () => {
  it('scopes the delete to the caller tenant', async () => {
    const res = await DELETE(
      new Request(`http://localhost/api/tenant/tasks/${TASK_ID}`, {
        method: 'DELETE',
        headers: { authorization: 'Bearer faketoken' },
      }),
      ctx,
    )
    expect(res.status).toBe(200)
    expect(state.deleteEqs).toEqual([
      ['id', TASK_ID],
      ['tenant_id', 'tenant-1'],
    ])
  })

  it('404s when the delete matched zero rows', async () => {
    state.deleteResult = { count: 0, error: null }
    const res = await DELETE(
      new Request(`http://localhost/api/tenant/tasks/${TASK_ID}`, {
        method: 'DELETE',
        headers: { authorization: 'Bearer faketoken' },
      }),
      { params: Promise.resolve({ id: TASK_ID }) },
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })
})
