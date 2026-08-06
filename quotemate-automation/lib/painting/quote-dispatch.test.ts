// Spec painting-auto-send R1 — the shared non-dashboard save path releases a
// PRICED painting quote at save time (both origins route through here), and
// leaves an inspection-routed one held exactly as before.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PaintingEstimate } from './types'

const h = vi.hoisted(() => ({
  estimatePainting: vi.fn(),
}))

vi.mock('./measure', () => ({ estimatePainting: h.estimatePainting }))

import { runAndSavePaintingQuote } from './quote-dispatch'

function estimateFixture(decision: 'auto_quote' | 'inspection_required'): PaintingEstimate {
  return {
    provider: 'google_solar',
    measurement: { floor_area_m2: 180 },
    price: {
      total_area_m2: 320,
      confidence: 'medium',
      routing: { decision, reason: 'because' },
      tiers: [
        { tier: 'good', inc_gst: 9000 },
        { tier: 'better', inc_gst: 12000 },
        { tier: 'best', inc_gst: 15000 },
      ],
    },
  } as unknown as PaintingEstimate
}

/** Minimal Supabase double: captures the painting_measurements insert row. */
function clientCapturing(inserted: Record<string, unknown>[]) {
  return {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row)
        return {
          select: () => ({
            single: async () => ({
              data: { public_token: 'pub-1', estimate_token: 'est-1' },
              error: null,
            }),
          }),
        }
      },
    }),
  } as unknown as SupabaseClient
}

const request = {
  address: { address: '5 Smith St', postcode: '2000', state: 'NSW' },
  inputs: {
    scopes: ['interior_walls'],
    coats: 2,
    condition: 'good',
    ceiling_height: 'standard',
    colour_change: false,
    storeys: 1,
    manual_floor_area_m2: null,
  },
} as never

beforeEach(() => h.estimatePainting.mockReset())

describe('runAndSavePaintingQuote — auto-release (R1)', () => {
  it('stamps released_at on a PRICED quote so the customer send can go out', async () => {
    h.estimatePainting.mockResolvedValue({ ok: true, estimate: estimateFixture('auto_quote') })
    const inserted: Record<string, unknown>[] = []

    const disp = await runAndSavePaintingQuote({
      supabase: clientCapturing(inserted),
      tenantId: null,
      customerPhone: '+61400000000',
      request,
    })

    expect(disp.ok).toBe(true)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].released_at, 'a priced lead must be released at save time').toEqual(
      expect.any(String),
    )
    // A real ISO timestamp, not a truthy placeholder.
    expect(Number.isNaN(Date.parse(inserted[0].released_at as string))).toBe(false)
  })

  it('leaves an INSPECTION-routed quote held — no price to show, behaviour unchanged', async () => {
    h.estimatePainting.mockResolvedValue({
      ok: true,
      estimate: estimateFixture('inspection_required'),
    })
    const inserted: Record<string, unknown>[] = []

    const disp = await runAndSavePaintingQuote({
      supabase: clientCapturing(inserted),
      tenantId: null,
      request,
    })

    expect(disp.ok && disp.inspection).toBe(true)
    expect(inserted[0].released_at).toBeNull()
  })
})
