import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: vi.fn(), from: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/admin-loader/route-auth', () => ({ resolveAdminUserId: mocks.admin }))
import { GET } from './route'

// The quote evals the admin agents pages list, and a run of the plan
// takeoff's nightly eval, which records into the same table.
const RUNS = [
  { id: 'takeoff-1', catalogue_version: 'roof-takeoff', started_at: '2026-11-07T16:00:00.000Z' },
  { id: 'quote-1', catalogue_version: 'v3', started_at: '2026-11-01T00:00:00.000Z' },
]

/** A query on one table: each filter narrows its rows, and awaiting it reads them. */
function table(name: string) {
  let rows: Array<Record<string, unknown>> = name === 'eval_runs' ? RUNS : []
  const builder = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    eq: (column: string, value: unknown) => { rows = rows.filter((row) => row[column] === value); return builder },
    neq: (column: string, value: unknown) => { rows = rows.filter((row) => row[column] !== value); return builder },
    then: (resolve: (result: unknown) => unknown) => resolve({ data: rows, count: 0, error: null }),
  }
  return builder
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.from.mockImplementation(table)
  mocks.admin.mockResolvedValue('admin-a')
})

describe('GET /api/admin/agents/queue', () => {
  it("lists the quote evals, leaving out the plan takeoff's nightly runs, which would push them off", async () => {
    const res = await GET(new Request('https://example.test/api/admin/agents/queue'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { eval_runs: Array<{ id: string }> }
    expect(body.eval_runs.map((run) => run.id)).toEqual(['quote-1'])
  })
})
