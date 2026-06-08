# Volumetric Air-Conditioning Recommender Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tradie-facing dashboard tool that turns a few property questions (rooms, ceiling height, location) into an indicative ducted-vs-split air-conditioning recommendation with a price range and a "book a site assessment" call to action.

**Architecture:** A new self-contained deterministic trade slice `lib/aircon/` — a fork of the existing painting/roofing pattern, NOT the Opus estimator. Pure engine (`climate` → `sizing` → `recommend`) behind a zod-validated API route, surfaced as a dashboard tab. Every number is a range with a confidence band; everything routes to a site assessment.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod 4, Vitest 4, Supabase (auth + pricing_book overlay), `pg` for the migration.

**Spec:** [2026-06-08-aircon-volumetric-recommender-design.md](../specs/2026-06-08-aircon-volumetric-recommender-design.md)

---

## Conventions for this plan

- All commands run from the **`quotemate-automation/`** directory.
- Run a single test file with: `npx vitest run lib/aircon/<file>.test.ts`
- Typecheck with: `npx tsc --noEmit`
- The `@/` import alias maps to the `quotemate-automation/` root (e.g. `@/lib/aircon/types`).
- Before starting, create a feature branch: `git checkout -b feat/aircon-recommender` (do not work on `main`).
- End every commit message with the repo trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- TDD: write the failing test, watch it fail, implement minimally, watch it pass, commit.

## File structure (locked)

| File | Responsibility |
|---|---|
| `lib/aircon/types.ts` | All shared types. No logic. |
| `lib/aircon/climate.ts` | postcode + state → climate zone + note. Pure, static data. |
| `lib/aircon/sizing.ts` | inputs → per-room kW + totals + confidence band. Pure. |
| `lib/aircon/recommend.ts` | sizing → ducted/split options + pricing + routing. Pure. Holds `DEFAULT_AC_RATE_CARD`. |
| `lib/aircon/request-schema.ts` | Zod validation for the HTTP boundary. |
| `app/api/aircon/recommend/route.ts` | HTTP boundary: auth, parse, overlay, run engine. |
| `app/dashboard/aircon/page.tsx` | Dashboard tool UI (form + result). |
| `app/dashboard/page.tsx` | Add a hub Link to `/dashboard/aircon` (one small edit). |
| `sql/migrations/097_aircon_trade_phase1.sql` | Register `aircon` trade + forward-looking seed. |
| `scripts/run-migration-097.mjs` | Apply the migration. |

---

## Task 1: Shared types (`lib/aircon/types.ts`)

**Files:**
- Create: `lib/aircon/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// ════════════════════════════════════════════════════════════════════
// Air-conditioning trade — shared types (Phase 1).
//
// A self-contained deterministic slice, like painting/roofing. The
// money path is a rate card, NOT the strict-grounding Opus estimator.
// Pipeline: climate.ts → sizing.ts → recommend.ts. PURE TYPES, no I/O.
// ════════════════════════════════════════════════════════════════════

export type AusState = 'NSW' | 'VIC' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'ACT' | 'NT'

/** Coarse climate grouping (from NCC zones) → drives kW/m². */
export type ClimateZone = 'cool' | 'temperate' | 'subtropical' | 'tropical'

export type CeilingHeight = 'standard' | 'high' | 'raked'
export type Insulation = 'good' | 'average' | 'poor' | 'unknown'
export type CurrentSituation = 'none' | 'replacing' | 'adding'

/** Confidence in the derived sizing → band width + routing reason. */
export type AcConfidence = 'high' | 'medium' | 'low'

/** Only conditioned room kinds are modelled; bathrooms are excluded. */
export type RoomType = 'bedroom' | 'living'

export type AcAddressInput = {
  address: string
  postcode: string
  state: AusState
}

/** What the tradie types into the form. */
export type AcPropertyInputs = {
  bedrooms: number
  bathrooms: number
  living_spaces: number
  /** Internal floor area in m². When present, pins confidence to high. */
  floor_area_m2?: number | null
  ceiling_height: CeilingHeight
  insulation: Insulation
  current_situation: CurrentSituation
  /** Optional customer budget — nudges ducted vs split + routing. */
  budget?: number | null
}

export type RoomLoad = {
  room_type: RoomType
  area_m2: number
  kw: number
}

/** Deterministic sizing output. */
export type AcSizing = {
  rooms: RoomLoad[]
  conditioned_zones: number
  total_floor_area_m2: number
  /** floor area × ceiling height — Jon's "volumetric box" explainer. */
  total_volume_m3: number
  ceiling_height_m: number
  connected_kw: number
  connected_kw_low: number
  connected_kw_high: number
  /** connected × diversity factor — the central-unit size for ducted. */
  ducted_kw: number
  confidence: AcConfidence
  notes: string[]
}

export type AcSystemType = 'ducted' | 'split'

/** Indicative inc-GST price band. */
export type AcPriceRange = {
  low: number
  high: number
}

export type AcOption = {
  system_type: AcSystemType
  capacity_kw: number
  price: AcPriceRange
  best_fit: boolean
  pros: string[]
  cons: string[]
}

/** Indicative posture: there is only ever one decision. */
export type AcRoutingDecision = {
  decision: 'book_assessment'
  reason: string
}

export type AcRecommendation = {
  sizing: AcSizing
  /** Always two options, ordered [ducted, split]. */
  options: AcOption[]
  routing: AcRoutingDecision
  confidence: AcConfidence
}

// ── Rate card (per-tenant overridable via pricing_book.overlays) ──────

export type AcSplitRates = {
  /** Supply+install $ ex-GST per indoor head, keyed by kW band string. */
  per_head: Record<string, number>
  /** Discount applied when 2+ heads. 0.08 = 8% off. */
  multi_head_discount_pct: number
}

export type AcDuctedRates = {
  rate_per_kw: number
  base_ex_gst: number
  per_zone: number
  min_ex_gst: number
}

export type AcRateCard = {
  split: AcSplitRates
  ducted: AcDuctedRates
  gst_registered: boolean
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors referencing `lib/aircon/types.ts`).

- [ ] **Step 3: Commit**

```bash
git add lib/aircon/types.ts
git commit -m "feat(aircon): shared types for the AC recommender slice"
```

---

## Task 2: Climate zone lookup (`lib/aircon/climate.ts`)

**Files:**
- Create: `lib/aircon/climate.ts`
- Test: `lib/aircon/climate.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest'
import { climateZoneForPostcode } from './climate'

describe('climateZoneForPostcode', () => {
  it('maps Darwin (NT) to tropical', () => {
    expect(climateZoneForPostcode('0800', 'NT').zone).toBe('tropical')
  })
  it('maps Cairns (far north QLD) to tropical', () => {
    expect(climateZoneForPostcode('4870', 'QLD').zone).toBe('tropical')
  })
  it('maps Brisbane (QLD) to subtropical', () => {
    expect(climateZoneForPostcode('4000', 'QLD').zone).toBe('subtropical')
  })
  it('maps Sydney (NSW) to temperate', () => {
    expect(climateZoneForPostcode('2000', 'NSW').zone).toBe('temperate')
  })
  it('maps Hobart (TAS) to cool', () => {
    expect(climateZoneForPostcode('7000', 'TAS').zone).toBe('cool')
  })
  it('maps Perth (WA) to temperate', () => {
    expect(climateZoneForPostcode('6000', 'WA').zone).toBe('temperate')
  })
  it('returns a non-empty provenance note', () => {
    expect(climateZoneForPostcode('2000', 'NSW').note.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/aircon/climate.test.ts`
Expected: FAIL — "Cannot find module './climate'" / `climateZoneForPostcode is not a function`.

- [ ] **Step 3: Write the implementation**

```typescript
// ════════════════════════════════════════════════════════════════════
// Air-conditioning — climate zone resolver.
//
// SIMPLIFIED v1: a state + postcode-range heuristic grouped from the
// NCC's 8 climate zones into 4 cooling-load buckets. This is an
// approximation flagged for calibration in the design spec (§12) — the
// real NCC zone-by-postcode table is a future data import. PURE.
// ════════════════════════════════════════════════════════════════════

import type { AusState, ClimateZone } from './types'

export function climateZoneForPostcode(
  postcode: string,
  state: AusState,
): { zone: ClimateZone; note: string } {
  const pc = Number.parseInt(postcode, 10)
  const zone = resolveZone(pc, state)
  return {
    zone,
    note: `Climate zone "${zone}" inferred from ${state} ${postcode} (simplified v1 mapping — confirm on site).`,
  }
}

function resolveZone(pc: number, state: AusState): ClimateZone {
  switch (state) {
    case 'NT':
      return 'tropical'
    case 'TAS':
      return 'cool'
    case 'QLD':
      return pc >= 4700 ? 'tropical' : 'subtropical'
    case 'WA':
      if (pc >= 6700) return 'tropical'
      if (pc <= 6199) return 'temperate'
      return 'subtropical'
    case 'NSW':
      if (pc >= 2480 && pc <= 2489) return 'subtropical' // far north coast
      if (pc >= 2625 && pc <= 2627) return 'cool' // Snowy / alpine
      return 'temperate'
    case 'VIC':
    case 'SA':
    case 'ACT':
      return 'temperate'
    default:
      return 'temperate'
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/aircon/climate.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/aircon/climate.ts lib/aircon/climate.test.ts
git commit -m "feat(aircon): climate zone resolver (state + postcode heuristic)"
```

---

## Task 3: Sizing engine (`lib/aircon/sizing.ts`)

**Files:**
- Create: `lib/aircon/sizing.ts`
- Test: `lib/aircon/sizing.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest'
import { sizeAircon, roundUpToUnit, roundUpHalf, CONFIDENCE_BAND } from './sizing'
import type { AcPropertyInputs } from './types'

function baseInputs(overrides: Partial<AcPropertyInputs> = {}): AcPropertyInputs {
  return {
    bedrooms: 3,
    bathrooms: 2,
    living_spaces: 2,
    ceiling_height: 'standard',
    insulation: 'average',
    current_situation: 'replacing',
    ...overrides,
  }
}

describe('sizeAircon', () => {
  it('counts conditioned zones as bedrooms + living spaces (bathrooms excluded)', () => {
    const s = sizeAircon('temperate', baseInputs())
    expect(s.conditioned_zones).toBe(5) // 3 + 2
    expect(s.rooms).toHaveLength(5)
  })

  it('pins confidence high and uses the supplied floor area', () => {
    const s = sizeAircon('temperate', baseInputs({ floor_area_m2: 180 }))
    expect(s.confidence).toBe('high')
    expect(s.total_floor_area_m2).toBe(180)
  })

  it('uses medium confidence for counts-only with both beds and living', () => {
    const s = sizeAircon('temperate', baseInputs({ floor_area_m2: null }))
    expect(s.confidence).toBe('medium')
  })

  it('drops to low confidence when only one of beds/living is given', () => {
    const s = sizeAircon('temperate', baseInputs({ bedrooms: 3, living_spaces: 0 }))
    expect(s.confidence).toBe('low')
  })

  it('computes volume as floor area × ceiling height', () => {
    const s = sizeAircon('temperate', baseInputs({ floor_area_m2: 100, ceiling_height: 'standard' }))
    expect(s.total_volume_m3).toBe(240) // 100 × 2.4
  })

  it('ducted size is connected × 0.8 diversity', () => {
    const s = sizeAircon('temperate', baseInputs({ floor_area_m2: 180 }))
    expect(s.ducted_kw).toBeCloseTo(s.connected_kw * 0.8, 2)
  })

  it('hotter climate yields more kW than cooler for the same home', () => {
    const cool = sizeAircon('cool', baseInputs({ floor_area_m2: 150 }))
    const tropical = sizeAircon('tropical', baseInputs({ floor_area_m2: 150 }))
    expect(tropical.connected_kw).toBeGreaterThan(cool.connected_kw)
  })

  it('applies the confidence band to the connected-kW range', () => {
    const s = sizeAircon('temperate', baseInputs({ floor_area_m2: 150 }))
    const band = CONFIDENCE_BAND[s.confidence]
    expect(s.connected_kw_low).toBeCloseTo(s.connected_kw * (1 - band), 2)
    expect(s.connected_kw_high).toBeCloseTo(s.connected_kw * (1 + band), 2)
  })
})

describe('roundUpToUnit', () => {
  it('rounds up to the next common AU split size', () => {
    expect(roundUpToUnit(1.2)).toBe(2.5)
    expect(roundUpToUnit(2.6)).toBe(3.5)
    expect(roundUpToUnit(4.9)).toBe(5)
  })
  it('caps at the largest single-head size', () => {
    expect(roundUpToUnit(12)).toBe(8)
  })
})

describe('roundUpHalf', () => {
  it('rounds up to the nearest 0.5 kW', () => {
    expect(roundUpHalf(9.1)).toBe(9.5)
    expect(roundUpHalf(10)).toBe(10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/aircon/sizing.test.ts`
Expected: FAIL — "Cannot find module './sizing'".

- [ ] **Step 3: Write the implementation**

```typescript
// ════════════════════════════════════════════════════════════════════
// Air-conditioning — deterministic sizing engine.
//
// Inputs → per-room cooling/heating load (kW) → totals + a confidence
// band. Floor-area basis: kW = area × climate_factor × room_type ×
// ceiling × insulation. Volume is computed only as an explainer. PURE —
// no I/O, fully unit-testable. Mirrors lib/painting/area.ts.
// ════════════════════════════════════════════════════════════════════

import type {
  AcConfidence,
  AcPropertyInputs,
  AcSizing,
  CeilingHeight,
  ClimateZone,
  Insulation,
  RoomLoad,
  RoomType,
} from './types'

/** AU typical room floor areas (m²) — used only when no floor area given. */
const TYPICAL_ROOM_M2: Record<RoomType, number> = { bedroom: 12, living: 25 }

/** kW per m² (living-area basis) by climate group. Calibrate over time. */
const CLIMATE_FACTOR: Record<ClimateZone, number> = {
  cool: 0.13,
  temperate: 0.15,
  subtropical: 0.17,
  tropical: 0.2,
}

/** Per-room-type load adjustment (bedrooms cooler/less glazing). */
const ROOM_TYPE_FACTOR: Record<RoomType, number> = { bedroom: 0.7, living: 1.0 }

const CEILING_HEIGHT_M: Record<CeilingHeight, number> = {
  standard: 2.4,
  high: 2.7,
  raked: 2.7,
}

const CEILING_MULT: Record<CeilingHeight, number> = {
  standard: 1.0,
  high: 1.1,
  raked: 1.15,
}

const INSULATION_MULT: Record<Insulation, number> = {
  good: 0.9,
  average: 1.0,
  poor: 1.15,
  unknown: 1.05,
}

/** Confidence → ± fraction of the band (matches painting's tiers). */
export const CONFIDENCE_BAND: Record<AcConfidence, number> = {
  high: 0.12,
  medium: 0.25,
  low: 0.4,
}

/** Zones don't all peak at once — ducted central unit is sized below sum. */
const DIVERSITY_FACTOR = 0.8

/** Common AU single-head split sizes (kW). */
const AC_UNIT_SIZES = [2.5, 3.5, 5.0, 7.0, 8.0]

/** PURE — round to N decimal places. */
export function roundTo(n: number, dp: number): number {
  if (!Number.isFinite(n)) return 0
  const f = Math.pow(10, dp)
  return Math.round(n * f) / f
}

/** PURE — smallest standard split size ≥ kw, capped at the largest. */
export function roundUpToUnit(kw: number): number {
  for (const u of AC_UNIT_SIZES) if (kw <= u) return u
  return AC_UNIT_SIZES[AC_UNIT_SIZES.length - 1]
}

/** PURE — round up to the nearest 0.5 kW (ducted central unit sizing). */
export function roundUpHalf(kw: number): number {
  return Math.ceil(kw * 2) / 2
}

export function sizeAircon(zone: ClimateZone, inputs: AcPropertyInputs): AcSizing {
  const ceilingHeightM = CEILING_HEIGHT_M[inputs.ceiling_height]
  const ceilingMult = CEILING_MULT[inputs.ceiling_height]
  const insulationMult = INSULATION_MULT[inputs.insulation]
  const climateFactor = CLIMATE_FACTOR[zone]

  const bedrooms = Math.max(0, Math.floor(inputs.bedrooms))
  const living = Math.max(0, Math.floor(inputs.living_spaces))

  const roomSpecs: RoomType[] = [
    ...Array.from({ length: bedrooms }, () => 'bedroom' as RoomType),
    ...Array.from({ length: living }, () => 'living' as RoomType),
  ]

  const typicalTotal = roomSpecs.reduce((acc, t) => acc + TYPICAL_ROOM_M2[t], 0)

  const hasFloorArea =
    typeof inputs.floor_area_m2 === 'number' &&
    Number.isFinite(inputs.floor_area_m2) &&
    (inputs.floor_area_m2 as number) > 0

  const notes: string[] = []
  let confidence: AcConfidence
  let totalFloorArea: number

  if (hasFloorArea) {
    totalFloorArea = roundTo(inputs.floor_area_m2 as number, 1)
    confidence = 'high'
    notes.push(
      `Floor area entered by hand (${totalFloorArea} m²) — apportioned across rooms by typical size.`,
    )
  } else {
    totalFloorArea = roundTo(typicalTotal, 1)
    confidence = bedrooms > 0 && living > 0 ? 'medium' : 'low'
    notes.push(
      `No floor area supplied — estimated from room counts using AU typical room sizes (${totalFloorArea} m²).`,
    )
  }

  const scale = hasFloorArea && typicalTotal > 0 ? totalFloorArea / typicalTotal : 1
  const band = CONFIDENCE_BAND[confidence]

  const rooms: RoomLoad[] = roomSpecs.map((t) => {
    const area = roundTo(TYPICAL_ROOM_M2[t] * scale, 1)
    const kw = roundTo(
      area * climateFactor * ROOM_TYPE_FACTOR[t] * ceilingMult * insulationMult,
      2,
    )
    return { room_type: t, area_m2: area, kw }
  })

  const connectedKw = roundTo(
    rooms.reduce((acc, r) => acc + r.kw, 0),
    2,
  )
  const ductedKw = roundTo(connectedKw * DIVERSITY_FACTOR, 2)
  const totalVolume = roundTo(totalFloorArea * ceilingHeightM, 1)

  notes.push(
    `Each room kW = area × ${climateFactor} (climate) × room-type × ${ceilingMult} (ceiling) × ${insulationMult} (insulation).`,
  )
  notes.push(
    `Ducted size = connected ${connectedKw} kW × ${DIVERSITY_FACTOR} diversity = ${ductedKw} kW.`,
  )

  return {
    rooms,
    conditioned_zones: roomSpecs.length,
    total_floor_area_m2: totalFloorArea,
    total_volume_m3: totalVolume,
    ceiling_height_m: ceilingHeightM,
    connected_kw: connectedKw,
    connected_kw_low: roundTo(connectedKw * (1 - band), 2),
    connected_kw_high: roundTo(connectedKw * (1 + band), 2),
    ducted_kw: ductedKw,
    confidence,
    notes,
  }
}

export const __test_only__ = {
  TYPICAL_ROOM_M2,
  CLIMATE_FACTOR,
  ROOM_TYPE_FACTOR,
  CEILING_MULT,
  INSULATION_MULT,
  DIVERSITY_FACTOR,
  AC_UNIT_SIZES,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/aircon/sizing.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/aircon/sizing.ts lib/aircon/sizing.test.ts
git commit -m "feat(aircon): deterministic floor-area × climate sizing engine"
```

---

## Task 4: Recommendation + pricing (`lib/aircon/recommend.ts`)

**Files:**
- Create: `lib/aircon/recommend.ts`
- Test: `lib/aircon/recommend.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest'
import { sizeAircon } from './sizing'
import { recommendAircon, DEFAULT_AC_RATE_CARD, mergeAcRateCard } from './recommend'
import type { AcPropertyInputs } from './types'

function inputs(overrides: Partial<AcPropertyInputs> = {}): AcPropertyInputs {
  return {
    bedrooms: 3,
    bathrooms: 2,
    living_spaces: 2,
    ceiling_height: 'standard',
    insulation: 'average',
    current_situation: 'replacing',
    floor_area_m2: 180,
    ...overrides,
  }
}

function recommend(overrides: Partial<AcPropertyInputs> = {}) {
  const i = inputs(overrides)
  const sizing = sizeAircon('temperate', i)
  return recommendAircon({ sizing, inputs: i })
}

describe('recommendAircon', () => {
  it('always returns both options, ordered ducted then split', () => {
    const r = recommend()
    expect(r.options.map((o) => o.system_type)).toEqual(['ducted', 'split'])
  })

  it('always routes to a site assessment', () => {
    expect(recommend().routing.decision).toBe('book_assessment')
  })

  it('prefers ducted for a large multi-zone home', () => {
    const r = recommend({ bedrooms: 4, living_spaces: 2, floor_area_m2: 240 })
    const ducted = r.options.find((o) => o.system_type === 'ducted')!
    expect(ducted.best_fit).toBe(true)
  })

  it('prefers split for a small home', () => {
    const r = recommend({ bedrooms: 1, living_spaces: 1, floor_area_m2: 60 })
    const split = r.options.find((o) => o.system_type === 'split')!
    expect(split.best_fit).toBe(true)
  })

  it('marks exactly one option as best fit', () => {
    const r = recommend()
    expect(r.options.filter((o) => o.best_fit)).toHaveLength(1)
  })

  it('produces an inc-GST price range (low < high) for both options', () => {
    for (const o of recommend().options) {
      expect(o.price.low).toBeGreaterThan(0)
      expect(o.price.high).toBeGreaterThan(o.price.low)
    }
  })

  it('gives a raked-ceiling-specific assessment reason', () => {
    const r = recommend({ ceiling_height: 'raked' })
    expect(r.routing.reason.toLowerCase()).toContain('raked')
  })

  it('flags a budget below both options', () => {
    const r = recommend({ budget: 500 })
    expect(r.routing.reason.toLowerCase()).toContain('budget')
  })
})

describe('mergeAcRateCard', () => {
  it('returns the default when overlay is missing', () => {
    expect(mergeAcRateCard(null)).toEqual(DEFAULT_AC_RATE_CARD)
  })
  it('shallow-merges a ducted override', () => {
    const merged = mergeAcRateCard({ ducted: { rate_per_kw: 1300 } })
    expect(merged.ducted.rate_per_kw).toBe(1300)
    expect(merged.ducted.base_ex_gst).toBe(DEFAULT_AC_RATE_CARD.ducted.base_ex_gst)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/aircon/recommend.test.ts`
Expected: FAIL — "Cannot find module './recommend'".

- [ ] **Step 3: Write the implementation**

```typescript
// ════════════════════════════════════════════════════════════════════
// Air-conditioning — recommendation + indicative pricing.
//
// sizing → ducted + split options (both always shown), a best-fit flag,
// and a routing decision. Indicative posture: every result routes to a
// site assessment. PURE. Mirrors lib/painting/pricing.ts.
// ════════════════════════════════════════════════════════════════════

import {
  CONFIDENCE_BAND,
  roundTo,
  roundUpHalf,
  roundUpToUnit,
} from './sizing'
import type {
  AcOption,
  AcPriceRange,
  AcPropertyInputs,
  AcRateCard,
  AcRecommendation,
  AcRoutingDecision,
  AcSizing,
} from './types'

export const DEFAULT_AC_RATE_CARD: AcRateCard = {
  split: {
    per_head: { '2.5': 1100, '3.5': 1400, '5': 1900, '7': 2600, '8': 3000 },
    multi_head_discount_pct: 0.08,
  },
  ducted: { rate_per_kw: 1100, base_ex_gst: 4000, per_zone: 350, min_ex_gst: 8000 },
  gst_registered: true,
}

/** PURE — round a dollar figure to the nearest $100 (indicative). */
function roundMoney(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n / 100) * 100
}

/** PURE — ex-GST point → inc-GST low/high band. */
function priceRange(exGst: number, band: number, gstRegistered: boolean): AcPriceRange {
  const gst = gstRegistered ? 1.1 : 1.0
  return {
    low: roundMoney(exGst * (1 - band) * gst),
    high: roundMoney(exGst * (1 + band) * gst),
  }
}

function buildSplitOption(sizing: AcSizing, rateCard: AcRateCard, band: number): AcOption {
  let exGst = 0
  let capacity = 0
  for (const room of sizing.rooms) {
    const headKw = roundUpToUnit(room.kw)
    capacity += headKw
    exGst += rateCard.split.per_head[String(headKw)] ?? rateCard.split.per_head['8'] ?? 0
  }
  if (sizing.rooms.length >= 2) exGst *= 1 - rateCard.split.multi_head_discount_pct
  return {
    system_type: 'split',
    capacity_kw: roundTo(capacity, 1),
    price: priceRange(exGst, band, rateCard.gst_registered),
    best_fit: false,
    pros: ['Lower upfront cost', 'Independent per-room control', 'Can be installed in stages'],
    cons: ['A visible indoor head in each room', 'Less tidy than ducted for whole-home cooling'],
  }
}

function buildDuctedOption(sizing: AcSizing, rateCard: AcRateCard, band: number): AcOption {
  const capacity = roundUpHalf(sizing.ducted_kw)
  const zones = sizing.conditioned_zones
  const exGst = Math.max(
    rateCard.ducted.min_ex_gst,
    rateCard.ducted.base_ex_gst +
      rateCard.ducted.rate_per_kw * capacity +
      rateCard.ducted.per_zone * zones,
  )
  return {
    system_type: 'ducted',
    capacity_kw: capacity,
    price: priceRange(exGst, band, rateCard.gst_registered),
    best_fit: false,
    pros: ['Whole-home climate control', 'Hidden ductwork — tidy finish', 'One system for the house'],
    cons: ['Higher upfront cost', 'Needs roof/ceiling space for ducts', 'Best installed in one go'],
  }
}

function decideRouting(
  sizing: AcSizing,
  inputs: AcPropertyInputs,
  options: { ducted: AcOption; split: AcOption },
): AcRoutingDecision {
  if (inputs.ceiling_height === 'raked') {
    return {
      decision: 'book_assessment',
      reason:
        'Raked/cathedral ceilings change the load and duct routing — confirm on site before ordering.',
    }
  }
  if (sizing.confidence === 'low') {
    return {
      decision: 'book_assessment',
      reason:
        'Sizing is a rough estimate from limited inputs — a site assessment will confirm capacity and price.',
    }
  }
  if (sizing.connected_kw >= 14) {
    return {
      decision: 'book_assessment',
      reason:
        'The estimated load is large enough to likely need 3-phase power — confirm the supply on site.',
    }
  }
  const cheapest = Math.min(options.ducted.price.low, options.split.price.low)
  if (typeof inputs.budget === 'number' && inputs.budget > 0 && inputs.budget < cheapest) {
    return {
      decision: 'book_assessment',
      reason:
        'Your budget is below the indicative range for either system — a site visit can find the best option for your budget.',
    }
  }
  return {
    decision: 'book_assessment',
    reason:
      'Indicative sizing and pricing — every AC install needs a site assessment to confirm capacity, access and a firm quote.',
  }
}

export function recommendAircon(args: {
  sizing: AcSizing
  inputs: AcPropertyInputs
  rateCard?: AcRateCard
}): AcRecommendation {
  const rateCard = args.rateCard ?? DEFAULT_AC_RATE_CARD
  const { sizing, inputs } = args
  const band = CONFIDENCE_BAND[sizing.confidence]

  const ducted = buildDuctedOption(sizing, rateCard, band)
  const split = buildSplitOption(sizing, rateCard, band)

  const preferDucted =
    sizing.conditioned_zones >= 4 ||
    sizing.total_floor_area_m2 >= 150 ||
    (sizing.conditioned_zones >= 3 &&
      typeof inputs.budget === 'number' &&
      inputs.budget >= ducted.price.low)
  ducted.best_fit = preferDucted
  split.best_fit = !preferDucted

  const routing = decideRouting(sizing, inputs, { ducted, split })

  return { sizing, options: [ducted, split], routing, confidence: sizing.confidence }
}

/** PURE — shallow-merge a pricing_book overlay onto the default card. */
export function mergeAcRateCard(overlay: unknown): AcRateCard {
  const base = DEFAULT_AC_RATE_CARD
  if (!overlay || typeof overlay !== 'object') return base
  const o = overlay as Partial<AcRateCard>
  return {
    split: {
      per_head: { ...base.split.per_head, ...(o.split?.per_head ?? {}) },
      multi_head_discount_pct:
        typeof o.split?.multi_head_discount_pct === 'number'
          ? o.split.multi_head_discount_pct
          : base.split.multi_head_discount_pct,
    },
    ducted: { ...base.ducted, ...(o.ducted ?? {}) },
    gst_registered:
      typeof o.gst_registered === 'boolean' ? o.gst_registered : base.gst_registered,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/aircon/recommend.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/aircon/recommend.ts lib/aircon/recommend.test.ts
git commit -m "feat(aircon): ducted-vs-split recommendation + indicative pricing"
```

---

## Task 5: Request schema (`lib/aircon/request-schema.ts`)

**Files:**
- Create: `lib/aircon/request-schema.ts`
- Test: `lib/aircon/request-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest'
import { RecommendRequestSchema } from './request-schema'

const valid = {
  address: { address: '12 Smith St, Brisbane', postcode: '4000', state: 'QLD' },
  inputs: {
    bedrooms: 3,
    bathrooms: 2,
    living_spaces: 2,
    floor_area_m2: 180,
    ceiling_height: 'standard',
    insulation: 'average',
    current_situation: 'replacing',
    budget: 12000,
  },
}

describe('RecommendRequestSchema', () => {
  it('accepts a well-formed request', () => {
    expect(RecommendRequestSchema.safeParse(valid).success).toBe(true)
  })
  it('rejects a non-4-digit postcode', () => {
    const bad = { ...valid, address: { ...valid.address, postcode: '40' } }
    expect(RecommendRequestSchema.safeParse(bad).success).toBe(false)
  })
  it('rejects a home with no bedrooms and no living spaces', () => {
    const bad = { ...valid, inputs: { ...valid.inputs, bedrooms: 0, living_spaces: 0 } }
    expect(RecommendRequestSchema.safeParse(bad).success).toBe(false)
  })
  it('accepts omitted optional floor area and budget', () => {
    const { floor_area_m2, budget, ...rest } = valid.inputs
    const ok = { ...valid, inputs: rest }
    expect(RecommendRequestSchema.safeParse(ok).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/aircon/request-schema.test.ts`
Expected: FAIL — "Cannot find module './request-schema'".

- [ ] **Step 3: Write the implementation**

```typescript
// ════════════════════════════════════════════════════════════════════
// Air-conditioning — HTTP request validation. Mirrors
// lib/painting/request-schema.ts. Kept separate from the route so it is
// unit-testable without a Next handler.
// ════════════════════════════════════════════════════════════════════

import { z } from 'zod'

export const AcAddressSchema = z.object({
  address: z.string().min(3).max(300),
  postcode: z.string().regex(/^\d{4}$/, 'AU postcode is 4 digits'),
  state: z.enum(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']),
})

export const AcInputsSchema = z
  .object({
    bedrooms: z.number().int().min(0).max(20),
    bathrooms: z.number().int().min(0).max(20),
    living_spaces: z.number().int().min(0).max(20),
    floor_area_m2: z.number().positive().max(2000).optional().nullable(),
    ceiling_height: z.enum(['standard', 'high', 'raked']),
    insulation: z.enum(['good', 'average', 'poor', 'unknown']),
    current_situation: z.enum(['none', 'replacing', 'adding']),
    budget: z.number().positive().max(200000).optional().nullable(),
  })
  .refine((d) => d.bedrooms + d.living_spaces >= 1, {
    message: 'Enter at least one bedroom or living space',
    path: ['living_spaces'],
  })

export const RecommendRequestSchema = z.object({
  address: AcAddressSchema,
  inputs: AcInputsSchema,
})

export type RecommendRequest = z.infer<typeof RecommendRequestSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/aircon/request-schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/aircon/request-schema.ts lib/aircon/request-schema.test.ts
git commit -m "feat(aircon): zod request schema for the recommend endpoint"
```

---

## Task 6: API route (`app/api/aircon/recommend/route.ts`)

**Files:**
- Create: `app/api/aircon/recommend/route.ts`

This is an I/O boundary (auth + DB), verified by typecheck + a manual curl rather than a unit test — matching the repo's painting route, which has no unit test.

- [ ] **Step 1: Write the route**

```typescript
// POST /api/aircon/recommend — runs property inputs through the AC
// sizing + recommendation engine and returns an indicative result for
// the dashboard tool. Auth: same bearer-token pattern as
// /api/painting/estimate. Read-only (no tenant-data write in Phase 1).

import { createClient } from '@supabase/supabase-js'
import { RecommendRequestSchema } from '@/lib/aircon/request-schema'
import { climateZoneForPostcode } from '@/lib/aircon/climate'
import { sizeAircon } from '@/lib/aircon/sizing'
import { recommendAircon, mergeAcRateCard, DEFAULT_AC_RATE_CARD } from '@/lib/aircon/recommend'
import type { AcRateCard } from '@/lib/aircon/types'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function userAndTenantFromBearer(
  req: Request,
): Promise<{ userId: string; tenantId: string | null; primaryTrade: string | null } | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, trade')
    .eq('owner_user_id', data.user.id)
    .maybeSingle()
  return {
    userId: data.user.id,
    tenantId: (tenant?.id as string | undefined) ?? null,
    primaryTrade: (tenant?.trade as string | null | undefined) ?? null,
  }
}

/** Best-effort — read overlays.aircon_rate_card for this tenant. */
async function loadAcOverlay(
  tenantId: string,
  primaryTrade: string | null,
): Promise<unknown> {
  try {
    let q = supabase.from('pricing_book').select('overlays').eq('tenant_id', tenantId)
    if (primaryTrade) q = q.eq('trade', primaryTrade)
    const { data } = await q.limit(1).maybeSingle()
    const overlays = (data?.overlays as Record<string, unknown> | null | undefined) ?? null
    return overlays?.aircon_rate_card ?? null
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const auth = await userAndTenantFromBearer(req)
  if (!auth) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = RecommendRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { address, inputs } = parsed.data

  let rateCard: AcRateCard = DEFAULT_AC_RATE_CARD
  if (auth.tenantId) {
    const overlayJson = await loadAcOverlay(auth.tenantId, auth.primaryTrade)
    if (overlayJson != null) rateCard = mergeAcRateCard(overlayJson)
  }

  const { zone, note } = climateZoneForPostcode(address.postcode, address.state)
  const sizing = sizeAircon(zone, inputs)
  const recommendation = recommendAircon({ sizing, inputs, rateCard })

  return Response.json(
    { ok: true, climate_zone: zone, climate_note: note, recommendation },
    { status: 200 },
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Manual smoke test (optional but recommended)**

Start the dev server (`npm run dev`), sign in via the dashboard to get a Supabase access token, then from the browser devtools console on a signed-in dashboard page:

```javascript
const { data } = await window /* paste a quick fetch with the session token */
```

Simplest path: rely on the dashboard tab (Task 7) to exercise the route. A 401 without a token and a 200 with one both confirm the wiring.

- [ ] **Step 4: Commit**

```bash
git add app/api/aircon/recommend/route.ts
git commit -m "feat(aircon): POST /api/aircon/recommend endpoint"
```

---

## Task 7: Dashboard tool page (`app/dashboard/aircon/page.tsx`)

**Files:**
- Create: `app/dashboard/aircon/page.tsx`

Client component, simpler than painting (no maps/3D). Verified by typecheck + loading the page.

- [ ] **Step 1: Write the page**

```tsx
'use client'

// /dashboard/aircon — air-conditioning recommendation tool.
//
// The tradie types a home's details; the deterministic engine returns an
// indicative ducted-vs-split recommendation with a price RANGE and a
// "book a site assessment" CTA. Mirrors the painting tool's auth + fetch.

import { useCallback, useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import type {
  AcRecommendation,
  AusState,
  CeilingHeight,
  ClimateZone,
  CurrentSituation,
  Insulation,
} from '@/lib/aircon/types'

type RecommendResponse =
  | { ok: true; climate_zone: ClimateZone; climate_note: string; recommendation: AcRecommendation }
  | { ok: false; error: string; issues?: unknown }

const STATES: readonly AusState[] = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']
const CEILINGS: ReadonlyArray<readonly [CeilingHeight, string]> = [
  ['standard', 'Standard (~2.4 m)'],
  ['high', 'High (~2.7 m)'],
  ['raked', 'Raked / cathedral'],
]
const INSULATIONS: ReadonlyArray<readonly [Insulation, string]> = [
  ['good', 'Good'],
  ['average', 'Average'],
  ['poor', 'Poor'],
  ['unknown', 'Unknown'],
]
const SITUATIONS: ReadonlyArray<readonly [CurrentSituation, string]> = [
  ['none', 'No system yet'],
  ['replacing', 'Replacing a system'],
  ['adding', 'Adding to existing'],
]

const money = (n: number) => `$${n.toLocaleString('en-AU')}`

export default function AirconRecommendPage() {
  const [token, setToken] = useState<string | null>(null)
  const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'ready'>('loading')

  const [address, setAddress] = useState('')
  const [postcode, setPostcode] = useState('')
  const [stateCode, setStateCode] = useState<AusState>('QLD')
  const [bedrooms, setBedrooms] = useState(3)
  const [bathrooms, setBathrooms] = useState(2)
  const [livingSpaces, setLivingSpaces] = useState(2)
  const [floorArea, setFloorArea] = useState('')
  const [ceiling, setCeiling] = useState<CeilingHeight>('standard')
  const [insulation, setInsulation] = useState<Insulation>('average')
  const [situation, setSituation] = useState<CurrentSituation>('replacing')
  const [budget, setBudget] = useState('')

  const [busy, setBusy] = useState(false)
  const [resp, setResp] = useState<RecommendResponse | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  useEffect(() => {
    const sb = getBrowserSupabase()
    sb.auth.getSession().then(({ data: { session } }) => {
      const t = session?.access_token ?? null
      setToken(t)
      setAuthState(t ? 'ready' : 'signed-out')
    })
  }, [])

  const run = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!token) {
        setErrMsg('Sign in to use the recommender.')
        return
      }
      setBusy(true)
      setErrMsg(null)
      try {
        const res = await fetch('/api/aircon/recommend', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: { address, postcode, state: stateCode },
            inputs: {
              bedrooms,
              bathrooms,
              living_spaces: livingSpaces,
              floor_area_m2: floorArea ? Number(floorArea) : null,
              ceiling_height: ceiling,
              insulation,
              current_situation: situation,
              budget: budget ? Number(budget) : null,
            },
          }),
        })
        setResp((await res.json()) as RecommendResponse)
      } catch (err) {
        setErrMsg(err instanceof Error ? err.message : 'Request failed')
      } finally {
        setBusy(false)
      }
    },
    [token, address, postcode, stateCode, bedrooms, bathrooms, livingSpaces, floorArea, ceiling, insulation, situation, budget],
  )

  if (authState === 'loading') return <main className="p-8 text-ink-muted">Loading…</main>
  if (authState === 'signed-out') return <main className="p-8 text-ink-muted">Sign in to use the AC recommender.</main>

  return (
    <main className="mx-auto max-w-3xl p-6 sm:p-8">
      <h1 className="mb-1 text-2xl font-bold">Air-Conditioning Recommender</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Indicative ducted-vs-split sizing from a few questions. Every result needs a site assessment to confirm.
      </p>

      <form onSubmit={run} className="grid grid-cols-2 gap-4">
        <label className="col-span-2 flex flex-col gap-1 text-sm">
          Address
          <input className="border border-ink-line bg-ink-card p-2" value={address} onChange={(e) => setAddress(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Postcode
          <input className="border border-ink-line bg-ink-card p-2" value={postcode} onChange={(e) => setPostcode(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          State
          <select className="border border-ink-line bg-ink-card p-2" value={stateCode} onChange={(e) => setStateCode(e.target.value as AusState)}>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Bedrooms
          <input type="number" min={0} className="border border-ink-line bg-ink-card p-2" value={bedrooms} onChange={(e) => setBedrooms(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Bathrooms
          <input type="number" min={0} className="border border-ink-line bg-ink-card p-2" value={bathrooms} onChange={(e) => setBathrooms(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Living spaces
          <input type="number" min={0} className="border border-ink-line bg-ink-card p-2" value={livingSpaces} onChange={(e) => setLivingSpaces(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Floor area m² (optional)
          <input type="number" min={0} className="border border-ink-line bg-ink-card p-2" value={floorArea} onChange={(e) => setFloorArea(e.target.value)} placeholder="raises accuracy" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Ceiling height
          <select className="border border-ink-line bg-ink-card p-2" value={ceiling} onChange={(e) => setCeiling(e.target.value as CeilingHeight)}>
            {CEILINGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Insulation
          <select className="border border-ink-line bg-ink-card p-2" value={insulation} onChange={(e) => setInsulation(e.target.value as Insulation)}>
            {INSULATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Current situation
          <select className="border border-ink-line bg-ink-card p-2" value={situation} onChange={(e) => setSituation(e.target.value as CurrentSituation)}>
            {SITUATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Budget $ (optional)
          <input type="number" min={0} className="border border-ink-line bg-ink-card p-2" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </label>

        <button type="submit" disabled={busy} className="col-span-2 mt-2 bg-accent p-3 font-semibold text-ink-bg disabled:opacity-50">
          {busy ? 'Calculating…' : 'Get recommendation'}
        </button>
      </form>

      {errMsg && <p className="mt-4 text-sm text-red-500">{errMsg}</p>}

      {resp && resp.ok && <Result resp={resp} />}
      {resp && !resp.ok && (
        <p className="mt-4 text-sm text-red-500">Could not size this job ({resp.error}).</p>
      )}
    </main>
  )
}

function Result({ resp }: { resp: Extract<RecommendResponse, { ok: true }> }) {
  const { recommendation: r, climate_zone, climate_note } = resp
  return (
    <section className="mt-8 flex flex-col gap-4">
      <div className="border border-ink-line bg-ink-card p-4 text-sm">
        <p>
          <strong>{r.sizing.connected_kw} kW</strong> connected load across{' '}
          {r.sizing.conditioned_zones} zones · {r.sizing.total_floor_area_m2} m² ·{' '}
          {r.sizing.total_volume_m3} m³ · climate {climate_zone} · confidence {r.confidence}
        </p>
        <p className="mt-1 text-ink-muted">{climate_note}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {r.options.map((o) => (
          <div
            key={o.system_type}
            className={`border p-4 ${o.best_fit ? 'border-accent' : 'border-ink-line'} bg-ink-card`}
          >
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-bold capitalize">{o.system_type}</h2>
              {o.best_fit && <span className="bg-accent px-2 py-0.5 text-xs font-semibold text-ink-bg">Best fit</span>}
            </div>
            <p className="text-sm text-ink-muted">{o.capacity_kw} kW</p>
            <p className="my-2 text-xl font-bold">
              {money(o.price.low)} – {money(o.price.high)}
              <span className="ml-1 text-xs font-normal text-ink-muted">inc GST, indicative</span>
            </p>
            <ul className="mt-2 list-disc pl-5 text-xs text-ink-muted">
              {o.pros.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </div>
        ))}
      </div>

      <div className="border border-accent bg-ink-card p-4 text-sm">
        <strong>Next step: book a site assessment.</strong>
        <p className="mt-1 text-ink-muted">{r.routing.reason}</p>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (If `getBrowserSupabase` is not at `@/lib/supabase/client`, confirm its export — it is imported the same way in `app/dashboard/painting/page.tsx`.)

- [ ] **Step 3: Manual verification**

Run `npm run dev`, sign in, visit `http://localhost:3000/dashboard/aircon`, fill the form, submit. Expected: a sizing summary, two option cards (one flagged "Best fit"), and a "book a site assessment" banner. Try a small home (1 bed / 1 living, no floor area) → split best fit, lower confidence reason; a large home (4 bed / 2 living, 240 m²) → ducted best fit.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/aircon/page.tsx
git commit -m "feat(aircon): dashboard recommendation tool page"
```

---

## Task 8: Dashboard hub link (`app/dashboard/page.tsx`)

**Files:**
- Modify: `app/dashboard/page.tsx` (near the painting hub `<Link href="/dashboard/painting">`, currently ~line 10564)

`app/dashboard/page.tsx` is a large monolith. Make the minimal change: add one Link card next to the existing painting hub Link, reusing its exact class string.

- [ ] **Step 1: Locate the painting hub link**

Run: `npx rg -n 'href="/dashboard/painting"' app/dashboard/page.tsx`
Expected: one match (~line 10564). Open the file at that line and find the end of that `<Link>…</Link>` block.

- [ ] **Step 2: Insert the aircon hub card immediately after the painting `</Link>`**

```tsx
      <Link
        href="/dashboard/aircon"
        className="group flex flex-col gap-6 border border-ink-line bg-ink-card p-7 transition-colors hover:border-accent sm:flex-row sm:items-start sm:gap-8 sm:p-9"
      >
        <div className="flex flex-col gap-2">
          <h3 className="text-lg font-bold">Air-Conditioning Recommender</h3>
          <p className="text-sm text-ink-muted">
            Size a home and get an indicative ducted-vs-split recommendation with a price range.
          </p>
        </div>
      </Link>
```

(If `Link` is not already imported in this file, it is — the painting card uses it.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual verification**

`npm run dev`, open `/dashboard`, find the new "Air-Conditioning Recommender" card near the painting one, click it → lands on `/dashboard/aircon`.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat(aircon): add AC recommender card to the dashboard hub"
```

---

## Task 9: Migration — register the `aircon` trade

**Files:**
- Create: `sql/migrations/097_aircon_trade_phase1.sql`
- Create: `scripts/run-migration-097.mjs`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Migration 097 · Air-conditioning trade — Phase 1 seed
--
-- Like painting (088) and roofing (080), aircon runs on a self-contained
-- deterministic pipeline (lib/aircon/*) — the money path is a rate card
-- (lib/aircon/recommend.ts DEFAULT_AC_RATE_CARD), NOT the Opus estimator.
-- These rows register the trade and seed a couple of forward-looking
-- catalogue entries; the deterministic engine does not read them.
--
-- Additive + idempotent. Does NOT alter the IntakeSchema trade enum
-- (aircon has no lib/intake/structure.ts path) and does NOT insert a
-- pricing_book row (tenant_id NOT NULL since mig 025 — created at tenant
-- activation). Apply with:
--   node --env-file=.env.local scripts/run-migration-097.mjs

-- ── 1. Trades registry row ─────────────────────────────────────────
insert into trades (name, display_name, is_job_based, active)
values ('aircon', 'Air Conditioning', true, true)
on conflict (name) do nothing;

-- ── 2. Forward-looking shared_assemblies (engine does not read these) ─
insert into shared_assemblies (
  trade, name, description, default_unit,
  default_unit_price_ex_gst, default_labour_hours, default_exclusions,
  category, properties
)
select * from (values
  ('aircon', 'Split system — supply & install (per head)', 'Supply and back-to-back install of a wall-mounted split-system indoor head + outdoor unit on a sound external wall.', 'each', 1400.00, 4.0, 'Excludes long pipe runs, electrical upgrades, crane/height access, asbestos handling', 'split_install', '{"system":"split"}'::jsonb),
  ('aircon', 'Ducted system — supply & install (per kW)', 'Ducted reverse-cycle system supply and install priced per kW of capacity, incl. ductwork and zoning.', 'kw', 1100.00, 2.0, 'Excludes 3-phase upgrades, roof access loading, structural modifications', 'ducted_install', '{"system":"ducted"}'::jsonb)
) as v(trade, name, description, default_unit, default_unit_price_ex_gst, default_labour_hours, default_exclusions, category, properties)
where not exists (
  select 1 from shared_assemblies sa where sa.name = v.name and sa.trade = v.trade
);

-- Keep PostgREST's schema cache fresh.
notify pgrst, 'reload schema';

-- ── 3. Sanity check (read-only) ────────────────────────────────────
do $$
declare trade_count int; asm_count int;
begin
  select count(*) into trade_count from trades where name = 'aircon';
  select count(*) into asm_count from shared_assemblies where trade = 'aircon';
  raise notice 'Migration 097: aircon trade rows = %, assemblies = %', trade_count, asm_count;
end $$;
```

- [ ] **Step 2: Write the migration runner**

```javascript
// QuoteMate · run migration 097 (air-conditioning trade Phase 1)
// Usage: node --env-file=.env.local scripts/run-migration-097.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '097_aircon_trade_phase1.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function scalar(client, q, params = []) {
  const { rows } = await client.query(q, params)
  return rows[0]?.n ?? 0
}

try {
  await c.connect()

  console.log('─── pre-flight ──')
  const beforeTrade = await scalar(c, `select count(*)::int as n from public.trades where name='aircon'`)
  console.log(`  before · aircon trade rows   ${beforeTrade}`)

  console.log('\n─── executing migration 097 ──')
  await c.query(sql)
  console.log('  migration committed.')

  console.log('\n─── post-verify ──')
  const afterTrade = await scalar(c, `select count(*)::int as n from public.trades where name='aircon'`)
  const afterAsm = await scalar(c, `select count(*)::int as n from public.shared_assemblies where trade='aircon'`)
  console.log(`  after  · aircon trade rows   ${afterTrade}`)
  console.log(`  after  · aircon assemblies   ${afterAsm}`)

  if (afterTrade < 1) {
    console.error('\nABORTING: aircon trade row not present after migration.')
    process.exit(2)
  }

  console.log('\nMigration 097 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
```

- [ ] **Step 3: Apply the migration (deliberate — writes to prod Supabase)**

> This mutates the production Supabase. Confirm with the owner before running.

Run: `node --env-file=.env.local scripts/run-migration-097.mjs`
Expected output ends with: `Migration 097 complete.` and `aircon trade rows 1`.

- [ ] **Step 4: Commit**

```bash
git add sql/migrations/097_aircon_trade_phase1.sql scripts/run-migration-097.mjs
git commit -m "feat(aircon): migration 097 — register aircon trade + seed"
```

---

## Final verification

- [ ] Run the whole aircon test suite: `npx vitest run lib/aircon/` → all pass.
- [ ] Run the full suite to confirm no regressions: `npm run test` → green.
- [ ] Typecheck the project: `npx tsc --noEmit` → clean.
- [ ] Lint: `npm run lint` → clean (fix any aircon-file issues).
- [ ] Manual: `/dashboard/aircon` produces sensible ducted/split recommendations for a small and a large home.

---

## Self-review (completed during plan authoring)

**Spec coverage:** §3 architecture → Tasks 1–9; §4 inputs → Task 5 schema + Task 7 form; §5 sizing → Task 3; §6 ducted-vs-split + diversity → Task 4; §7 rate card + overlay → Task 4 + Task 6; §8 routing/confidence → Task 4; §9 DB + trade registry → Task 9; §10 testing → tests in Tasks 2–5 + Final verification. Licensing (§9) is a documented note, no code. Out-of-scope items (§2: customer wizard, SMS/voice, firm quotes, precision mode, provider auto-fill, REA, save-as-quote) are intentionally absent.

**Placeholder scan:** none — every step has concrete code/commands. Migration number resolved to 097 (highest existing is 096).

**Type consistency:** `sizeAircon(zone, inputs)` and `recommendAircon({ sizing, inputs, rateCard })` signatures match across Tasks 3, 4, 6. `CONFIDENCE_BAND`, `roundUpToUnit`, `roundUpHalf`, `roundTo` are exported from `sizing.ts` (Task 3) and imported in `recommend.ts` (Task 4). Response shape `{ ok, climate_zone, climate_note, recommendation }` matches between Task 6 (route) and Task 7 (`RecommendResponse`). Rate-card keys (`'2.5' | '3.5' | '5' | '7' | '8'`) match `roundUpToUnit`'s outputs.
