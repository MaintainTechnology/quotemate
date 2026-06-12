// ════════════════════════════════════════════════════════════════════
// Commercial painting — PURE pricer (spec §5).
//
// pricePaintTakeoff(confirmedItems, rateBook) → PricedPaintBom.
//
//   labour_hours(line)    = quantity ÷ coverage(system, method) × coats
//                           × height_multiplier × (1 + prep_pct)
//   material_litres(line) = quantity × coats ÷ spread_rate(product)
//   material_$            = ceil(litres per product) × $/L × (1 + sundries)
//   equipment             = day_rate × ceil(days on >3.4 m surfaces)
//   totals                = labour$ + materials$ + equipment$ → GST → inc
//
// Discipline identical to lib/estimation/price.ts: every priced line
// carries a trace with formula strings; lines whose system matches no
// rate row are returned UNPRICED in `unmatched` — never guessed; no
// LLM anywhere in this module. Money rounded to 2dp; GST 10%.
// ════════════════════════════════════════════════════════════════════

import type {
  PaintRateBook,
  PaintTakeoffItem,
  PricedPaintBom,
  PricedPaintLine,
  PaintMaterialSummary,
  PaintEquipmentLine,
  PaintMethod,
} from './types'
import {
  DEFAULT_METHOD_BY_SYSTEM,
  heightMultiplier,
  EQUIPMENT_TRIGGER_HEIGHT_M,
} from './rates'

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

function money(n: number): string {
  return `$${n.toFixed(2)}`
}

type PriceOneResult =
  | { ok: true; line: PricedPaintLine }
  | { ok: false }

function priceOne(item: PaintTakeoffItem, book: PaintRateBook): PriceOneResult {
  const qty = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 0
  const coats = Number.isFinite(item.coats) && item.coats >= 1 ? Math.round(item.coats) : 2
  if (qty <= 0) return { ok: false }

  const mult = heightMultiplier(book, item.height_m)
  const prep = book.modifiers.prepPct

  if (item.unit === 'item') {
    // Per-item lines (doors/frames): hours/unit/coat + enamel material.
    const rate = book.perItem
    const mat = book.perItemMaterial
    if (!rate || !mat) return { ok: false }
    const hours = round2(qty * rate.unitHours * coats * mult * (1 + prep))
    const labourExGst = round2(hours * book.modifiers.labourRatePerHr)
    // Nominal coated area per door face set (both faces + frame) ≈ 5 m².
    const areaPerItem = 5
    const litres = qty * areaPerItem * coats / mat.spread
    const materialExGst = round2(litres * mat.pricePerL)
    return {
      ok: true,
      line: {
        surface: item.surface,
        room: item.room,
        system: item.system,
        unit: 'item',
        quantity: qty,
        coats,
        height_m: item.height_m,
        separate_price: item.separate_price === true,
        labourHours: hours,
        labourExGst,
        product: mat.product,
        litres: round2(litres),
        materialExGst,
        lineExGst: round2(labourExGst + materialExGst),
        trace: {
          method: 'per_item',
          rateCode: rate.code,
          heightMultiplier: mult,
          labourFormula: `${qty} × ${rate.unitHours}h × ${coats} coats × ${mult} height × ${(1 + prep).toFixed(2)} prep × ${money(book.modifiers.labourRatePerHr)}/h = ${money(labourExGst)}`,
          materialFormula: `${qty} × ${areaPerItem} m² × ${coats} ÷ ${mat.spread} m²/L = ${litres.toFixed(1)} L × ${money(mat.pricePerL)}/L = ${money(materialExGst)}`,
        },
      },
    }
  }

  const method: PaintMethod = DEFAULT_METHOD_BY_SYSTEM[item.system] ?? 'roller'
  const labourRate = book.labour[`${item.system}:${method}`]
  const mat = book.materials[item.system]
  if (!labourRate || !mat) return { ok: false }

  const hours = round2((qty / labourRate.coverage) * coats * mult * (1 + prep))
  const labourExGst = round2(hours * book.modifiers.labourRatePerHr)
  const litres = (qty * coats) / mat.spread
  const materialExGst = round2(litres * mat.pricePerL)

  return {
    ok: true,
    line: {
      surface: item.surface,
      room: item.room,
      system: item.system,
      unit: 'm2',
      quantity: qty,
      coats,
      height_m: item.height_m,
      separate_price: item.separate_price === true,
      labourHours: hours,
      labourExGst,
      product: mat.product,
      litres: round2(litres),
      materialExGst,
      lineExGst: round2(labourExGst + materialExGst),
      trace: {
        method,
        rateCode: labourRate.code,
        heightMultiplier: mult,
        labourFormula: `${qty} m² ÷ ${labourRate.coverage} m²/h × ${coats} coats × ${mult} height × ${(1 + prep).toFixed(2)} prep = ${hours}h × ${money(book.modifiers.labourRatePerHr)}/h = ${money(labourExGst)}`,
        materialFormula: `${qty} m² × ${coats} coats ÷ ${mat.spread} m²/L = ${litres.toFixed(1)} L × ${money(mat.pricePerL)}/L = ${money(materialExGst)}`,
      },
    },
  }
}

export function pricePaintTakeoff(
  items: PaintTakeoffItem[],
  book: PaintRateBook,
  opts?: { gstRegistered?: boolean },
): PricedPaintBom {
  const gstRegistered = opts?.gstRegistered !== false

  const mainLines: PricedPaintLine[] = []
  const separateLines: PricedPaintLine[] = []
  const unmatched: PricedPaintBom['unmatched'] = []
  const excluded: PricedPaintBom['excluded'] = []

  for (const item of items) {
    if (item.excluded === true) {
      excluded.push({
        surface: item.surface,
        room: item.room,
        quantity: item.quantity,
        unit: item.unit,
      })
      continue
    }
    const r = priceOne(item, book)
    if (!r.ok) {
      unmatched.push({
        surface: item.surface,
        room: item.room,
        system: item.system,
        quantity: item.quantity,
      })
      continue
    }
    if (r.line.separate_price) separateLines.push(r.line)
    else mainLines.push(r.line)
  }

  // ── Materials: aggregate raw litres per product, THEN round up to
  // whole litres (you buy whole litres per product, not per line). ───
  const sundries = book.modifiers.sundriesPct
  const litresByProduct = new Map<string, { litresRaw: number; pricePerL: number }>()
  for (const line of mainLines) {
    const cur = litresByProduct.get(line.product) ?? { litresRaw: 0, pricePerL: 0 }
    cur.litresRaw += line.litres
    // pricePerL is uniform per product (same rate row) — last write wins.
    cur.pricePerL = round2(line.materialExGst / Math.max(line.litres, 0.0001))
    litresByProduct.set(line.product, cur)
  }
  const materials: PaintMaterialSummary[] = [...litresByProduct.entries()].map(
    ([product, m]) => {
      const litres = Math.ceil(m.litresRaw - 1e-9)
      const costExGst = round2(litres * m.pricePerL * (1 + sundries))
      return { product, litresRaw: round2(m.litresRaw), litres, pricePerL: m.pricePerL, costExGst }
    },
  )
  const materialsExGst = round2(materials.reduce((s, m) => s + m.costExGst, 0))

  // ── Labour roll-up: hours → crew → days → $. ──────────────────────
  const totalHours = round2(mainLines.reduce((s, l) => s + l.labourHours, 0))
  const crewSize = Math.max(1, Math.round(book.modifiers.defaultCrewSize))
  const estimatedDays = Math.max(
    totalHours > 0 ? 1 : 0,
    Math.ceil(totalHours / (crewSize * book.modifiers.crewHoursPerDay)),
  )
  const labourExGst = round2(totalHours * book.modifiers.labourRatePerHr)

  // ── Equipment: lift triggered by any priced surface above 3.4 m. ──
  const equipment: PaintEquipmentLine[] = []
  const triggered = mainLines.filter(
    (l) => (l.height_m ?? 0) > EQUIPMENT_TRIGGER_HEIGHT_M,
  )
  if (triggered.length > 0 && book.equipment.scissorLift) {
    const lift = book.equipment.scissorLift
    const triggeredHours = triggered.reduce((s, l) => s + l.labourHours, 0)
    const days = Math.max(
      1,
      Math.ceil(triggeredHours / (crewSize * book.modifiers.crewHoursPerDay)),
    )
    equipment.push({
      code: lift.code,
      label: lift.label,
      days,
      dayRate: lift.dayRate,
      costExGst: round2(days * lift.dayRate),
      reason: `${triggered.length} surface${triggered.length === 1 ? '' : 's'} above ${EQUIPMENT_TRIGGER_HEIGHT_M} m (${triggeredHours.toFixed(1)}h of access work)`,
    })
  }
  const equipmentExGst = round2(equipment.reduce((s, e) => s + e.costExGst, 0))

  // ── Separate-price section (independent total, ex main subtotal). ──
  const separateExGst = round2(
    separateLines.reduce((s, l) => s + l.lineExGst, 0),
  )

  const subtotalExGst = round2(labourExGst + materialsExGst + equipmentExGst)
  const gst = gstRegistered ? round2(subtotalExGst * 0.1) : 0
  const totalIncGst = round2(subtotalExGst + gst)

  // ── Assumptions + exclusions for the quote output. ────────────────
  const assumptions: string[] = [
    `Labour at ${money(book.modifiers.labourRatePerHr)}/hr ex GST, crew of ${crewSize}, ${book.modifiers.crewHoursPerDay} productive hrs/day`,
    `Surface prep allowance ${(book.modifiers.prepPct * 100).toFixed(0)}% on all labour`,
    `Materials sundries ${(sundries * 100).toFixed(0)}% (masking, drop sheets, rollers)`,
  ]
  const multsUsed = new Set(
    mainLines.map((l) => l.trace.heightMultiplier).filter((m) => m > 1),
  )
  if (multsUsed.size > 0) {
    assumptions.push(
      `Height access multipliers applied: ${[...multsUsed].map((m) => `×${m}`).join(', ')}`,
    )
  }
  if (book.usesSeedDefaults) {
    assumptions.push(
      'Rates are seeded AU commercial defaults pending painter validation',
    )
  }

  const exclusions: string[] = [
    'Tiled and glazed surfaces excluded',
    'Colours TBC by client — one colour scheme assumed per system',
  ]
  for (const ex of excluded) {
    exclusions.push(
      `Excluded in review: ${ex.surface} (${ex.room}, ${ex.quantity}${ex.unit === 'm2' ? ' m²' : ' item(s)'})`,
    )
  }

  return {
    lines: mainLines,
    unmatched,
    excluded,
    labour: {
      hours: totalHours,
      ratePerHr: book.modifiers.labourRatePerHr,
      crewSize,
      estimatedDays,
      costExGst: labourExGst,
    },
    materials,
    materialsExGst,
    equipment,
    equipmentExGst,
    separate: { lines: separateLines, exGst: separateExGst },
    subtotalExGst,
    gst,
    totalIncGst,
    gstRegistered,
    assumptions,
    exclusions,
  }
}
