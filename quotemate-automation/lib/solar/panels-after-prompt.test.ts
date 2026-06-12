import { describe, it, expect } from 'vitest'
import {
  buildSolarPanelsAfterPrompt,
  deriveSolarLayoutFacts,
} from './panels-after-prompt'
import type { SolarPanelPlacement, SolarRoofPlane } from './types'

describe('buildSolarPanelsAfterPrompt (orientation-only fallback)', () => {
  const prompt = buildSolarPanelsAfterPrompt({
    panelsCount: 15,
    systemKwDc: 6.0,
    orientation: 'south',
  })

  it('returns a system + user brief', () => {
    expect(prompt.system.length).toBeGreaterThan(40)
    expect(prompt.user.length).toBeGreaterThan(100)
  })

  it('grounds the render on the exact quoted panel count and size', () => {
    expect(prompt.user).toContain('15 dark monocrystalline solar panels')
    expect(prompt.user).toContain('6.0 kW')
  })

  it('places panels on the primary-orientation plane', () => {
    expect(prompt.user).toContain('south-facing roof plane(s)')
  })

  it('flat and unknown orientations fall back to the largest roof area', () => {
    for (const orientation of ['flat', 'unknown'] as const) {
      const p = buildSolarPanelsAfterPrompt({ panelsCount: 10, systemKwDc: 4, orientation })
      expect(p.user).toContain('largest unobstructed roof area')
      expect(p.user).not.toContain('-facing roof plane')
    }
  })

  it('keeps the strict do-not-change rules and bans text/watermarks', () => {
    expect(prompt.user).toContain('STRICT RULES')
    expect(prompt.user).toContain('Do NOT re-roof')
    expect(prompt.user).toMatch(/do NOT add text, labels, watermarks or people/i)
    expect(prompt.system).toContain('ONE change only')
  })

  it('sanitises a fractional or zero panel count', () => {
    const fractional = buildSolarPanelsAfterPrompt({
      panelsCount: 12.6,
      systemKwDc: 5,
      orientation: 'north',
    })
    expect(fractional.user).toContain('13 dark monocrystalline')
    const zero = buildSolarPanelsAfterPrompt({ panelsCount: 0, systemKwDc: 0.4, orientation: 'north' })
    expect(zero.user).toContain('1 dark monocrystalline')
  })
})

// ── Layout-grounded brief (premium quote — concept must follow the
//    Proposed Panel Layout / string figures' data) ─────────────────────

const SYD = { lat: -33.8688, lng: 151.2093 }
const PANEL_SIZE = { height_m: 1.879, width_m: 1.045 }

const PLANES: SolarRoofPlane[] = [
  { pitch_degrees: 22, azimuth_degrees: 0, area_m2: 80, orientation: 'north' },
  { pitch_degrees: 18, azimuth_degrees: 90, area_m2: 50, orientation: 'east' },
]

/** rows × cols grid of panels on one plane, ~1.9 m row spacing. */
function gridPanels(args: {
  rows: number
  cols: number
  segment?: number
  latOffset?: number
  lngOffset?: number
  orientation?: 'PORTRAIT' | 'LANDSCAPE'
}): SolarPanelPlacement[] {
  const out: SolarPanelPlacement[] = []
  for (let r = 0; r < args.rows; r++) {
    for (let c = 0; c < args.cols; c++) {
      out.push({
        center: {
          lat: SYD.lat + (args.latOffset ?? 0) + r * 0.000017, // ~1.9 m
          lng: SYD.lng + (args.lngOffset ?? 0) + c * 0.0000115, // ~1.06 m
        },
        orientation: args.orientation ?? 'PORTRAIT',
        segment_index: args.segment ?? 0,
        yearly_energy_dc_kwh: 550,
      })
    }
  }
  return out
}

describe('deriveSolarLayoutFacts', () => {
  it('one plane, 2 rows of 7 → one fact with 14 panels in 2 rows', () => {
    const facts = deriveSolarLayoutFacts({
      panels: gridPanels({ rows: 2, cols: 7 }),
      planes: PLANES,
      center: SYD,
      panel_size_m: PANEL_SIZE,
    })
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      panels_count: 14,
      rows: 2,
      panel_orientation: 'portrait',
    })
    expect(facts[0].plane_label).toBe('north-facing plane (pitch 22°)')
  })

  it('two planes → two facts in segment order with per-plane counts', () => {
    const panels = [
      ...gridPanels({ rows: 2, cols: 7, segment: 0 }),
      ...gridPanels({ rows: 1, cols: 5, segment: 1, lngOffset: 0.0003 }),
    ]
    const facts = deriveSolarLayoutFacts({
      panels,
      planes: PLANES,
      center: SYD,
      panel_size_m: PANEL_SIZE,
    })
    expect(facts).toHaveLength(2)
    expect(facts[0].panels_count).toBe(14)
    expect(facts[1].panels_count).toBe(5)
    expect(facts[1].plane_label).toContain('east-facing')
  })

  it('respects the headline-tier panel_limit (Google orders by energy)', () => {
    const facts = deriveSolarLayoutFacts({
      panels: gridPanels({ rows: 3, cols: 5 }),
      planes: PLANES,
      center: SYD,
      panel_limit: 10,
      panel_size_m: PANEL_SIZE,
    })
    expect(facts[0].panels_count).toBe(10)
  })

  it('describes the cluster region of the photo frame', () => {
    // Panels north-west of centre → upper-left of the image.
    const facts = deriveSolarLayoutFacts({
      panels: gridPanels({ rows: 2, cols: 3, latOffset: 0.0001, lngOffset: -0.0002 }),
      planes: PLANES,
      center: SYD,
      panel_size_m: PANEL_SIZE,
    })
    expect(facts[0].region).toBe('upper-left')
  })

  it('flags a mixed portrait/landscape plane', () => {
    const panels = [
      ...gridPanels({ rows: 1, cols: 3, orientation: 'PORTRAIT' }),
      ...gridPanels({ rows: 1, cols: 2, orientation: 'LANDSCAPE', latOffset: 0.00003 }),
    ]
    const facts = deriveSolarLayoutFacts({
      panels,
      planes: PLANES,
      center: SYD,
      panel_size_m: PANEL_SIZE,
    })
    expect(facts[0].panel_orientation).toBe('mixed')
  })

  it('empty geometry or bad centre → no facts (fallback brief)', () => {
    expect(
      deriveSolarLayoutFacts({ panels: [], planes: PLANES, center: SYD }),
    ).toEqual([])
    expect(
      deriveSolarLayoutFacts({
        panels: gridPanels({ rows: 1, cols: 2 }),
        planes: PLANES,
        center: { lat: Number.NaN, lng: 151 },
      }),
    ).toEqual([])
  })
})

describe('buildSolarPanelsAfterPrompt (layout-grounded)', () => {
  const layout = deriveSolarLayoutFacts({
    panels: [
      ...gridPanels({ rows: 2, cols: 7, segment: 0 }),
      ...gridPanels({ rows: 1, cols: 5, segment: 1, lngOffset: 0.0003 }),
    ],
    planes: PLANES,
    center: SYD,
    panel_size_m: PANEL_SIZE,
  })
  const prompt = buildSolarPanelsAfterPrompt({
    panelsCount: 19,
    systemKwDc: 7.6,
    orientation: 'north',
    layout,
  })

  it('enumerates each plane with exact counts, rows and photo region', () => {
    expect(prompt.user).toContain('PANEL PLACEMENT — follow this engineering layout exactly')
    expect(prompt.user).toContain('north-facing plane (pitch 22°): exactly 14 panels arranged in 2 neat rows')
    expect(prompt.user).toContain('east-facing plane (pitch 18°): exactly 5 panels arranged in 1 neat row')
    expect(prompt.user).toMatch(/positioned on the [a-z-]+ part of the roof/)
  })

  it('pins the strict total and bans extra planes', () => {
    expect(prompt.user).toContain('TOTAL: exactly 19 panels across the whole roof')
    expect(prompt.user).toContain('do not place panels on any other roof plane')
  })

  it('keeps the strict do-not-change rules in the layout-grounded brief', () => {
    expect(prompt.user).toContain('STRICT RULES')
    expect(prompt.user).toContain('Do NOT re-roof')
  })

  it('an empty layout falls back to the orientation-only brief', () => {
    const p = buildSolarPanelsAfterPrompt({
      panelsCount: 19,
      systemKwDc: 7.6,
      orientation: 'north',
      layout: [],
    })
    expect(p.user).toContain('north-facing roof plane(s)')
    expect(p.user).not.toContain('PANEL PLACEMENT')
  })
})
