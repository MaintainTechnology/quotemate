// Tests for the catalogue coverage pure module.
// No DB, no fetch — just shape-the-rows → assert-the-report.

import { describe, expect, it } from 'vitest'
import {
  computeCoverage,
  type SharedMaterialRow,
  type TenantMaterialRow,
} from './coverage'

// ──────────────────────────────────────────────────────────────────────
// Fixtures
//
// IMPORTANT: production reality is that shared_materials uses GRANULAR
// vocab (e.g. 'hws_electric') while tenant_material_catalogue uses
// GROUNDING vocab (e.g. 'hot_water'). computeCoverage maps both sides
// to grounding vocab before bucketing so the two sides line up.
//
// To keep the math tests simple, the fixtures below use pass-through
// grounding categories (drain, hot_water, tap, toilet) for which the
// granular and grounding vocabs are identical. The dedicated
// "dual-vocab" section at the bottom verifies the mapping behaviour
// using realistic mixed shared (granular) + tenant (grounding) rows.
// ──────────────────────────────────────────────────────────────────────

const SHARED_PLUMBING: SharedMaterialRow[] = [
  // 3 hot_water rows
  { trade: 'plumbing', category: 'hot_water' },
  { trade: 'plumbing', category: 'hot_water' },
  { trade: 'plumbing', category: 'hot_water' },
  // 2 tap rows
  { trade: 'plumbing', category: 'tap' },
  { trade: 'plumbing', category: 'tap' },
  // 1 drain row
  { trade: 'plumbing', category: 'drain' },
  // 1 toilet row
  { trade: 'plumbing', category: 'toilet' },
]

const SHARED_ELECTRICAL: SharedMaterialRow[] = [
  { trade: 'electrical', category: 'gpo' },
  { trade: 'electrical', category: 'gpo' },
  { trade: 'electrical', category: 'downlight' },
]

const SHARED_ALL = [...SHARED_PLUMBING, ...SHARED_ELECTRICAL]

// ──────────────────────────────────────────────────────────────────────
// computeCoverage — basic shape
// ──────────────────────────────────────────────────────────────────────

describe('computeCoverage — basic shape', () => {
  it('returns one TradeCoverage per tenant trade, even when the tenant has 0 rows', () => {
    const r = computeCoverage(['plumbing', 'electrical'], SHARED_ALL, [])
    expect(r.trades_active).toEqual(['plumbing', 'electrical'])
    expect(r.by_trade).toHaveLength(2)
    expect(r.by_trade[0].trade).toBe('plumbing')
    expect(r.by_trade[1].trade).toBe('electrical')
  })

  it('returns empty by_trade when the tenant has no trades', () => {
    const r = computeCoverage([], SHARED_ALL, [])
    expect(r.trades_active).toEqual([])
    expect(r.by_trade).toEqual([])
  })

  it('drops null/empty trade entries from tradesActive', () => {
    const r = computeCoverage(
      ['plumbing', '', null as unknown as string, '   '],
      SHARED_ALL,
      [],
    )
    expect(r.trades_active).toEqual(['plumbing'])
    expect(r.by_trade).toHaveLength(1)
  })

  it('normalises trade casing on input', () => {
    const r = computeCoverage(['PLUMBING'], SHARED_ALL, [])
    expect(r.trades_active).toEqual(['plumbing'])
  })
})

// ──────────────────────────────────────────────────────────────────────
// Per-trade rollup math
// ──────────────────────────────────────────────────────────────────────

describe('computeCoverage — per-trade rollup', () => {
  it('zero tenant rows → 0% coverage, all categories uncovered', () => {
    const r = computeCoverage(['plumbing'], SHARED_PLUMBING, [])
    const p = r.by_trade[0]
    expect(p.total_shared_categories).toBe(4) // hot_water, tap, drain, toilet
    expect(p.covered_categories).toBe(0)
    expect(p.uncovered_categories).toBe(4)
    expect(p.coverage_pct).toBe(0)
    // 3 + 2 + 1 + 1 = 7 missing shared rows
    expect(p.missing_rows_total).toBe(7)
  })

  it('one tenant row in one category → that category covered, others missing', () => {
    const r = computeCoverage(['plumbing'], SHARED_PLUMBING, [
      { trade: 'plumbing', category: 'hot_water', active: true },
    ])
    const p = r.by_trade[0]
    expect(p.covered_categories).toBe(1)
    expect(p.coverage_pct).toBe(25) // 1 of 4
    // 3 shared - 1 tenant = 2 missing in hot_water; + 2 tap + 1 drain + 1 toilet = 6 total
    expect(p.missing_rows_total).toBe(6)
    const hw = p.categories.find((c) => c.category === 'hot_water')!
    expect(hw.shared_count).toBe(3)
    expect(hw.tenant_count).toBe(1)
    expect(hw.missing_count).toBe(2)
    expect(hw.covered).toBe(true)
  })

  it('tenant has more rows than shared → missing_count clamps to 0', () => {
    const r = computeCoverage(['plumbing'], SHARED_PLUMBING, [
      { trade: 'plumbing', category: 'drain', active: true },
      { trade: 'plumbing', category: 'drain', active: true },
      { trade: 'plumbing', category: 'drain', active: true },
    ])
    const p = r.by_trade[0]
    const drain = p.categories.find((c) => c.category === 'drain')!
    expect(drain.shared_count).toBe(1)
    expect(drain.tenant_count).toBe(3)
    expect(drain.missing_count).toBe(0)
    expect(drain.covered).toBe(true)
  })

  it('tenant has a category not in the shared catalogue → reported but does NOT lower coverage_pct', () => {
    const r = computeCoverage(['plumbing'], SHARED_PLUMBING, [
      { trade: 'plumbing', category: 'cctv', active: true },
    ])
    const p = r.by_trade[0]
    // shared categories: 4 (hot_water, tap, drain, toilet)
    // tenant has 0 of those 4 covered → 0%
    expect(p.total_shared_categories).toBe(4)
    expect(p.covered_categories).toBe(0)
    expect(p.coverage_pct).toBe(0)
    // The cctv category appears in categories[] but shared_count is 0
    const cctv = p.categories.find((c) => c.category === 'cctv')!
    expect(cctv.shared_count).toBe(0)
    expect(cctv.tenant_count).toBe(1)
    expect(cctv.covered).toBe(true)
    expect(cctv.missing_count).toBe(0)
  })

  it('100% coverage when tenant has at least one row in every shared category', () => {
    const r = computeCoverage(['plumbing'], SHARED_PLUMBING, [
      { trade: 'plumbing', category: 'hot_water', active: true },
      { trade: 'plumbing', category: 'tap', active: true },
      { trade: 'plumbing', category: 'drain', active: true },
      { trade: 'plumbing', category: 'toilet', active: true },
    ])
    const p = r.by_trade[0]
    expect(p.coverage_pct).toBe(100)
    expect(p.covered_categories).toBe(4)
    expect(p.uncovered_categories).toBe(0)
  })

  it('rounds coverage_pct to the nearest integer', () => {
    // 3 of 4 shared categories covered = 75% — no rounding
    const r = computeCoverage(['plumbing'], SHARED_PLUMBING, [
      { trade: 'plumbing', category: 'hot_water', active: true },
      { trade: 'plumbing', category: 'tap', active: true },
      { trade: 'plumbing', category: 'drain', active: true },
    ])
    expect(r.by_trade[0].coverage_pct).toBe(75)
  })
})

// ──────────────────────────────────────────────────────────────────────
// Per-category breakdown
// ──────────────────────────────────────────────────────────────────────

describe('computeCoverage — per-category breakdown', () => {
  it('emits one CategoryCoverage per distinct shared category, sorted by slug', () => {
    const r = computeCoverage(['plumbing'], SHARED_PLUMBING, [])
    const slugs = r.by_trade[0].categories.map((c) => c.category)
    expect(slugs).toEqual(['drain', 'hot_water', 'tap', 'toilet'])
  })

  it('a covered category sets covered=true', () => {
    const r = computeCoverage(['plumbing'], SHARED_PLUMBING, [
      { trade: 'plumbing', category: 'hot_water', active: true },
    ])
    const p = r.by_trade[0]
    const hw = p.categories.find((c) => c.category === 'hot_water')!
    expect(hw.covered).toBe(true)
    const tap = p.categories.find((c) => c.category === 'tap')!
    expect(tap.covered).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────────────
// Active flag handling
// ──────────────────────────────────────────────────────────────────────

describe('computeCoverage — active flag', () => {
  it('treats active=true as present', () => {
    const r = computeCoverage(['plumbing'], SHARED_PLUMBING, [
      { trade: 'plumbing', category: 'hot_water', active: true },
    ])
    expect(r.by_trade[0].categories.find((c) => c.category === 'hot_water')!.tenant_count).toBe(1)
  })

  it('treats explicit active=false as absent', () => {
    const r = computeCoverage(['plumbing'], SHARED_PLUMBING, [
      { trade: 'plumbing', category: 'hot_water', active: false },
    ])
    expect(r.by_trade[0].categories.find((c) => c.category === 'hot_water')!.tenant_count).toBe(0)
    expect(r.by_trade[0].covered_categories).toBe(0)
  })

  it('treats missing active as present (default true)', () => {
    const r = computeCoverage(['plumbing'], SHARED_PLUMBING, [
      { trade: 'plumbing', category: 'hot_water' },
    ])
    expect(r.by_trade[0].categories.find((c) => c.category === 'hot_water')!.tenant_count).toBe(1)
  })

  it('treats active=null as present (matches dashboard convention)', () => {
    const r = computeCoverage(['plumbing'], SHARED_PLUMBING, [
      { trade: 'plumbing', category: 'hot_water', active: null },
    ])
    expect(r.by_trade[0].categories.find((c) => c.category === 'hot_water')!.tenant_count).toBe(1)
  })
})

// ──────────────────────────────────────────────────────────────────────
// Multi-trade isolation
// ──────────────────────────────────────────────────────────────────────

describe('computeCoverage — multi-trade isolation', () => {
  it('counts only the trade-matching rows for each trade rollup', () => {
    const tenantRows: TenantMaterialRow[] = [
      { trade: 'plumbing', category: 'hot_water', active: true },
      { trade: 'electrical', category: 'gpo', active: true },
    ]
    const r = computeCoverage(['plumbing', 'electrical'], SHARED_ALL, tenantRows)
    const plumbing = r.by_trade.find((t) => t.trade === 'plumbing')!
    const electrical = r.by_trade.find((t) => t.trade === 'electrical')!
    expect(plumbing.covered_categories).toBe(1)
    expect(electrical.covered_categories).toBe(1)
  })

  it('a tenant electrical row does NOT count against plumbing coverage', () => {
    const r = computeCoverage(['plumbing', 'electrical'], SHARED_ALL, [
      { trade: 'electrical', category: 'gpo', active: true },
    ])
    const plumbing = r.by_trade.find((t) => t.trade === 'plumbing')!
    expect(plumbing.covered_categories).toBe(0)
    expect(plumbing.coverage_pct).toBe(0)
  })
})

// ──────────────────────────────────────────────────────────────────────
// Bad/empty inputs
// ──────────────────────────────────────────────────────────────────────

describe('computeCoverage — bad input handling', () => {
  it('drops shared rows with null trade', () => {
    const r = computeCoverage(['plumbing'], [
      { trade: null, category: 'hot_water' },
      { trade: 'plumbing', category: 'hot_water' },
    ], [])
    expect(r.by_trade[0].categories.find((c) => c.category === 'hot_water')!.shared_count).toBe(1)
  })

  it('drops shared rows with null category', () => {
    const r = computeCoverage(['plumbing'], [
      { trade: 'plumbing', category: null },
      { trade: 'plumbing', category: 'hot_water' },
    ], [])
    expect(r.by_trade[0].total_shared_categories).toBe(1)
  })

  it('drops tenant rows with null trade or category', () => {
    const r = computeCoverage(['plumbing'], SHARED_PLUMBING, [
      { trade: null, category: 'hot_water', active: true },
      { trade: 'plumbing', category: null, active: true },
    ])
    expect(r.by_trade[0].covered_categories).toBe(0)
  })

  it('shared catalogue empty for a trade → coverage_pct is 0 (no division by zero)', () => {
    const r = computeCoverage(['plumbing'], [], [])
    expect(r.by_trade[0].coverage_pct).toBe(0)
    expect(r.by_trade[0].total_shared_categories).toBe(0)
  })
})

// ──────────────────────────────────────────────────────────────────────
// Dual-vocab normalisation — the bug fix (2026-05-27)
//
// Real production data uses GRANULAR vocab on shared_materials and
// GROUNDING vocab on tenant_material_catalogue. Before the fix,
// computeCoverage compared raw category strings and reported correctly-
// stocked tenant rows as missing because their grounding name didn't
// match the shared row's granular name.
//
// The cases verified here mirror what we saw on Atomic Electrical:
//   shared.ceiling_fan  ↔  tenant.fan          → must count as covered
//   shared.safety_switch ↔ tenant.rcbo         → must count as covered
//   shared.hws_electric  ↔ tenant.hot_water    → must count as covered
//   shared.tapware_basin ↔ tenant.tap          → must count as covered
//   shared.sundries      ↔ tenant.sundry       → must count as covered
//   shared.toilet_repair ↔ tenant.toilet       → must count as covered
// ──────────────────────────────────────────────────────────────────────

describe('computeCoverage — granular shared ↔ grounding tenant vocab', () => {
  it('maps shared.ceiling_fan to tenant.fan so a fan-stocked tradie is counted as covered', () => {
    const r = computeCoverage(
      ['electrical'],
      [
        { trade: 'electrical', category: 'ceiling_fan' },
        { trade: 'electrical', category: 'ceiling_fan' },
      ],
      [{ trade: 'electrical', category: 'fan', active: true }],
    )
    const e = r.by_trade[0]
    expect(e.covered_categories).toBe(1)
    expect(e.coverage_pct).toBe(100)
    const fan = e.categories.find((c) => c.category === 'fan')!
    expect(fan.shared_count).toBe(2)
    expect(fan.tenant_count).toBe(1)
    expect(fan.missing_count).toBe(1)
    expect(fan.covered).toBe(true)
  })

  it('maps shared.safety_switch to tenant.rcbo', () => {
    const r = computeCoverage(
      ['electrical'],
      [{ trade: 'electrical', category: 'safety_switch' }],
      [{ trade: 'electrical', category: 'rcbo', active: true }],
    )
    const rcbo = r.by_trade[0].categories.find((c) => c.category === 'rcbo')!
    expect(rcbo.covered).toBe(true)
    expect(rcbo.shared_count).toBe(1)
    expect(rcbo.tenant_count).toBe(1)
  })

  it('collapses hws_electric / hws_gas / hws_heat_pump into a single hot_water bucket', () => {
    const r = computeCoverage(
      ['plumbing'],
      [
        { trade: 'plumbing', category: 'hws_electric' },
        { trade: 'plumbing', category: 'hws_electric' },
        { trade: 'plumbing', category: 'hws_gas' },
        { trade: 'plumbing', category: 'hws_heat_pump' },
      ],
      [{ trade: 'plumbing', category: 'hot_water', active: true }],
    )
    const hw = r.by_trade[0].categories.find((c) => c.category === 'hot_water')!
    expect(hw.shared_count).toBe(4) // all three granular subcats fold in
    expect(hw.tenant_count).toBe(1)
    expect(hw.missing_count).toBe(3)
    expect(hw.covered).toBe(true)
    // No granular slugs leak through to the report
    const slugs = r.by_trade[0].categories.map((c) => c.category)
    expect(slugs).not.toContain('hws_electric')
    expect(slugs).not.toContain('hws_gas')
    expect(slugs).not.toContain('hws_heat_pump')
  })

  it('collapses tapware_basin / tapware_kitchen / tapware_laundry / tapware_outdoor into tap', () => {
    const r = computeCoverage(
      ['plumbing'],
      [
        { trade: 'plumbing', category: 'tapware_basin' },
        { trade: 'plumbing', category: 'tapware_kitchen' },
        { trade: 'plumbing', category: 'tapware_laundry' },
        { trade: 'plumbing', category: 'tapware_outdoor' },
      ],
      [{ trade: 'plumbing', category: 'tap', active: true }],
    )
    const tap = r.by_trade[0].categories.find((c) => c.category === 'tap')!
    expect(tap.shared_count).toBe(4)
    expect(tap.tenant_count).toBe(1)
    expect(tap.covered).toBe(true)
    // Make sure no granular tapware slug leaks
    const slugs = r.by_trade[0].categories.map((c) => c.category)
    expect(slugs.filter((s) => s.startsWith('tapware'))).toEqual([])
  })

  it('maps shared.sundries to tenant.sundry', () => {
    const r = computeCoverage(
      ['electrical'],
      [{ trade: 'electrical', category: 'sundries' }],
      [{ trade: 'electrical', category: 'sundry', active: true }],
    )
    const sundry = r.by_trade[0].categories.find((c) => c.category === 'sundry')!
    expect(sundry.covered).toBe(true)
  })

  it('maps shared.toilet_repair to tenant.toilet', () => {
    const r = computeCoverage(
      ['plumbing'],
      [
        { trade: 'plumbing', category: 'toilet' },
        { trade: 'plumbing', category: 'toilet_repair' }, // folds into toilet
      ],
      [{ trade: 'plumbing', category: 'toilet', active: true }],
    )
    const toilet = r.by_trade[0].categories.find((c) => c.category === 'toilet')!
    expect(toilet.shared_count).toBe(2) // toilet + toilet_repair folded
    expect(toilet.tenant_count).toBe(1)
    expect(toilet.covered).toBe(true)
  })

  it('Atomic Electrical regression — all 6 catalogue rows are counted as covered (was 4 of 7)', () => {
    // Mirrors the actual prod data from the bug report:
    //   shared_materials has 7 distinct electrical categories
    //     (ceiling_fan, sundries, safety_switch, gpo, downlight, outdoor_light, smoke_alarm)
    //   Atomic's tenant_material_catalogue has 6 rows across grounding categories
    //     (fan, gpo, downlight, smoke_alarm, rcbo, outdoor_light)
    // Pre-fix: coverage was 4/7 (57%) — fan + rcbo dropped due to vocab mismatch.
    // Post-fix: coverage should be 6/7 (86%) — only sundry is genuinely missing.
    const r = computeCoverage(
      ['electrical'],
      [
        { trade: 'electrical', category: 'ceiling_fan' },
        { trade: 'electrical', category: 'ceiling_fan' },
        { trade: 'electrical', category: 'sundries' },
        { trade: 'electrical', category: 'sundries' },
        { trade: 'electrical', category: 'safety_switch' },
        { trade: 'electrical', category: 'gpo' },
        { trade: 'electrical', category: 'gpo' },
        { trade: 'electrical', category: 'gpo' },
        { trade: 'electrical', category: 'gpo' },
        { trade: 'electrical', category: 'downlight' },
        { trade: 'electrical', category: 'downlight' },
        { trade: 'electrical', category: 'downlight' },
        { trade: 'electrical', category: 'downlight' },
        { trade: 'electrical', category: 'outdoor_light' },
        { trade: 'electrical', category: 'outdoor_light' },
        { trade: 'electrical', category: 'smoke_alarm' },
        { trade: 'electrical', category: 'smoke_alarm' },
      ],
      [
        { trade: 'electrical', category: 'fan', active: true },
        { trade: 'electrical', category: 'gpo', active: true },
        { trade: 'electrical', category: 'downlight', active: true },
        { trade: 'electrical', category: 'smoke_alarm', active: true },
        { trade: 'electrical', category: 'rcbo', active: true },
        { trade: 'electrical', category: 'outdoor_light', active: true },
      ],
    )
    const e = r.by_trade[0]
    expect(e.total_shared_categories).toBe(7) // 7 distinct grounding cats
    expect(e.covered_categories).toBe(6) // sundry is the only uncovered
    expect(e.coverage_pct).toBe(86) // 6/7 rounded
    // sundry should be the only uncovered category
    const sundry = e.categories.find((c) => c.category === 'sundry')!
    expect(sundry.covered).toBe(false)
    expect(sundry.shared_count).toBe(2)
    expect(sundry.tenant_count).toBe(0)
  })
})
