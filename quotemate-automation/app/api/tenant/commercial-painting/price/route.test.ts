import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaintRateRow, PaintTakeoffItem } from '@/lib/commercial-painting/types'

const { from, tenantFromBearer, loadPaintRates } = vi.hoisted(() => ({
  from: vi.fn(),
  tenantFromBearer: vi.fn(),
  loadPaintRates: vi.fn(),
}))

vi.mock('@/lib/estimation/auth', () => ({
  tenantFromBearer,
  estimatorSupabase: { from },
}))
vi.mock('@/lib/commercial-painting/rates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/commercial-painting/rates')>(
    '@/lib/commercial-painting/rates',
  )
  return { ...actual, loadPaintRates }
})

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

type DbState = {
  extractionItems?: PaintTakeoffItem[]
  book?: { id: string; gst_registered: boolean } | null
  clearError?: { message: string } | null
  extractionUpdates: unknown[]
  runUpdates: unknown[]
}

function chain(result: unknown) {
  const q: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'limit']) q[method] = vi.fn(() => q)
  q.maybeSingle = vi.fn(async () => result)
  q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return q
}

function installDb(state: DbState) {
  from.mockImplementation((table: string) => {
    if (table === 'plan_extractions') {
      const q = chain({
        data: { id: 'ext-1', items: state.extractionItems ?? [ITEM], corrected_items: null },
        error: null,
      }) as Record<string, unknown>
      q.update = vi.fn((payload: unknown) => {
        state.extractionUpdates.push(payload)
        return chain({
          data: state.clearError ? null : { id: 'ext-1', priced_bom: null, priced_at: null },
          error: state.clearError ?? null,
        })
      })
      return q
    }
    if (table === 'pricing_book') return chain({ data: state.book ?? null, error: null })
    if (table === 'paint_runs') {
      const q = chain({ error: null }) as Record<string, unknown>
      q.update = vi.fn((payload: unknown) => {
        state.runUpdates.push(payload)
        return chain({ error: null })
      })
      return q
    }
    throw new Error(`Unexpected table ${table}`)
  })
}

function request() {
  return new Request('http://localhost/api/tenant/commercial-painting/price', {
    method: 'POST',
    body: JSON.stringify({ paintRunId: 'run-1', extractionId: 'ext-1' }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  tenantFromBearer.mockResolvedValue({ id: 'tenant-1', trade: 'commercial_painting' })
  loadPaintRates.mockResolvedValue(TENANT_ROWS)
})

describe('commercial painting price authority route', () => {
  it.each([true, false])('persists valid tenant pricing with gst_registered=%s', async (gst) => {
    const state: DbState = {
      book: { id: 'book-1', gst_registered: gst },
      extractionUpdates: [],
      runUpdates: [],
    }
    installDb(state)

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.gst_registered).toBe(gst)
    expect(body.bom.gstRegistered).toBe(gst)
    if (gst) expect(body.bom.gst).toBeGreaterThan(0)
    else expect(body.bom.gst).toBe(0)
    expect(state.extractionUpdates).toContainEqual(
      expect.objectContaining({ priced_bom: expect.objectContaining({ gstRegistered: gst }) }),
    )
  })

  it('returns inspection_required and never persists a customer-priceable unmatched BOM', async () => {
    const state: DbState = {
      book: { id: 'book-1', gst_registered: true },
      extractionItems: [{ ...ITEM, system: 'textured' as never }],
      extractionUpdates: [],
      runUpdates: [],
    }
    installDb(state)

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body).toMatchObject({ ok: false, error: 'inspection_required' })
    expect(body.bom).toBeUndefined()
    expect(state.extractionUpdates).toContainEqual(expect.objectContaining({ priced_bom: null, priced_at: null }))
    expect(state.extractionUpdates.some((update) => {
      const priced = (update as { priced_bom?: unknown }).priced_bom
      return priced !== null && typeof priced === 'object'
    })).toBe(false)
  })

  it('returns tenant_pricing_required and never persists a seed-priced BOM', async () => {
    loadPaintRates.mockResolvedValue(TENANT_ROWS.map((row) => ({ ...row, is_default: true })))
    const state: DbState = {
      book: { id: 'book-1', gst_registered: true },
      extractionUpdates: [],
      runUpdates: [],
    }
    installDb(state)

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body).toMatchObject({ ok: false, error: 'tenant_pricing_required' })
    expect(body.bom).toBeUndefined()
    expect(state.extractionUpdates).toContainEqual(expect.objectContaining({ priced_bom: null, priced_at: null }))
    expect(state.extractionUpdates.some((update) => {
      const priced = (update as { priced_bom?: unknown }).priced_bom
      return priced !== null && typeof priced === 'object'
    })).toBe(false)
  })

  it('fails closed when stale priced state cannot be cleared', async () => {
    const state: DbState = {
      book: { id: 'book-1', gst_registered: true },
      extractionItems: [{ ...ITEM, system: 'textured' as never }],
      clearError: { message: 'write denied' },
      extractionUpdates: [],
      runUpdates: [],
    }
    installDb(state)

    const response = await POST(request())

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ ok: false, error: 'stale_pricing_clear_failed' })
  })
})
