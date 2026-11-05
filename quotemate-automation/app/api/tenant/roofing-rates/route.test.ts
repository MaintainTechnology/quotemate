// The roofing rates route's new-work rates (TKO-22, DEC-026): read beside the
// card, saved in the same request as the card, and left alone by a save that
// doesn't carry them.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  resolveTenantRequest: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/tenant/from-request', () => ({ resolveTenantRequest: mocks.resolveTenantRequest }))

import { GET, PATCH } from './route'

const CARD = { reroof_rate_per_m2: { colorbond_corrugated: 95 }, upgrade_material: 'colorbond_kliplok' }

/** One pricing book for the tenant's primary trade, with these overlays. */
function installBook(overlays: Record<string, unknown>) {
  mocks.from.mockImplementation(() => {
    const q: Record<string, unknown> = {}
    q.select = vi.fn(() => q)
    q.eq = vi.fn(() => q)
    q.limit = vi.fn(() => q)
    q.maybeSingle = vi.fn(async () => ({ data: { id: 'PB1', overlays }, error: null }))
    q.update = vi.fn((patch: Record<string, unknown>) => {
      mocks.updates.push(patch)
      return { eq: vi.fn(async () => ({ error: null })) }
    })
    return q
  })
}

const patch = (body: unknown) =>
  PATCH(new Request('http://localhost/api/tenant/roofing-rates', { method: 'PATCH', body: JSON.stringify(body) }))
const saved = () => mocks.updates.at(-1)?.overlays as Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updates.length = 0
  mocks.resolveTenantRequest.mockResolvedValue({
    identity: { provider: 'clerk', userId: 'user-1' },
    tenant: { id: 'tenant-1', trade: 'plumbing', trades: ['plumbing', 'roofing'] },
  })
})

describe('GET /api/tenant/roofing-rates new-work rates', () => {
  it('returns the stored new-work rates and the materials a new roof can be', async () => {
    installBook({ roofing_rate_card: CARD, roofing_new_work_rates: { rate_per_m2: { colorbond_corrugated: 62, cement_sheet: 40 } } })
    const json = await (await GET(new Request('http://localhost/api/tenant/roofing-rates'))).json()
    expect(json.overrides.new_work_rate_per_m2).toEqual({ colorbond_corrugated: 62 })
    expect(json.new_work_materials).toContain('colorbond_kliplok')
    expect(json.new_work_materials).not.toContain('cement_sheet')
  })
})

describe('PATCH /api/tenant/roofing-rates new-work rates', () => {
  it('saves them beside the card, keeping every other overlay', async () => {
    installBook({ early_bird: { pct: 5 }, roofing_rate_card: CARD })
    const res = await patch({ ...CARD, new_work_rate_per_m2: { colorbond_corrugated: '62', colorbond_kliplok: 84, concrete_tile: '' } })
    expect(res.status).toBe(200)
    expect(saved()).toMatchObject({
      early_bird: { pct: 5 },
      roofing_rate_card: { reroof_rate_per_m2: { colorbond_corrugated: 95 } },
      roofing_new_work_rates: { rate_per_m2: { colorbond_corrugated: 62, colorbond_kliplok: 84 } },
    })
    expect((await res.json()).new_work_rate_per_m2).toEqual({ colorbond_corrugated: 62, colorbond_kliplok: 84 })
  })

  it('leaves the stored rates as they are when the save does not carry them', async () => {
    const stored = { rate_per_m2: { colorbond_corrugated: 62 } }
    installBook({ roofing_rate_card: CARD, roofing_new_work_rates: stored })
    expect((await patch(CARD)).status).toBe(200)
    expect(saved().roofing_new_work_rates).toEqual(stored)
  })

  it('removes them when every one is cleared, so builder quotes refuse until they are set', async () => {
    installBook({ roofing_rate_card: CARD, roofing_new_work_rates: { rate_per_m2: { colorbond_corrugated: 62 } } })
    expect((await patch({ ...CARD, new_work_rate_per_m2: { colorbond_corrugated: '' } })).status).toBe(200)
    expect(saved()).not.toHaveProperty('roofing_new_work_rates')
  })

  it('refuses a rate out of range, field by field, and writes nothing', async () => {
    installBook({ roofing_rate_card: CARD })
    const res = await patch({ ...CARD, new_work_rate_per_m2: { colorbond_trimdek: 0 } })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'validation_failed', issues: [{ field: 'new_work_rate_per_m2.colorbond_trimdek' }] })
    expect(mocks.updates).toHaveLength(0)
  })
})
