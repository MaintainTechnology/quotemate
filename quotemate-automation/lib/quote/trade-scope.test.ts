// Unit tests for the trade-specific measurement-scope parsers behind the
// customer quote page. These pin the contract that EVERY persisted
// measurement field the creation routes stamp is surfaced (the original bug:
// roofing scope carried material/pitch/ridge/footprint that never rendered).

import { describe, it, expect } from 'vitest'
import {
  roofScopeStats,
  commercialPaintScope,
  tenderLineItems,
} from './trade-scope'

describe('roofScopeStats', () => {
  it('surfaces every persisted roofing measurement field', () => {
    // Mirrors what app/api/roofing/save-as-quote stamps: {...inputs, ...metrics}
    const scope = {
      material: 'colorbond_trimdek',
      pitch: 'steep',
      intent: 'full_reroof',
      footprint_m2: 412.4,
      sloped_area_m2: 586.2,
      storeys: 2,
      form: 'hip_and_valley',
      hips: 4,
      valleys: 2,
      ridge_lm: 31.5,
      capture_date: '2026-03-01',
      state: 'QLD',
      postcode: '4155',
    }
    expect(roofScopeStats(scope)).toEqual({
      area_m2: 586.2,
      footprint_m2: 412.4,
      form: 'hip_and_valley',
      material: 'colorbond_trimdek',
      pitch: 'steep',
      hips: 4,
      valleys: 2,
      ridge_lm: 31.5,
      storeys: 2,
    })
  })

  it('degrades each missing/invalid field to null independently', () => {
    const stats = roofScopeStats({
      sloped_area_m2: 200,
      form: '',
      hips: 'four',
      material: 42,
    })
    expect(stats).toEqual({
      area_m2: 200,
      footprint_m2: null,
      form: null,
      material: null,
      pitch: null,
      hips: null,
      valleys: null,
      ridge_lm: null,
      storeys: null,
    })
  })

  it('returns null for a non-object scope', () => {
    expect(roofScopeStats(null)).toBeNull()
    expect(roofScopeStats('scope')).toBeNull()
    expect(roofScopeStats([1, 2])).toBeNull()
  })
})

describe('commercialPaintScope', () => {
  it('surfaces the full takeoff summary the save-quote route stamps', () => {
    const scope = {
      job_name: 'Tradie Test',
      surfaces: 50,
      total_m2: 1274.24,
      labour_hours: 216.19,
      crew_size: 3,
      estimated_days: 10,
      separate_price_ex_gst: 0,
    }
    expect(commercialPaintScope(scope)).toEqual({
      job_name: 'Tradie Test',
      surfaces: 50,
      total_m2: 1274.24,
      labour_hours: 216.19,
      crew_size: 3,
      estimated_days: 10,
    })
  })

  it('returns null when the scope carries no takeoff fields (skip empty section)', () => {
    expect(commercialPaintScope({})).toBeNull()
    expect(commercialPaintScope({ item_count: 4 })).toBeNull()
    expect(commercialPaintScope(null)).toBeNull()
  })
})

describe('tenderLineItems', () => {
  it('extracts the per-surface takeoff lines from a tender tier', () => {
    const tier = {
      label: 'Tender price',
      subtotal_ex_gst: 19386,
      line_items: [
        {
          unit: 'sqm',
          quantity: 42.5,
          description: 'Warehouse — walls (2 coats, Dulux Professional)',
          unit_price_ex_gst: 12,
          total_ex_gst: 510,
          source: 'paint_rates',
        },
        {
          unit: 'days',
          quantity: 3,
          description: 'Scissor lift — height access',
          unit_price_ex_gst: 250,
          total_ex_gst: 750,
          source: 'paint_rates',
        },
      ],
    }
    expect(tenderLineItems(tier)).toEqual([
      {
        description: 'Warehouse — walls (2 coats, Dulux Professional)',
        quantity: 42.5,
        unit: 'sqm',
        total_ex_gst: 510,
      },
      { description: 'Scissor lift — height access', quantity: 3, unit: 'days', total_ex_gst: 750 },
    ])
  })

  it('skips malformed entries instead of failing the page', () => {
    const tier = {
      line_items: [
        { description: 'ok', quantity: 1, unit: 'each', total_ex_gst: 10 },
        { description: 'no numbers', quantity: 'one', total_ex_gst: 10 },
        'not-an-object',
        { quantity: 2, total_ex_gst: 20 },
      ],
    }
    expect(tenderLineItems(tier)).toEqual([
      { description: 'ok', quantity: 1, unit: 'each', total_ex_gst: 10 },
    ])
  })

  it('returns [] for tiers without line items', () => {
    expect(tenderLineItems(null)).toEqual([])
    expect(tenderLineItems({ subtotal_ex_gst: 100 })).toEqual([])
    expect(tenderLineItems({ line_items: 'none' })).toEqual([])
  })
})
