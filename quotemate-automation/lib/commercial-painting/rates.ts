// ════════════════════════════════════════════════════════════════════
// Commercial painting — paint_rates rows → resolved PaintRateBook.
//
// resolvePaintRates() is PURE: it takes the raw paint_rates rows
// (shared defaults + any tenant overrides) and produces the validated
// lookup structure the pricer consumes. Tenant rows (tenant_id set)
// override shared defaults (tenant_id null) by `code`. Invalid or
// missing rows degrade to "absent" — the pricer then returns affected
// lines unpriced rather than guessing (spec §5.2).
//
// loadPaintRates() is the thin IO wrapper (Supabase service role).
// ════════════════════════════════════════════════════════════════════

import type { PaintRateBook, PaintRateRow } from './types'

/** Default application method per system — recorded on every trace. */
export const DEFAULT_METHOD_BY_SYSTEM: Record<string, 'spray' | 'roller'> = {
  spray_matt: 'spray',
  flat: 'spray',
  low_sheen: 'roller',
  semi_gloss: 'roller',
}

function pos(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
}

/** Tenant rows override shared defaults by code. */
function overlay(rows: PaintRateRow[]): Map<string, PaintRateRow> {
  const byCode = new Map<string, PaintRateRow>()
  for (const row of rows) {
    if (row.tenant_id == null) byCode.set(row.code, row)
  }
  for (const row of rows) {
    if (row.tenant_id != null) byCode.set(row.code, row)
  }
  return byCode
}

function modifierValue(
  byCode: Map<string, PaintRateRow>,
  code: string,
  fallback: number,
): { value: number; seeded: boolean } {
  const row = byCode.get(code)
  const v = pos(row?.value)
  if (row && v != null) return { value: v, seeded: row.is_default !== false }
  return { value: fallback, seeded: true }
}

/**
 * PURE — resolve raw paint_rates rows into the pricer's rate book.
 * Conservative fallbacks for modifiers only (a missing multiplier must
 * not zero a quote); labour/material rates have NO fallbacks — a
 * missing rate means the line comes back unpriced.
 */
export function resolvePaintRates(rows: PaintRateRow[]): PaintRateBook {
  const byCode = overlay(rows)
  let usesSeedDefaults = false
  const seeded = (row: PaintRateRow | undefined) => {
    if (row && row.is_default !== false) usesSeedDefaults = true
  }

  // ── Labour coverage rows: labour:<system>:<method> ────────────────
  const labour: PaintRateBook['labour'] = {}
  let perItem: PaintRateBook['perItem'] = null
  for (const row of byCode.values()) {
    if (row.kind !== 'labour') continue
    if (row.method === 'per_item') {
      const hours = pos(row.unit_hours)
      if (hours != null) {
        perItem = { unitHours: hours, label: row.label, code: row.code }
        seeded(row)
      }
      continue
    }
    const coverage = pos(row.coverage_m2_per_hr)
    if (row.system && row.method && coverage != null) {
      labour[`${row.system}:${row.method}`] = { coverage, label: row.label, code: row.code }
      seeded(row)
    }
  }

  // ── Material rows: default product per system + per-item enamel ───
  const materials: PaintRateBook['materials'] = {}
  let perItemMaterial: PaintRateBook['perItemMaterial'] = null
  for (const row of byCode.values()) {
    if (row.kind !== 'material') continue
    const spread = pos(row.spread_m2_per_l)
    const pricePerL = pos(row.price_per_l_ex_gst)
    if (!row.product || spread == null || pricePerL == null) continue
    if (row.code === 'mat:enamel_trim') {
      perItemMaterial = { product: row.product, spread, pricePerL, code: row.code }
      seeded(row)
      continue
    }
    if (row.system && !materials[row.system]) {
      materials[row.system] = { product: row.product, spread, pricePerL, code: row.code }
      seeded(row)
    }
  }

  // ── Modifiers (safe fallbacks — a quote must never silently zero) ─
  const heightLow = modifierValue(byCode, 'mod:height_low', 1.0)
  const heightMid = modifierValue(byCode, 'mod:height_mid', 1.25)
  const heightHigh = modifierValue(byCode, 'mod:height_high', 1.4)
  const prepPct = modifierValue(byCode, 'mod:prep_pct', 0.1)
  const sundriesPct = modifierValue(byCode, 'mod:sundries_pct', 0.08)
  const labourRate = modifierValue(byCode, 'mod:labour_rate', 75)
  const crewHours = modifierValue(byCode, 'mod:crew_hours_per_day', 7.6)
  const crewSize = modifierValue(byCode, 'mod:default_crew_size', 3)
  if (
    [heightLow, heightMid, heightHigh, prepPct, sundriesPct, labourRate, crewHours, crewSize].some(
      (m) => m.seeded,
    )
  ) {
    usesSeedDefaults = true
  }

  // ── Equipment ──────────────────────────────────────────────────────
  let scissorLift: PaintRateBook['equipment']['scissorLift'] = null
  const lift = byCode.get('equip:scissor_lift')
  const liftRate = pos(lift?.value)
  if (lift && liftRate != null) {
    scissorLift = { label: lift.label, dayRate: liftRate, code: lift.code }
    seeded(lift)
  }

  return {
    labour,
    perItem,
    materials,
    perItemMaterial,
    modifiers: {
      heightLow: heightLow.value,
      heightMid: heightMid.value,
      heightHigh: heightHigh.value,
      prepPct: prepPct.value,
      sundriesPct: sundriesPct.value,
      labourRatePerHr: labourRate.value,
      crewHoursPerDay: crewHours.value,
      defaultCrewSize: crewSize.value,
    },
    equipment: { scissorLift },
    usesSeedDefaults,
  }
}

/** Height band → multiplier (spec §5.1: ≤3.4 ×1.0; 3.4–5 ×1.25; >5 ×1.4). */
export function heightMultiplier(book: PaintRateBook, heightM: number | undefined): number {
  if (heightM == null || !Number.isFinite(heightM) || heightM <= 3.4) return book.modifiers.heightLow
  if (heightM <= 5) return book.modifiers.heightMid
  return book.modifiers.heightHigh
}

/** Equipment trigger: any priced surface above 3.4 m needs lift access. */
export const EQUIPMENT_TRIGGER_HEIGHT_M = 3.4

/**
 * PURE — return the rate book with the labour $/hr overridden for this
 * quote when a valid positive override is supplied; otherwise the book
 * unchanged. Lets a tradie set a per-quote hourly rate without editing
 * the seeded/tenant default (the override is not persisted; the priced
 * BOM records the rate actually used in `labour.ratePerHr`).
 */
export function applyLabourRateOverride(
  book: PaintRateBook,
  rateOverride: number | null | undefined,
): PaintRateBook {
  if (typeof rateOverride !== 'number' || !Number.isFinite(rateOverride) || rateOverride <= 0) {
    return book
  }
  return {
    ...book,
    modifiers: { ...book.modifiers, labourRatePerHr: Math.round(rateOverride * 100) / 100 },
  }
}

// ── IO wrapper ────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Load shared defaults + this tenant's overrides for commercial painting.
 * Service-role client; RLS bypassed (same posture as the electrical
 * pricing-context loader).
 */
export async function loadPaintRates(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<PaintRateRow[]> {
  const { data, error } = await supabase
    .from('paint_rates')
    .select(
      'kind, code, label, tenant_id, system, method, product, coverage_m2_per_hr, spread_m2_per_l, price_per_l_ex_gst, unit_hours, value, unit, is_default',
    )
    .eq('trade', 'commercial_painting')
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
  if (error) throw new Error(`paint_rates load failed: ${error.message}`)
  return (data ?? []) as PaintRateRow[]
}
