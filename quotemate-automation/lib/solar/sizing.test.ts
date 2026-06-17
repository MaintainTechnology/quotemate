import { describe, it, expect } from 'vitest'
import { sizeSolarSystem } from './sizing'
import { DEFAULT_SOLAR_CONFIG } from './config'
import { normaliseSolarRoofFacts } from './roof'
import { buildManualRoofFacts } from './manual-fallback'
import { COVERED_INSIGHT, COVERED_RAW_BODY, SMALL_PANEL_CONFIG } from './__fixtures__/building-insights'
import type { SolarCoverageResult, SolarEstimateContext, SolarRoofFacts } from './types'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

const COVERAGE = {
  covered: true,
  location: { lat: -33.8688, lng: 151.2093 },
  imagery_quality: 'HIGH',
  imagery_date: '2024-03-12',
} satisfies Extract<SolarCoverageResult, { covered: true }>

const CONTEXT: SolarEstimateContext = {
  postcode: '2000',
  state: 'NSW',
  install_year: 2026,
  network: 'Ausgrid',
}

const FULL_ROOF = normaliseSolarRoofFacts({ ...COVERED_INSIGHT, raw: COVERED_RAW_BODY }, COVERAGE)

// A 20-panel roof where only the small tier (55% ≈ 11 panels, 4.4 kW DC) is
// below the export ceiling (5 kW AC / 0.81 derate ≈ 6.17 kW DC = 15 panels).
// The 80% tier (16 panels, 6.4 kW) and the max tier (20 panels, 8 kW) both
// exceed the ceiling and collapse to 15 panels after clamping, leaving 2
// distinct tiers: good=11 panels (4.4 kW) and best=15 panels (6.0 kW).
const ROOF: SolarRoofFacts = {
  ...FULL_ROOF,
  max_panels_count: 20,
  panel_capacity_watts: 400,
  panel_configs: [
    { panels_count: 11, yearly_energy_dc_kwh: 6600 },
    { panels_count: 15, yearly_energy_dc_kwh: 9000 },
    { panels_count: 20, yearly_energy_dc_kwh: 12000 },
  ],
}

describe('sizeSolarSystem — phase-aware export cap', () => {
  // CONTEXT.network = 'Ausgrid', whose per-phase cap in DEFAULT_SOLAR_CONFIG is 5.
  it('single-phase (default) caps at the per-phase limit ×1', () => {
    const res = sizeSolarSystem({
      roof: ROOF, panelType: 'standard_panels', config: DEFAULT_SOLAR_CONFIG,
      context: { ...CONTEXT, phase: 'single' },
    })
    expect(res.export_limit_kw_ac).toBe(5)
  })

  it('three-phase caps at the per-phase limit ×3', () => {
    const res = sizeSolarSystem({
      roof: ROOF, panelType: 'standard_panels', config: DEFAULT_SOLAR_CONFIG,
      context: { ...CONTEXT, phase: 'three' },
    })
    expect(res.export_limit_kw_ac).toBe(15)
  })

  it('absent phase behaves as single-phase (no regression)', () => {
    const res = sizeSolarSystem({
      roof: ROOF, panelType: 'standard_panels', config: DEFAULT_SOLAR_CONFIG,
      context: { ...CONTEXT },
    })
    expect(res.export_limit_kw_ac).toBe(5)
  })
})

describe('sizeSolarSystem', () => {
  const result = sizeSolarSystem({
    roof: ROOF,
    panelType: 'standard_panels',
    config: DEFAULT_SOLAR_CONFIG,
    context: CONTEXT,
  })

  it('returns 2–3 tiers in ascending kW order', () => {
    expect(result.tiers.length).toBeGreaterThanOrEqual(2)
    expect(result.tiers.length).toBeLessThanOrEqual(3)
    for (let i = 1; i < result.tiers.length; i++) {
      expect(result.tiers[i].system_kw_dc).toBeGreaterThan(result.tiers[i - 1].system_kw_dc)
    }
  })

  it('labels tiers good→best', () => {
    const tiers = result.tiers.map((t) => t.tier)
    expect(tiers[0]).toBe('good')
    expect(tiers[tiers.length - 1]).toBe('best')
  })

  it('derives kW DC from panels × panelCapacityWatts/1000 for non-clamped tiers', () => {
    // The good tier (11 panels) is below the export ceiling, so it is not clamped.
    const goodTier = result.tiers[0]
    expect(goodTier.export_limited).toBe(false)
    expect(goodTier.system_kw_dc).toBe(round2((goodTier.panels_count * ROOF.panel_capacity_watts) / 1000))
  })

  it('never exceeds the roof capacity (20 panels × 400 W = 8 kW)', () => {
    expect(result.roof_capacity_kw_dc).toBe(8)
    for (const t of result.tiers) {
      expect(t.system_kw_dc).toBeLessThanOrEqual(result.roof_capacity_kw_dc)
    }
  })

  it('applies the 5 kW/phase export limit and flags export-limited tiers', () => {
    expect(result.export_limit_kw_ac).toBe(5)
    // With a 0.81 derate, 5 kW AC ≈ 6.17 kW DC ceiling; tiers above are flagged.
    const limited = result.tiers.filter((t) => t.export_limited)
    expect(limited.length).toBeGreaterThan(0)
  })

  it('routes to tradie_review (never auto_quote — high-ticket rule)', () => {
    expect(result.routing.decision).toBe('tradie_review')
  })

  it('carries the requested panel type onto every tier', () => {
    for (const t of result.tiers) expect(t.panel_type).toBe('standard_panels')
  })

  it('falls back to inspection_required when the roof holds no panels', () => {
    const emptyRoof = buildManualRoofFacts({ orientation: 'north', roof_size: 'small', storeys: 1 })
    const tiny = { ...emptyRoof, max_panels_count: 0, panel_configs: [] }
    const r = sizeSolarSystem({
      roof: tiny,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: CONTEXT,
    })
    expect(r.routing.decision).toBe('inspection_required')
    expect(r.tiers.length).toBe(0)
  })

  it('sets export_limited=false for tiers below the 5 kW/phase export ceiling', () => {
    // SMALL_PANEL_CONFIG: 10 panels × 400 W = 4 kW DC → 4 × 0.81 = 3.24 kW AC < 5 kW limit
    // Build a small roof using COVERED_ROOF_FACTS shape but with max_panels_count=10
    // and only the single SMALL_PANEL_CONFIG entry.
    const smallRoof = {
      ...ROOF,
      max_panels_count: 10,
      panel_capacity_watts: 400,
      panel_configs: [
        { panels_count: 5, yearly_energy_dc_kwh: 3000 },
        SMALL_PANEL_CONFIG,
      ],
    }
    const r = sizeSolarSystem({
      roof: smallRoof,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: CONTEXT,
    })
    // 5 kW AC / 0.81 derate ≈ 6.17 kW DC ceiling; 10 × 400 W = 4 kW DC < ceiling
    const allNotLimited = r.tiers.every((t) => !t.export_limited)
    expect(allNotLimited).toBe(true)
  })

  it('routes to inspection_required when the roof is too small for distinct tiers (1 panel)', () => {
    // max_panels_count=1: GOOD_FRACTION(0.55)×1=0.55→1, MIDDLE(0.80)×1=0.80→1, max=1
    // uniqueCounts=[1] — only one unique count, cannot produce 2+ distinct tiers
    const tinyRoof = {
      ...ROOF,
      max_panels_count: 1,
      panel_configs: [{ panels_count: 1, yearly_energy_dc_kwh: 600 }],
    }
    const r = sizeSolarSystem({
      roof: tinyRoof,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: CONTEXT,
    })
    expect(r.routing.decision).toBe('inspection_required')
    expect(r.tiers.length).toBe(0)
  })

  it('works off the single manual-fallback config (2 tiers minimum)', () => {
    // Use a higher export limit so the manual-fallback large-roof (76 panels) can
    // produce distinct tiers after capping. With DEFAULT_SOLAR_CONFIG's 5 kW/phase
    // limit, all 76-panel targets collapse to the same ceiling — a real DNSP
    // scenario where the tradie would need to design a multi-inverter/multi-phase
    // system, hence inspection_required is acceptable. We validate the 2-tier
    // guarantee here by overriding the export limit high enough to let distinct
    // fractions survive.
    const relaxedConfig = {
      ...DEFAULT_SOLAR_CONFIG,
      export_limits: {
        ...DEFAULT_SOLAR_CONFIG.export_limits,
        by_network: { ...DEFAULT_SOLAR_CONFIG.export_limits.by_network, Ausgrid: 100 },
      },
    }
    const manual = buildManualRoofFacts({ orientation: 'north', roof_size: 'large', storeys: 1 })
    const r = sizeSolarSystem({
      roof: manual,
      panelType: 'standard_panels',
      config: relaxedConfig,
      context: CONTEXT,
    })
    expect(r.tiers.length).toBeGreaterThanOrEqual(2)
  })

  // ── New hardening tests ──────────────────────────────────────────────

  it('2-panel boundary: max_panels_count=2 still yields 2 distinct tiers', () => {
    // GOOD_FRACTION(0.55)×2=1.1→1; MIDDLE(0.80)×2=1.6→2; max=2
    // uniqueCounts=[1,2] — both well below the export ceiling (~15 panels at 5kW/0.81)
    const twoPanel: SolarRoofFacts = {
      ...ROOF,
      max_panels_count: 2,
      panel_capacity_watts: 400,
      panel_configs: [
        { panels_count: 1, yearly_energy_dc_kwh: 600 },
        { panels_count: 2, yearly_energy_dc_kwh: 1200 },
      ],
    }
    const r = sizeSolarSystem({
      roof: twoPanel,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: CONTEXT,
    })
    expect(r.routing.decision).toBe('tradie_review')
    expect(r.tiers.length).toBe(2)
    expect(r.tiers[0].panels_count).toBe(1)
    expect(r.tiers[1].panels_count).toBe(2)
    expect(r.tiers[0].system_kw_dc).toBe(0.4)
    expect(r.tiers[1].system_kw_dc).toBe(0.8)
  })

  it('export ceiling below roof capacity: capped tiers REDUCE panels_count and system_kw_dc', () => {
    // 30-panel, 400 W roof. Export ceiling = 5 kW AC / 0.81 derate ~= 6.17 kW DC
    // = exportCeilPanels = floor(6170 / 400) = 15 panels = 6.0 kW DC.
    //
    // Candidate counts: good=round(30×0.55)=17, middle=round(30×0.80)=24, max=30.
    // All three (6.8 kW, 9.6 kW, 12 kW) exceed the 6.17 kW DC ceiling and
    // would clamp to 15 panels. The sizing engine should recover by picking
    // distinct tiers within the capped max: 8, 12, and 15 panels.
    const bigRoof: SolarRoofFacts = {
      ...FULL_ROOF,
      max_panels_count: 30,
      panel_capacity_watts: 400,
      panel_configs: [
        { panels_count: 16, yearly_energy_dc_kwh: 9600 },
        { panels_count: 24, yearly_energy_dc_kwh: 14400 },
        { panels_count: 30, yearly_energy_dc_kwh: 18000 },
      ],
    }
    const r = sizeSolarSystem({
      roof: bigRoof,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: CONTEXT,
    })
    expect(r.routing.decision).toBe('tradie_review')
    expect(r.tiers.map((t) => t.panels_count)).toEqual([8, 12, 15])
    expect(r.tiers.map((t) => t.system_kw_dc)).toEqual([3.2, 4.8, 6])
    expect(r.tiers.every((t) => t.export_limited)).toBe(true)

    // Now use an export limit of 10 kW instead (override via by_network) to
    // verify that the cap REDUCES the best tier from 30→24 panels but leaves the
    // good tier (17 panels, 6.8 kW DC < 12.35 kW DC ceiling) uncapped.
    // exportDcCeiling = 10 / 0.81 ≈ 12.35 kW → exportCeilPanels = floor(12350/400) = 30
    // good=17 panels, 6.8 kW < 12.35 → NOT capped
    // middle=24 panels, 9.6 kW < 12.35 → NOT capped
    // best=30 panels, 12.0 kW < 12.35 → NOT capped (all fit under 10 kW / 0.81)
    // Wait, 10/0.81 = 12.35, and 30×0.4=12 < 12.35 → best also uncapped.
    // Use a tighter limit: 7 kW AC → ceiling = 7/0.81 ≈ 8.64 kW → 21 panels
    const tighterConfig = {
      ...DEFAULT_SOLAR_CONFIG,
      export_limits: {
        ...DEFAULT_SOLAR_CONFIG.export_limits,
        by_network: { ...DEFAULT_SOLAR_CONFIG.export_limits.by_network, Ausgrid: 7 },
      },
    }
    // exportDcCeiling = 7 / 0.81 ≈ 8.64 kW → exportCeilPanels = floor(8642/400) = 21 panels
    // good=17 panels (6.8 kW < 8.64) → NOT capped, export_limited=false
    // middle=24 panels (9.6 kW > 8.64) → CLAMP to 21 panels (8.4 kW), export_limited=true
    // best=30 panels (12 kW > 8.64) → CLAMP to 21 panels (8.4 kW), export_limited=true
    // middle and best both clamp to 21 → deduplicated to [17, 21] → 2 tiers
    const r2 = sizeSolarSystem({
      roof: bigRoof,
      panelType: 'standard_panels',
      config: tighterConfig,
      context: CONTEXT,
    })
    expect(r2.routing.decision).toBe('tradie_review')
    expect(r2.tiers.length).toBe(2)

    const goodTier = r2.tiers[0]
    const bestTier = r2.tiers[1]

    // good tier: NOT capped — 17 panels × 400 W = 6.8 kW DC
    expect(goodTier.panels_count).toBe(17)
    expect(goodTier.system_kw_dc).toBe(6.8)
    expect(goodTier.export_limited).toBe(false)

    // best tier: CAPPED from 30 → 21 panels, 8.4 kW DC
    expect(bestTier.panels_count).toBe(21)
    expect(bestTier.system_kw_dc).toBe(8.4)
    expect(bestTier.export_limited).toBe(true)
    // Verify the cap actually reduced panels_count vs what it would have been without capping
    expect(bestTier.panels_count).toBeLessThan(bigRoof.max_panels_count)
  })

  it('per-tier panels_count equals the expected rounded fraction of max (uncapped roof)', () => {
    // Use a small roof well below the export ceiling so no clamping occurs.
    // max_panels_count=10: good=round(10×0.55)=6, best=10 (uniqueCounts=[6,10] — 2 tiers)
    // At 400W: good=2.4kW, best=4.0kW — both below the 6.17kW DC ceiling.
    const smallRoof: SolarRoofFacts = {
      ...ROOF,
      max_panels_count: 10,
      panel_capacity_watts: 400,
      panel_configs: [
        { panels_count: 6, yearly_energy_dc_kwh: 3600 },
        { panels_count: 8, yearly_energy_dc_kwh: 4800 },
        { panels_count: 10, yearly_energy_dc_kwh: 6000 },
      ],
    }
    const r = sizeSolarSystem({
      roof: smallRoof,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: CONTEXT,
    })
    // With max=10: GOOD_FRACTION×10=5.5→6, MIDDLE=8, max=10 → 3 tiers
    expect(r.tiers[0].panels_count).toBe(Math.round(10 * 0.55)) // 6
    expect(r.tiers[1].panels_count).toBe(Math.round(10 * 0.80)) // 8
    expect(r.tiers[2].panels_count).toBe(10)
  })

  it('derate_factor invalid: returns inspection_required without silently producing all-export-limited tiers', () => {
    const badConfig = { ...DEFAULT_SOLAR_CONFIG, derate_factor: 0 }
    const r = sizeSolarSystem({
      roof: ROOF,
      panelType: 'standard_panels',
      config: badConfig,
      context: CONTEXT,
    })
    expect(r.routing.decision).toBe('inspection_required')
    expect(r.tiers.length).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════════
// Phase multiplier + preferred-size anchor (money-path inputs).
// ════════════════════════════════════════════════════════════════════

describe('sizeSolarSystem — power-supply phase', () => {
  // A big roof whose top tier is bound by the SINGLE-phase export ceiling.
  // 40 panels × 400 W = 16 kW DC roof max. Single-phase ceiling = 5 kW AC /
  // 0.81 ≈ 6.17 kW DC → 15 panels (6.0 kW). Three-phase ceiling = 15 kW AC /
  // 0.81 ≈ 18.5 kW DC → 46 panels, so the roof max (40 = 16 kW) binds instead.
  const BIG_ROOF: SolarRoofFacts = {
    ...FULL_ROOF,
    max_panels_count: 40,
    panel_capacity_watts: 400,
    panel_configs: [
      { panels_count: 22, yearly_energy_dc_kwh: 13200 },
      { panels_count: 32, yearly_energy_dc_kwh: 19200 },
      { panels_count: 40, yearly_energy_dc_kwh: 24000 },
    ],
  }

  const single = sizeSolarSystem({
    roof: BIG_ROOF,
    panelType: 'standard_panels',
    config: DEFAULT_SOLAR_CONFIG,
    context: { ...CONTEXT, phase: 'single' },
  })
  const three = sizeSolarSystem({
    roof: BIG_ROOF,
    panelType: 'standard_panels',
    config: DEFAULT_SOLAR_CONFIG,
    context: { ...CONTEXT, phase: 'three' },
  })

  it('(a) 3-phase yields a larger top tier than single-phase on a big roof', () => {
    const singleTop = single.tiers[single.tiers.length - 1]
    const threeTop = three.tiers[three.tiers.length - 1]
    expect(threeTop.system_kw_dc).toBeGreaterThan(singleTop.system_kw_dc)
    // Single-phase is bound by the 5 kW/phase ceiling → 15 panels (6.0 kW).
    expect(singleTop.system_kw_dc).toBe(6)
    // Three-phase lifts the ceiling 3× so the ROOF max binds → 40 panels (16 kW).
    expect(threeTop.system_kw_dc).toBe(16)
  })

  it('multiplies the AC export ceiling by 3 for three-phase (×1 otherwise)', () => {
    expect(single.export_limit_kw_ac).toBe(5)
    expect(three.export_limit_kw_ac).toBe(15)
    expect(three.phase).toBe('three')
  })

  it("(d) 'single' and 'unknown' size identically to today's no-phase behaviour", () => {
    const noPhase = sizeSolarSystem({
      roof: BIG_ROOF,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: CONTEXT, // phase undefined
    })
    const unknown = sizeSolarSystem({
      roof: BIG_ROOF,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: { ...CONTEXT, phase: 'unknown' },
    })
    expect(unknown.tiers.map((t) => t.system_kw_dc)).toEqual(
      noPhase.tiers.map((t) => t.system_kw_dc),
    )
    expect(single.tiers.map((t) => t.system_kw_dc)).toEqual(
      noPhase.tiers.map((t) => t.system_kw_dc),
    )
    expect(noPhase.export_limit_kw_ac).toBe(5)
  })
})

describe('sizeSolarSystem — preferred system size anchors the tiers', () => {
  // Same 40-panel (16 kW) roof. Use three-phase so the export ceiling is large
  // (18.5 kW DC) and the ANCHOR — not the grid — is the binding constraint, so
  // the test isolates the requested-size behaviour.
  const BIG_ROOF: SolarRoofFacts = {
    ...FULL_ROOF,
    max_panels_count: 40,
    panel_capacity_watts: 400,
    panel_configs: [
      { panels_count: 22, yearly_energy_dc_kwh: 13200 },
      { panels_count: 32, yearly_energy_dc_kwh: 19200 },
      { panels_count: 40, yearly_energy_dc_kwh: 24000 },
    ],
  }

  it('(b) a requested size below the roof max anchors the top tier near that size', () => {
    // Request 10 kW DC → round(10000/400)=25 panels anchor (< 40 roof max).
    // Top tier targets 25 panels = 10.0 kW (well under the 3-phase ceiling).
    const r = sizeSolarSystem({
      roof: BIG_ROOF,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: { ...CONTEXT, phase: 'three', requested_size_kw: 10 },
    })
    expect(r.routing.decision).toBe('tradie_review')
    const top = r.tiers[r.tiers.length - 1]
    expect(top.system_kw_dc).toBe(10)
    expect(top.panels_count).toBe(25)
    expect(r.requested_size_kw).toBe(10)
    // The true roof max is unchanged — only the tier anchor moved.
    expect(r.roof_capacity_kw_dc).toBe(16)
  })

  it('(c) a requested size above the roof max is still capped at the roof max', () => {
    // Request 30 kW DC → round(30000/400)=75 panels → anchor=min(75,40)=40.
    // Top tier = the roof max (40 panels, 16 kW), never above it.
    const r = sizeSolarSystem({
      roof: BIG_ROOF,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: { ...CONTEXT, phase: 'three', requested_size_kw: 30 },
    })
    expect(r.routing.decision).toBe('tradie_review')
    const top = r.tiers[r.tiers.length - 1]
    expect(top.system_kw_dc).toBe(16)
    expect(top.panels_count).toBe(40)
    expect(top.system_kw_dc).toBeLessThanOrEqual(r.roof_capacity_kw_dc)
  })

  it('keeps a preferred size as the proposed system and flags export review', () => {
    // Request 12 kW DC (30 panels) on SINGLE phase: the anchor is 30 panels
    // and the 5 kW/phase ceiling is flagged for installer/connection review
    // instead of silently shrinking the proposal to 6.0 kW.
    const r = sizeSolarSystem({
      roof: BIG_ROOF,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: { ...CONTEXT, phase: 'single', requested_size_kw: 12 },
    })
    const top = r.tiers[r.tiers.length - 1]
    expect(top.system_kw_dc).toBe(12)
    expect(top.panels_count).toBe(30)
    expect(top.export_limited).toBe(true)
  })

  it('caps an oversized preferred request at the public quote maximum', () => {
    const giantRoof: SolarRoofFacts = {
      ...BIG_ROOF,
      max_panels_count: 160,
      panel_configs: [
        { panels_count: 88, yearly_energy_dc_kwh: 52800 },
        { panels_count: 128, yearly_energy_dc_kwh: 76800 },
        { panels_count: 160, yearly_energy_dc_kwh: 96000 },
      ],
    }
    const r = sizeSolarSystem({
      roof: giantRoof,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: { ...CONTEXT, phase: 'unknown', requested_size_kw: 80 },
    })
    const top = r.tiers[r.tiers.length - 1]
    expect(top.system_kw_dc).toBe(40)
    expect(top.panels_count).toBe(100)
    expect(top.export_limited).toBe(true)
  })

  it('an absent / invalid requested size leaves the anchor at the roof max', () => {
    const baseline = sizeSolarSystem({
      roof: BIG_ROOF,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: { ...CONTEXT, phase: 'three' },
    })
    const invalid = sizeSolarSystem({
      roof: BIG_ROOF,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: { ...CONTEXT, phase: 'three', requested_size_kw: -5 },
    })
    expect(invalid.requested_size_kw).toBeNull()
    expect(invalid.tiers.map((t) => t.system_kw_dc)).toEqual(
      baseline.tiers.map((t) => t.system_kw_dc),
    )
  })
})

describe('sizeSolarSystem — dc_oversize_factor lever', () => {
  // 40-panel, 400 W roof so the export ceiling (not the roof) binds the top
  // tier on a single-phase Ausgrid (5 kW/phase) supply.
  const BIG_ROOF: SolarRoofFacts = {
    ...FULL_ROOF,
    max_panels_count: 40,
    panel_capacity_watts: 400,
    panel_configs: [
      { panels_count: 22, yearly_energy_dc_kwh: 13200 },
      { panels_count: 32, yearly_energy_dc_kwh: 19200 },
      { panels_count: 40, yearly_energy_dc_kwh: 24000 },
    ],
  }

  function topKw(config: typeof DEFAULT_SOLAR_CONFIG): number {
    const r = sizeSolarSystem({
      roof: BIG_ROOF,
      panelType: 'standard_panels',
      config,
      context: { ...CONTEXT, phase: 'single' },
    })
    return r.tiers[r.tiers.length - 1].system_kw_dc
  }

  it('absent factor preserves the prior 1/derate ceiling (6.0 kW, 15 panels)', () => {
    // DEFAULT_SOLAR_CONFIG ships WITHOUT dc_oversize_factor → 5 / 0.81 ≈ 6.17
    // kW DC ceiling → floor(6170/400) = 15 panels = 6.0 kW. No live change.
    expect(DEFAULT_SOLAR_CONFIG.dc_oversize_factor).toBeUndefined()
    expect(topKw(DEFAULT_SOLAR_CONFIG)).toBe(6)
  })

  it('factor 1.33 raises the ceiling (5 × 1.33 = 6.65 kW → 16 panels = 6.4 kW)', () => {
    const config = { ...DEFAULT_SOLAR_CONFIG, dc_oversize_factor: 1.33 }
    expect(topKw(config)).toBe(6.4)
  })

  it('factor 1.0 is stricter than the default (caps DC at the AC limit, 5 kW → 12 panels = 4.8 kW)', () => {
    const config = { ...DEFAULT_SOLAR_CONFIG, dc_oversize_factor: 1.0 }
    expect(topKw(config)).toBe(4.8)
  })
})
