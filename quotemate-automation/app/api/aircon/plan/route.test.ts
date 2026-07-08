// POST /api/aircon/plan — the floor-plan branch of the AC recommender.
// Code-review follow-up to spec quotes-tab-sync T3: this route produces the
// same AcRecommendation as /api/aircon/recommend, so a tenant-linked run must
// persist the same aircon_recommendations row (best-effort) — otherwise
// plan-based jobs never reach the Quotes tab or get a /q/aircon share page.
//
// The vision extraction (Claude) and Google location evidence are mocked;
// scale resolution, sizing, layout design and pricing run for real.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  type Op = { op: string; args: unknown[] }
  const results: Result[] = []
  const queries: { table: string; ops: Op[] }[] = []

  function from(table: string) {
    const record = { table, ops: [] as Op[] }
    const builder: Record<string, unknown> = {}
    for (const op of ['select', 'insert', 'eq', 'limit', 'maybeSingle', 'single']) {
      builder[op] = (...args: unknown[]) => {
        record.ops.push({ op, args })
        return builder
      }
    }
    builder.then = (
      resolve: (r: Result) => unknown,
      reject?: (e: unknown) => unknown,
    ) => {
      queries.push(record)
      const r = results.shift() ?? { data: null, error: null }
      return Promise.resolve(r).then(resolve, reject)
    }
    return builder
  }

  return { results, queries, client: { from } }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('@/lib/tenant/from-request', () => ({ resolveTenantRequest: vi.fn() }))
vi.mock('@/lib/aircon/location', () => ({
  resolveAcLocationEvidence: vi.fn(async () => ({ building: { ok: false } })),
}))
vi.mock('@/lib/aircon/plan-extract', () => ({
  PLAN_MEDIA_TYPES: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
  // Mirrors the real map — lib/aircon/plan-scale.ts imports it from this module.
  LOAD_TYPE_BY_ROOM: { bedroom: 'bedroom', study: 'bedroom', living: 'living', kitchen: 'living' },
  runPlanExtraction: vi.fn(async () => ({
    model: 'mock-model',
    runtimeSeconds: 1,
    raw: '',
    parsed: {
      page: 1,
      rooms: [
        {
          name: 'Bed 1',
          room_type: 'bedroom',
          polygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
          area_m2: 12,
          confidence: 'high',
        },
        {
          name: 'Living',
          room_type: 'living',
          polygon: [
            { x: 20, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 20 },
          ],
          area_m2: 32,
          confidence: 'high',
        },
      ],
      stated_total_area_m2: null,
      overall_note: '',
    },
  })),
}))

import { POST } from './route'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

beforeEach(() => {
  h.results.length = 0
  h.queries.length = 0
  vi.mocked(resolveTenantRequest).mockReset()
})

const OWNER_UUID = 'b0000000-0000-4000-8000-000000000001'

function planRequest() {
  const fd = new FormData()
  fd.append('plan', new File([new Uint8Array([1, 2, 3])], 'plan.pdf', { type: 'application/pdf' }))
  fd.append(
    'address',
    JSON.stringify({ address: '12 Example St, Sydney', postcode: '2000', state: 'NSW' }),
  )
  fd.append(
    'inputs',
    JSON.stringify({
      bedrooms: 1,
      bathrooms: 1,
      living_spaces: 1,
      storeys: 1,
      ceiling_height: 'standard',
      insulation: 'average',
      current_situation: 'replacing',
    }),
  )
  return new Request('http://localhost/api/aircon/plan', {
    method: 'POST',
    headers: { authorization: 'Bearer token-1' },
    body: fd,
  })
}

describe('POST /api/aircon/plan', () => {
  it('persists an aircon_recommendations row for a tenant-linked caller', async () => {
    vi.mocked(resolveTenantRequest).mockResolvedValue({
      identity: { provider: 'clerk', userId: 'user_2abc', email: null },
      tenant: { id: 'tenant-1', trade: 'electrical', owner_user_id: OWNER_UUID },
    } as never)
    h.results.push(
      { data: null, error: null }, // pricing_book overlay read
      { data: { id: 'rec-7' }, error: null }, // aircon_recommendations insert
    )
    const res = await POST(planRequest())
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      ok: boolean
      recommendation: unknown
      saved: { id: string; public_token: string } | null
    }
    expect(json.ok).toBe(true)
    expect(json.saved?.id).toBe('rec-7')
    expect(typeof json.saved?.public_token).toBe('string')

    const insert = h.queries.find(
      (q) => q.table === 'aircon_recommendations' && q.ops.some((o) => o.op === 'insert'),
    )
    expect(insert, 'expected an aircon_recommendations insert').toBeTruthy()
    const payload = insert!.ops.find((o) => o.op === 'insert')!.args[0] as Record<string, unknown>
    expect(payload.tenant_id).toBe('tenant-1')
    expect(payload.created_by).toBe(OWNER_UUID)
    expect(payload.routing).toBe('book_assessment')
  })

  it('a tenant-less caller still gets the recommendation with saved: null', async () => {
    vi.mocked(resolveTenantRequest).mockResolvedValue({
      identity: { provider: 'supabase', userId: 'c0000000-0000-4000-8000-000000000002', email: null },
      tenant: null,
    } as never)
    const res = await POST(planRequest())
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; saved: unknown }
    expect(json.ok).toBe(true)
    expect(json.saved).toBeNull()
    expect(h.queries.some((q) => q.table === 'aircon_recommendations')).toBe(false)
  })
})
