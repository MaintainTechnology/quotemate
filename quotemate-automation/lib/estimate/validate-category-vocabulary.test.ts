// The grounding validator drops a DB category it cannot spell.
//
// THE LIVE DEFECT (production, 2026-07-31, two quotes). A routine ten-downlight
// job was billed as a $99 site inspection because of one line:
//
//   line: "Cable, terminals, clips"  each × $6.40
//   validator: price $6.40 only exists in DB rows of a different category.
//              Line categorised as [sundry], but matching rows are:
//              "TPS cable 2.5mm² per metre" [general]
//
// The row is not miscategorised. In shared_materials it reads
// category='sundries', $5.00/lm, electrical — and 5.00 × 1.28 markup is
// exactly 6.40. Real row, real price, correct category.
//
// WHY IT STILL FAILED. buildCandidatePrices ALREADY folds a row's own
// category in (validate.ts:1179, shipped 2026-05-19) — but behind
// `isCategory()`, which tests membership of the GROUNDING vocab. There are
// two vocabularies in this database and the split is deliberate:
//
//   MATERIAL vocab  (migration 022) — shared_materials.category,
//     shared_assembly_bom.material_category: 'sundries', 'ceiling_fan',
//     'safety_switch', 'hws_gas', 'tapware_basin'. What the BOM resolver
//     and chooseMaterial() match on.
//   GROUNDING vocab (lib/estimate/categories.ts) — 'sundry', 'fan', 'rcbo',
//     'hot_water', 'tap'. What this validator matches on.
//
// isCategory('sundries') is false, so the column is dropped on the floor and
// the row falls back to its name-derived tag, [general]. The line is [sundry].
// They cannot match, and one sundries line takes the whole quote down.
//
// THE FIX is not to widen anything — it is to translate. A pure, unit-tested
// translator already exists at lib/catalogue/category-mapping.ts and its own
// comment names this exact case:
//     // Plural variants seen in the wild (the shared_materials backfill in
//     // migration 022 uses "sundries" but CATEGORIES has "sundry").
//     sundries: 'sundry',
// It is idempotent, so it strictly supersedes isCategory: a value already in
// the grounding vocab passes straight through.
//
// ⚠ NOT the alternative fix. `UPDATE shared_materials SET category='sundry'`
// would close the live case in three rows and no code — and it would be
// wrong. 'sundries' is the CANONICAL material-vocab value (it is what
// MATERIAL_VOCABULARY and the Phase 2 R8 normaliser converge ON, mapping
// 'sundry' → 'sundries'). Rewriting the column to suit the validator would
// reverse that and break the BOM joins that read it.
//
// ⚠ THIS WIDENS A MONEY-PATH GUARD, so the safety cases below are not
// decoration. The validator is what stops a model inventing prices; the R12
// safety-critical whitelist is what stops "smoke alarm work" being grounded
// on a same-priced downlight row. Every one of those rejections must survive.
// Measured against production: of 31 rows whose category is outside the
// grounding vocab, 30 already derive the right tag from their name. Exactly
// one row's tags change.

import { describe, expect, it } from 'vitest'
import {
  validateQuoteGrounding,
  buildCandidatePrices,
  categorise,
  type PricingBookForValidation,
} from './validate'

const pricingBook: PricingBookForValidation = {
  hourly_rate: 110,
  apprentice_rate: 80,
  call_out_minimum: 150,
  default_markup_pct: 28,
  min_labour_hours: 2,
}

const baseLines = [
  { description: 'Call-out', quantity: 1, unit: 'each', unit_price_ex_gst: 150, source: 'callout' },
  { description: 'Install labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110, source: 'labour' },
]

/** A one-tier draft carrying `line`. No UUID in `source`, so this takes the
 *  LOOSE path — the only path the category check runs on. A line stamped
 *  `material:<id>` bypasses categories entirely (validate.ts:950). */
function draftWith(line: Record<string, unknown>) {
  return {
    needs_inspection: false,
    good: { label: 'Standard', line_items: [...baseLines, line] },
    better: null,
    best: null,
  }
}

const candidates = (rows: Array<{ name: string; price: number; category?: string | null }>) =>
  buildCandidatePrices(rows, [], pricingBook)

const validate = (line: Record<string, unknown>, rows: Parameters<typeof candidates>[0]) =>
  validateQuoteGrounding(draftWith(line), pricingBook, candidates(rows))

// ── The premise the whole bug rests on ──────────────────────────────────

describe('the two vocabularies really do disagree', () => {
  it('the line text categorises as [sundry], singular', () => {
    expect(Array.from(categorise('Cable, terminals, clips'))).toContain('sundry')
  })

  it('the row NAME categorises as [general] — the regex does not know "TPS cable"', () => {
    const tags = Array.from(categorise('TPS cable 2.5mm² per metre'))
    expect(tags).not.toContain('sundry')
  })
})

// ── The live defect ─────────────────────────────────────────────────────

describe('a shared_materials row grounds on its own category column', () => {
  const TPS = { name: 'TPS cable 2.5mm² per metre', price: 5.0, category: 'sundries' }

  it('grounds the exact line that cost a real customer a $99 inspection', () => {
    // 5.00 × 1.28 = 6.40. Before the fix this is the production failure.
    const r = validate(
      { description: 'Cable, terminals, clips', quantity: 1, unit: 'each', unit_price_ex_gst: 6.4 },
      [TPS],
    )
    expect(r.valid, r.valid ? '' : JSON.stringify(r.failures, null, 2)).toBe(true)
  })

  it('still fails when the PRICE is wrong — the fix must not excuse a bad number', () => {
    // The category is now right, so this proves the price check still bites.
    const r = validate(
      { description: 'Cable, terminals, clips', quantity: 1, unit: 'each', unit_price_ex_gst: 99.0 },
      [TPS],
    )
    expect(r.valid).toBe(false)
  })

  it('tolerates casing and padding that isCategory rejected outright', () => {
    const r = validate(
      { description: 'Cable, terminals, clips', quantity: 1, unit: 'each', unit_price_ex_gst: 6.4 },
      [{ ...TPS, category: '  Sundries  ' }],
    )
    expect(r.valid).toBe(true)
  })
})

// ── Every alias that differs between the vocabularies ───────────────────

describe('the other material-vocab values translate too', () => {
  // Each row's NAME is deliberately opaque to the categorise() regex, so the
  // only way the line can ground is via the translated category column.
  const cases = [
    { granular: 'ceiling_fan',    line: 'Supply and install ceiling fan',        opaque: 'Item AX-118' },
    { granular: 'hws_gas',        line: 'Install gas hot water system',          opaque: 'Item BX-220' },
    { granular: 'hws_electric',   line: 'Install electric hot water system',     opaque: 'Item BX-221' },
    { granular: 'tapware_basin',  line: 'Replace basin tap set',                 opaque: 'Item CX-330' },
    { granular: 'tapware_kitchen',line: 'Replace kitchen mixer tap',             opaque: 'Item CX-331' },
    { granular: 'toilet_repair',  line: 'Repair leaking toilet cistern',         opaque: 'Item DX-440' },
  ] as const

  for (const c of cases) {
    it(`${c.granular} grounds a matching line`, () => {
      const r = validate(
        { description: c.line, quantity: 1, unit: 'each', unit_price_ex_gst: 128 },
        [{ name: c.opaque, price: 100, category: c.granular }],
      )
      expect(r.valid, r.valid ? '' : JSON.stringify(r.failures)).toBe(true)
    })
  }
})

// ── Safety: the R12 whitelist must be exactly as strict as before ───────

describe('SAFETY — the widening must not let a liability through', () => {
  it('an RCBO line still CANNOT ground off a same-priced GPO row', () => {
    // Production quote 963fbd11 was downgraded for exactly this and MUST
    // stay downgraded: a safety switch sold at the price of a power point.
    const r = validate(
      { description: 'Add RCBO safety switch to protect the new fittings', quantity: 1, unit: 'each', unit_price_ex_gst: 95 },
      [{ name: 'Smart Wi-Fi double GPO', price: 95, category: 'gpo' }],
    )
    expect(r.valid).toBe(false)
  })

  it('a smoke-alarm line still CANNOT ground off a downlight row', () => {
    const r = validate(
      { description: 'Replace 240V interconnected smoke alarm', quantity: 1, unit: 'each', unit_price_ex_gst: 128 },
      [{ name: 'Tri-colour LED downlight', price: 100, category: 'downlight' }],
    )
    expect(r.valid).toBe(false)
  })

  it('safety_switch → rcbo makes that row STRICTER, not looser', () => {
    // The translation pulls the row INTO the safety-critical whitelist, so it
    // can no longer ground an unrelated same-priced line. Widening the tag
    // set does not always widen what is accepted — here it narrows it.
    const r = validate(
      { description: 'Supply and install general fitting', quantity: 1, unit: 'each', unit_price_ex_gst: 128 },
      [{ name: 'Item EX-550', price: 100, category: 'safety_switch' }],
    )
    expect(r.valid).toBe(false)
  })

  it('a genuine safety line still grounds off its own safety row', () => {
    // Rule 4 of the R12 contract: no regression for the legitimate case.
    const r = validate(
      { description: 'Install RCBO safety switch on the kitchen circuit', quantity: 1, unit: 'each', unit_price_ex_gst: 128 },
      [{ name: 'Item EX-550', price: 100, category: 'safety_switch' }],
    )
    expect(r.valid, r.valid ? '' : JSON.stringify(r.failures)).toBe(true)
  })
})

// ── Nothing that grounds today may stop grounding ───────────────────────

describe('no regression for rows that already worked', () => {
  it('a grounding-vocab value passes straight through (idempotent)', () => {
    const r = validate(
      { description: 'Install double power point', quantity: 1, unit: 'each', unit_price_ex_gst: 128 },
      [{ name: 'Item FX-660', price: 100, category: 'gpo' }],
    )
    expect(r.valid).toBe(true)
  })

  it('an unrecognised category adds no tag and changes nothing', () => {
    // Unknown values must not become 'general' — that would hand every
    // unknown row the catch-all tag and quietly widen the validator.
    const r = validate(
      { description: 'Install double power point', quantity: 1, unit: 'each', unit_price_ex_gst: 128 },
      [{ name: 'Item GX-770', price: 100, category: 'not_a_real_category' }],
    )
    expect(r.valid).toBe(false)
  })

  it('a null category is still fine — the name carries it', () => {
    const r = validate(
      { description: 'Install double power point', quantity: 1, unit: 'each', unit_price_ex_gst: 128 },
      [{ name: 'Clipsal double GPO', price: 100, category: null }],
    )
    expect(r.valid).toBe(true)
  })

  it('the column is ADDITIVE — a name-derived tag is never dropped', () => {
    // Row names to [downlight]; column says sundries. Both must survive, so
    // the downlight line still grounds.
    const r = validate(
      { description: 'Supply and install LED downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 128 },
      [{ name: 'Tri-colour LED downlight', price: 100, category: 'sundries' }],
    )
    expect(r.valid, r.valid ? '' : JSON.stringify(r.failures)).toBe(true)
  })
})
