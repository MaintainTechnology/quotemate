import { describe, it, expect } from 'vitest'
import { buildSolarSunView, hourLabel } from './sun-view'
import { COVERED_ROOF_FACTS, MANUAL_INPUT } from './__fixtures__/building-insights'
import { buildManualRoofFacts } from './manual-fallback'
import type { SolarEstimate, SolarEstimateContext } from './types'

function makeEstimate(overrides: {
  roof?: SolarEstimate['roof']
  sun?: SolarEstimateContext['sun']
}): SolarEstimate {
  return {
    token: 'tok_test',
    context: {
      postcode: '2000',
      state: 'NSW',
      install_year: 2026,
      network: 'Ausgrid',
      sun: overrides.sun ?? null,
    },
    coverage_source: 'google',
    roof: overrides.roof ?? COVERED_ROOF_FACTS,
    sizing: { tiers: [] },
    production: [],
    price: { tiers: [] },
    economics: { tiers: [], assumptions: {} },
    confidence_band: 'tight',
    satellite_image_url: null,
    routing: { decision: 'tradie_review', reason: null },
    guardrail_flags: [],
    config_version: 'test',
  } as unknown as SolarEstimate
}

const FULL_SUN: NonNullable<SolarEstimateContext['sun']> = {
  generated_at: '2026-06-13T00:00:00.000Z',
  flux_image_path: 'solar/row/flux-annual-1.png',
  min_flux: 820,
  max_flux: 1810,
  monthly_production_weights: new Array(12).fill(1 / 12),
  shade: {
    hourly_sun_fraction: new Array(24).fill(0.95),
    monthly_midday_sun_fraction: new Array(12).fill(0.97),
    shade_free_start_hour: 9,
    shade_free_end_hour: 15,
    shade_free_hours: 7,
  },
  building_height: { height_m: 6.2, storeys_hint: 2 },
  imagery_date: '2024-03-12',
}

describe('hourLabel', () => {
  it('formats AU-style hour labels', () => {
    expect(hourLabel(0)).toBe('12am')
    expect(hourLabel(9)).toBe('9am')
    expect(hourLabel(12)).toBe('12pm')
    expect(hourLabel(15)).toBe('3pm')
    expect(hourLabel(23)).toBe('11pm')
  })
})

describe('buildSolarSunView', () => {
  it('builds the full view from roof facts + context.sun', () => {
    const view = buildSolarSunView(makeEstimate({ sun: FULL_SUN }))
    expect(view).not.toBeNull()
    const labels = view!.stats.map((s) => s.label)
    expect(labels).toContain('Sunshine on this roof')
    expect(labels).toContain('Shade-free window')
    expect(labels).toContain('Building height')
    expect(labels).toContain('Panel lifetime assumed')
    expect(labels).toContain('Max array area')
    // Shade window 9 → end 15 displays as "9am – 4pm" (end is inclusive).
    const window_ = view!.stats.find((s) => s.label === 'Shade-free window')
    expect(window_?.value).toBe('9am – 4pm')
    expect(view!.flux_image_available).toBe(true)
    expect(view!.flux_caption).toContain('820')
    expect(view!.flux_caption).toContain('2024-03-12')
    expect(view!.flux_caption).toContain('Google Solar imagery')
    expect(view!.flux_caption).toContain('background map tiles may be newer')
  })

  it('sorts plane scores sunniest first with copy + relative %', () => {
    const view = buildSolarSunView(makeEstimate({ sun: null }))
    expect(view).not.toBeNull()
    expect(view!.planes.length).toBe(2)
    expect(view!.planes[0].orientation.toLowerCase()).toContain('north')
    expect(view!.planes[0].relative_pct).toBe(100)
    expect(view!.planes[0].score_copy).toBe('Excellent sun')
    expect(view!.planes[1].relative_pct).toBe(75)
  })

  it('omits the shade stat when no window exists', () => {
    const noWindow = {
      ...FULL_SUN,
      shade: { ...FULL_SUN.shade!, shade_free_hours: 0, shade_free_start_hour: null, shade_free_end_hour: null },
    }
    const view = buildSolarSunView(makeEstimate({ sun: noWindow }))
    expect(view!.stats.map((s) => s.label)).not.toContain('Shade-free window')
  })

  it('returns null on the manual path with no sun data anywhere', () => {
    const manualRoof = buildManualRoofFacts(MANUAL_INPUT)
    const view = buildSolarSunView(makeEstimate({ roof: manualRoof, sun: null }))
    expect(view).toBeNull()
  })

  it('flux caption is null without a cached image', () => {
    const view = buildSolarSunView(makeEstimate({ sun: { ...FULL_SUN, flux_image_path: null } }))
    expect(view!.flux_image_available).toBe(false)
    expect(view!.flux_caption).toBeNull()
  })

  it('builds on-image markers from anchors + scores, best plane first', () => {
    const view = buildSolarSunView(
      makeEstimate({
        sun: {
          ...FULL_SUN,
          plane_anchors: [
            { plane_index: 1, x_pct: 70, y_pct: 60 }, // south (75%)
            { plane_index: 0, x_pct: 30, y_pct: 40 }, // north (best)
          ],
        },
      }),
    )
    expect(view!.markers).toHaveLength(2)
    // Best plane sorted first and flagged.
    expect(view!.markers[0].is_best).toBe(true)
    expect(view!.markers[0].orientation.toLowerCase()).toContain('north')
    expect(view!.markers[0].x_pct).toBe(30)
    expect(view!.markers[0].score_copy).toBe('Excellent sun')
    expect(view!.markers[1].is_best).toBe(false)
    expect(view!.markers[1].relative_pct).toBe(75)
    expect(view!.flux_caption).toContain('one per Google-detected roof face (2 faces)')
  })

  it('skips markers for anchors without a scored plane and without an image', () => {
    const orphanAnchor = buildSolarSunView(
      makeEstimate({
        sun: { ...FULL_SUN, plane_anchors: [{ plane_index: 9, x_pct: 10, y_pct: 10 }] },
      }),
    )
    expect(orphanAnchor!.markers).toEqual([])

    const noImage = buildSolarSunView(
      makeEstimate({
        sun: {
          ...FULL_SUN,
          flux_image_path: null,
          plane_anchors: [{ plane_index: 0, x_pct: 30, y_pct: 40 }],
        },
      }),
    )
    expect(noImage!.markers).toEqual([])
  })
})
