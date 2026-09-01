import { describe, expect, it } from 'vitest'
import { loadRoofingRateCard } from './solar-detect'

const COMPLETE = {
  reroof_rate_per_m2: {
    colorbond_corrugated: 90,
    colorbond_trimdek: 95,
    colorbond_spandek: 97,
    colorbond_kliplok: 110,
    concrete_tile: 88,
    terracotta_tile: 105,
    cement_sheet: 140,
  },
  multi_storey_loading_pct: 0.2,
  asbestos_loading_pct: 0.35,
  complexity_loading_pct: 0.15,
  upgrade_material: 'colorbond_trimdek',
  gst_registered: true,
  call_out_minimum_ex_gst: 500,
  gutter_rate_per_lm: 40,
  downpipe_rate_per_each: 220,
  fascia_rate_per_lm: 50,
  soffit_rate_per_lm: 60,
  ridge_hip_repoint_rate_per_lm: 15,
  valley_flashing_rate_per_lm: 45,
  box_gutter_rate_per_lm: 70,
  price_edge_works: true,
  solar_detach_reinstate_base_ex_gst: 1200,
  solar_detach_reinstate_per_array_ex_gst: 500,
}

function fakeDb(rows: unknown[]) {
  const query = {
    select: () => query,
    eq: () => Promise.resolve({ data: rows, error: null }),
  }
  return { from: () => query } as never
}

describe('loadRoofingRateCard fail-closed compatibility reader', () => {
  it('selects the complete primary-trade tenant card', async () => {
    const card = await loadRoofingRateCard(
      fakeDb([
        {
          id: 'book-roofing',
          trade: 'roofing',
          overlays: { roofing_rate_card: { ...COMPLETE, gst_registered: false } },
        },
        {
          id: 'book-electrical',
          trade: 'electrical',
          overlays: { roofing_rate_card: COMPLETE },
        },
      ]),
      'tenant-1',
      'electrical',
    )
    expect(card?.gst_registered).toBe(true)
    expect(card?.reroof_rate_per_m2.colorbond_trimdek).toBe(95)
  })

  it('returns null instead of global prices for tenant-less, absent or partial setup', async () => {
    await expect(loadRoofingRateCard(fakeDb([]), null, null)).resolves.toBeNull()
    await expect(loadRoofingRateCard(fakeDb([]), 'tenant-1', 'roofing')).resolves.toBeNull()
    await expect(
      loadRoofingRateCard(
        fakeDb([
          {
            id: 'book-1',
            trade: 'roofing',
            overlays: { roofing_rate_card: { reroof_rate_per_m2: { concrete_tile: 88 } } },
          },
        ]),
        'tenant-1',
        'roofing',
      ),
    ).resolves.toBeNull()
  })
})
