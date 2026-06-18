// Phase 1 price-integrity helpers — unit tests for the ENFORCED guards
// wired into lib/estimate/run.ts. These cover the five failure modes the
// recipe / KB / reconcile / spec-guard post-processing could otherwise use
// to slip an ungrounded or double-charged price PAST the grounding
// validator:
//
//   R7  — dropDuplicateAppendedLines: a recipe-appended extra that
//         double-charges an Opus-drafted line is dropped (fail-closed).
//   R9  — validateAppendedLines: a recipe that appends an un-grounded
//         extra is caught; the affected tier is flagged for revert.
//   R10 — markKbRewrittenLines: a KB-rewritten price is stamped with an
//         origin marker + risk_flag so it can't launder silently.
//   R14 — (covered via validate re-check semantics) post-reconcile re-check
//         downgrades when arithmetic introduces an ungrounded number.
//   R15 — enforceSpecMismatch: a HARD spec mismatch blocks the offending
//         tier(s) in enforce mode, or routes to inspection when no safe
//         tier remains; shadow stays logging-only (no-op here).
//
// The helpers are pure (no I/O), so they're tested directly with crafted
// drafts. R9/R14 reuse the real validateQuoteGrounding + a real candidate
// set built with buildCandidatePrices so they exercise the actual guard.

import { describe, expect, it, vi } from 'vitest'

// run.ts instantiates a module-level Supabase client at import time
// (createClient throws if the URL env is absent). These helpers are pure
// and touch no DB, but the import still evaluates that line. vi.hoisted
// runs BEFORE the (hoisted) imports below, so stubbing the env here lets
// the module load without a live Supabase instance. No network call is
// made by any test in this file.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
})

import {
  lineDuplicateKey,
  dropDuplicateAppendedLines,
  validateAppendedLines,
  markKbRewrittenLines,
  enforceSpecMismatch,
} from './run'
import {
  buildCandidatePrices,
  validateQuoteGrounding,
  type PricingBookForValidation,
} from './validate'

const pricingBook: PricingBookForValidation = {
  hourly_rate: 110,
  apprentice_rate: 80,
  call_out_minimum: 120,
  default_markup_pct: 30,
  min_labour_hours: 2,
}

// A small grounded candidate set: one material row (cable, $5/m raw),
// one assembly row (downlight install, $40 raw). buildCandidatePrices
// expands each to raw + ±5pp + default markup variants.
const candidates = buildCandidatePrices(
  [
    { id: 'mat-cable-twin', name: 'Twin & earth cable per metre', price: 5, category: 'general' },
  ],
  [
    { id: 'asm-downlight', name: 'Supply & install LED downlight', price: 40, category: 'downlight' },
  ],
  pricingBook,
)

// $5 × 1.30 = $6.50 — a grounded marked-up cable price for the strict-UUID path.
const GROUNDED_CABLE_MARKED = 6.5

function tier(line_items: any[], subtotal?: number) {
  return { line_items, subtotal_ex_gst: subtotal }
}

// ───────────────────────────────────────────────────────────────────────
// lineDuplicateKey
// ───────────────────────────────────────────────────────────────────────
describe('lineDuplicateKey', () => {
  it('keys catalogue-anchored lines by source ref + qty + unit (case-insensitive)', () => {
    const a = { description: 'LED downlight', source: 'assembly:ASM-DOWNLIGHT', quantity: 2, unit: 'each', unit_price_ex_gst: 52 }
    const b = { description: 'LED downlight (premium)', source: 'assembly:asm-downlight', quantity: 2, unit: 'EACH', unit_price_ex_gst: 52 }
    expect(lineDuplicateKey(a)).toBe(lineDuplicateKey(b))
  })

  it('keys non-anchored lines by normalised description, stripping parentheticals', () => {
    const a = { description: 'Cable run', quantity: 3, unit: 'm', unit_price_ex_gst: 6.5 }
    const b = { description: 'Cable run (supplied)', quantity: 3, unit: 'm', unit_price_ex_gst: 6.5 }
    expect(lineDuplicateKey(a)).toBe(lineDuplicateKey(b))
  })

  it('distinguishes a different quantity', () => {
    const a = { description: 'Cable run', quantity: 3, unit: 'm', unit_price_ex_gst: 6.5 }
    const b = { description: 'Cable run', quantity: 5, unit: 'm', unit_price_ex_gst: 6.5 }
    expect(lineDuplicateKey(a)).not.toBe(lineDuplicateKey(b))
  })

  it('keys labour lines by DESCRIPTION (R7) — two distinct labour lines are NOT equal', () => {
    // R7 fix: the old key collapsed every labour line that shared hours+unit,
    // so a recipe's distinct additional-labour line was wrongly seen as a
    // duplicate of an unrelated Opus base-labour line. Distinct descriptions
    // must now produce DISTINCT keys even at the same hours/rate.
    const a = { description: 'Labour — install', source: 'labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110 }
    const b = { description: 'Extra labour — long cable run', source: 'labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110 }
    expect(lineDuplicateKey(a)).not.toBe(lineDuplicateKey(b))
  })

  it('still collapses an EXACT labour repeat (same description, hrs, unit)', () => {
    const a = { description: 'Labour — install', source: 'labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110 }
    const b = { description: 'Labour — install', source: 'labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110 }
    expect(lineDuplicateKey(a)).toBe(lineDuplicateKey(b))
  })
})

// ───────────────────────────────────────────────────────────────────────
// R7 — dropDuplicateAppendedLines
// ───────────────────────────────────────────────────────────────────────
describe('R7 — dropDuplicateAppendedLines', () => {
  it('drops an appended recipe line that duplicates an Opus-drafted line by ref+qty+unit', () => {
    // Opus prefix = 2 lines; the recipe appended a 3rd that repeats the cable run.
    const draft: any = {
      good: tier([
        { description: 'Downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52 },
        { description: 'Cable run', source: 'material:mat-cable-twin', quantity: 3, unit: 'm', unit_price_ex_gst: 6.5 },
        { description: 'Extra cable run', source: 'material:mat-cable-twin', quantity: 3, unit: 'm', unit_price_ex_gst: 6.5 },
      ], 0),
    }
    const { dropped } = dropDuplicateAppendedLines(draft, { good: 2 })
    expect(dropped).toHaveLength(1)
    expect(draft.good.line_items).toHaveLength(2)
    // Subtotal recomputed from survivors: 52 + 3×6.5 = 71.5
    expect(draft.good.subtotal_ex_gst).toBe(71.5)
  })

  it('keeps a genuinely-additional appended line (different qty → different thing)', () => {
    const draft: any = {
      good: tier([
        { description: 'Cable run', source: 'material:mat-cable-twin', quantity: 3, unit: 'm', unit_price_ex_gst: 6.5 },
        { description: 'Extra cable run', source: 'material:mat-cable-twin', quantity: 5, unit: 'm', unit_price_ex_gst: 6.5 },
      ], 0),
    }
    const { dropped } = dropDuplicateAppendedLines(draft, { good: 1 })
    expect(dropped).toHaveLength(0)
    expect(draft.good.line_items).toHaveLength(2)
  })

  it('collapses two identical appended lines to one (appended-vs-appended dup)', () => {
    const draft: any = {
      good: tier([
        { description: 'Downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52 },
        { description: 'Cable run', source: 'material:mat-cable-twin', quantity: 2, unit: 'm', unit_price_ex_gst: 6.5 },
        { description: 'Cable run', source: 'material:mat-cable-twin', quantity: 2, unit: 'm', unit_price_ex_gst: 6.5 },
      ], 0),
    }
    const { dropped } = dropDuplicateAppendedLines(draft, { good: 1 })
    expect(dropped).toHaveLength(1)
    expect(draft.good.line_items).toHaveLength(2)
  })

  it('is a no-op when no lines were appended (preCount === length)', () => {
    const draft: any = {
      good: tier([
        { description: 'Downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52 },
      ], 52),
    }
    const before = JSON.stringify(draft)
    const { dropped } = dropDuplicateAppendedLines(draft, { good: 1 })
    expect(dropped).toHaveLength(0)
    expect(JSON.stringify(draft)).toBe(before)
  })

  it('does nothing for a tier with no recorded preCount', () => {
    const draft: any = {
      good: tier([
        { description: 'Cable run', source: 'material:mat-cable-twin', quantity: 3, unit: 'm', unit_price_ex_gst: 6.5 },
        { description: 'Cable run', source: 'material:mat-cable-twin', quantity: 3, unit: 'm', unit_price_ex_gst: 6.5 },
      ], 0),
    }
    const { dropped } = dropDuplicateAppendedLines(draft, {})
    expect(dropped).toHaveLength(0)
    expect(draft.good.line_items).toHaveLength(2)
  })

  it('is idempotent — re-running finds nothing more to drop', () => {
    const draft: any = {
      better: tier([
        { description: 'Cable run', source: 'material:mat-cable-twin', quantity: 3, unit: 'm', unit_price_ex_gst: 6.5 },
        { description: 'Cable run', source: 'material:mat-cable-twin', quantity: 3, unit: 'm', unit_price_ex_gst: 6.5 },
      ], 0),
    }
    dropDuplicateAppendedLines(draft, { better: 1 })
    const after1 = JSON.stringify(draft)
    const { dropped } = dropDuplicateAppendedLines(draft, { better: 1 })
    expect(dropped).toHaveLength(0)
    expect(JSON.stringify(draft)).toBe(after1)
  })

  // R7 fix — additive recipe labour must NEVER be dropped.
  it('KEEPS two distinct labour lines with the same hrs+rate but different descriptions (additive recipe labour)', () => {
    // Opus base labour (2hr) + a recipe-appended ADDITIONAL labour line that
    // also totals 2hr but is a genuinely different task. The old key collapsed
    // them and dropped the recipe one, under-billing real work. Both must stay.
    const draft: any = {
      good: tier([
        { description: 'Downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52 },
        { description: 'Labour — install', source: 'labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110 },
        // recipe-appended additional labour, same 2hr @ $110 but a different task:
        { description: 'Extra labour — long cable run', source: 'labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110, recipe_origin: true },
      ], 0),
    }
    const { dropped } = dropDuplicateAppendedLines(draft, { good: 2 })
    expect(dropped).toHaveLength(0)
    // Both labour lines survive — the recipe's additional 2hr is real work.
    expect(draft.good.line_items).toHaveLength(3)
    const labourLines = draft.good.line_items.filter((li: any) => li.source === 'labour')
    expect(labourLines).toHaveLength(2)
    // No drop happened → subtotal is left exactly as the input (the helper only
    // recomputes when it actually removes a line). Confirms no under-billing.
    expect(draft.good.subtotal_ex_gst).toBe(0)
  })

  it('KEEPS a recipe labour line even when it EXACTLY repeats an Opus labour line (labour is always additive)', () => {
    // Even an exact-duplicate-looking labour line is additive work — the recipe
    // explicitly added more hours. Labour is never a dedupe target.
    const draft: any = {
      good: tier([
        { description: 'Labour — install', source: 'labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110 },
        { description: 'Labour — install', source: 'labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110, recipe_origin: true },
      ], 0),
    }
    const { dropped } = dropDuplicateAppendedLines(draft, { good: 1 })
    expect(dropped).toHaveLength(0)
    expect(draft.good.line_items).toHaveLength(2)
  })

  // R7/R9 swap fix — drop is driven by the recipe_origin marker, not preCount.
  it('uses the recipe_origin marker (not preCount) to find recipe lines — drops a marked material dup', () => {
    const draft: any = {
      good: tier([
        { description: 'Downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52 },
        { description: 'Cable run', source: 'material:mat-cable-twin', quantity: 3, unit: 'm', unit_price_ex_gst: 6.5 },
        // recipe extra duplicating the Opus cable run — marked, preCount NOT passed:
        { description: 'Extra cable run', source: 'material:mat-cable-twin', quantity: 3, unit: 'm', unit_price_ex_gst: 6.5, recipe_origin: true },
      ], 0),
    }
    const { dropped } = dropDuplicateAppendedLines(draft, {}) // no preCount — marker drives it
    expect(dropped).toHaveLength(1)
    expect(draft.good.line_items).toHaveLength(2)
    expect(draft.good.subtotal_ex_gst).toBe(71.5)
  })

  it('SWAP outcome — does NOT drop a legitimate Opus line that sits AFTER prepended recipe lines', () => {
    // merge-recipes prepends [newSundries(recipe), newLabour(recipe), ...preserved(opus)].
    // A positional preCount model would treat the preserved Opus material (now
    // at a high index) as "appended" and risk dropping it; the marker model
    // only ever looks at recipe_origin lines, so the Opus line is safe.
    const draft: any = {
      good: tier([
        // prepended recipe swap lines:
        { description: 'Premium downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52, recipe_origin: true },
        { description: 'Labour — Premium downlight', source: 'labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110, recipe_origin: true },
        // preserved Opus material (no marker) — a unique cable run:
        { description: 'Cable run', source: 'material:mat-cable-twin', quantity: 3, unit: 'm', unit_price_ex_gst: 6.5 },
      ], 0),
    }
    // Even with a (now-wrong) positional preCount of 1, the marker wins and
    // the preserved Opus line is never considered for drop.
    const { dropped } = dropDuplicateAppendedLines(draft, { good: 1 })
    expect(dropped).toHaveLength(0)
    expect(draft.good.line_items).toHaveLength(3)
    // The unique Opus cable line survives untouched.
    expect(draft.good.line_items.some((li: any) => li.description === 'Cable run')).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────
// R9 — validateAppendedLines (appended-extra micro-validation)
// ───────────────────────────────────────────────────────────────────────
describe('R9 — validateAppendedLines', () => {
  it('flags a tier whose appended extra is an ungrounded price', () => {
    const draft: any = {
      good: tier([
        // Opus prefix (grounded) — 1 line, but we only validate the appended part.
        { description: 'Downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52 },
        // Appended recipe extra at an INVENTED price ($99 cable) — ungrounded.
        { description: 'Cable run', source: 'material:mat-cable-twin', quantity: 3, unit: 'm', unit_price_ex_gst: 99 },
      ], 0),
    }
    const { failedTiers, failures } = validateAppendedLines(draft, { good: 1 }, pricingBook, candidates)
    expect(failedTiers.has('good')).toBe(true)
    expect(failures.length).toBeGreaterThan(0)
  })

  it('passes a tier whose appended extra grounds (correct marked-up cable price)', () => {
    const draft: any = {
      good: tier([
        { description: 'Downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52 },
        { description: 'Cable run', source: 'material:mat-cable-twin', quantity: 3, unit: 'm', unit_price_ex_gst: GROUNDED_CABLE_MARKED },
        // appended labour at the hourly rate is grounded too
        { description: 'Extra labour', source: 'labour', quantity: 1, unit: 'hr', unit_price_ex_gst: 110 },
      ], 0),
    }
    const { failedTiers } = validateAppendedLines(draft, { good: 1 }, pricingBook, candidates)
    expect(failedTiers.size).toBe(0)
  })

  it('is a no-op when nothing was appended', () => {
    const draft: any = {
      good: tier([
        { description: 'Downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52 },
      ], 52),
    }
    const { failedTiers } = validateAppendedLines(draft, { good: 1 }, pricingBook, candidates)
    expect(failedTiers.size).toBe(0)
  })

  it('does NOT false-fail an extras-only tier on the whole-tier labour floor', () => {
    // Appended extras are a single 0-hour cable line — far below the 2hr
    // floor. The floor is a whole-tier property and must not bounce the
    // extras-only micro-check.
    const draft: any = {
      better: tier([
        { description: 'Downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52 },
        { description: 'Labour', source: 'labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110 },
        { description: 'Cable run', source: 'material:mat-cable-twin', quantity: 2, unit: 'm', unit_price_ex_gst: GROUNDED_CABLE_MARKED },
      ], 0),
    }
    const { failedTiers } = validateAppendedLines(draft, { better: 2 }, pricingBook, candidates)
    expect(failedTiers.size).toBe(0)
  })

  it('isolates the failure to the offending tier only', () => {
    const draft: any = {
      good: tier([
        { description: 'Downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52 },
        { description: 'Cable run', source: 'material:mat-cable-twin', quantity: 3, unit: 'm', unit_price_ex_gst: GROUNDED_CABLE_MARKED },
      ], 0),
      better: tier([
        { description: 'Downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52 },
        { description: 'Cable run', source: 'material:mat-cable-twin', quantity: 3, unit: 'm', unit_price_ex_gst: 99 },
      ], 0),
    }
    const { failedTiers } = validateAppendedLines(draft, { good: 1, better: 1 }, pricingBook, candidates)
    expect(failedTiers.has('good')).toBe(false)
    expect(failedTiers.has('better')).toBe(true)
  })

  // R9 framing fix — the sub-draft must carry scope_of_works so the embedded
  // cross-tier check sees the framing and does NOT falsely revert a framed
  // differing-quantity cross-tier recipe extra.
  it('does NOT false-fail a recipe extra appearing at different qty across tiers when FRAMED in scope_of_works', () => {
    const draft: any = {
      // Framing the customer can see: the cable metre count differs by tier.
      scope_of_works:
        'Good tier includes 3 metres of twin & earth cable per metre; ' +
        'Best tier includes 6 metres of twin & earth cable per metre for the longer run.',
      good: tier([
        { description: 'Downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52 },
        // recipe-appended cable extra @ grounded price, qty 3:
        { description: 'Twin & earth cable per metre', source: 'material:mat-cable-twin', quantity: 3, unit: 'm', unit_price_ex_gst: GROUNDED_CABLE_MARKED, recipe_origin: true },
      ], 0),
      best: tier([
        { description: 'Downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52 },
        // recipe-appended cable extra @ grounded price, qty 6:
        { description: 'Twin & earth cable per metre', source: 'material:mat-cable-twin', quantity: 6, unit: 'm', unit_price_ex_gst: GROUNDED_CABLE_MARKED, recipe_origin: true },
      ], 0),
    }
    const { failedTiers, failures } = validateAppendedLines(draft, { good: 1, best: 1 }, pricingBook, candidates)
    expect(failedTiers.size).toBe(0)
    expect(failures).toHaveLength(0)
  })

  it('STILL fails an UNframed differing-qty cross-tier recipe extra (grounding not loosened)', () => {
    // Same shape as above but NO scope_of_works framing → the cross-tier
    // duplicate check must still flag it. Proves the framing copy adds
    // precision without loosening grounding.
    const draft: any = {
      good: tier([
        { description: 'Downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52 },
        { description: 'Twin & earth cable per metre', source: 'material:mat-cable-twin', quantity: 3, unit: 'm', unit_price_ex_gst: GROUNDED_CABLE_MARKED, recipe_origin: true },
      ], 0),
      best: tier([
        { description: 'Downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52 },
        { description: 'Twin & earth cable per metre', source: 'material:mat-cable-twin', quantity: 6, unit: 'm', unit_price_ex_gst: GROUNDED_CABLE_MARKED, recipe_origin: true },
      ], 0),
    }
    const { failedTiers } = validateAppendedLines(draft, { good: 1, best: 1 }, pricingBook, candidates)
    expect(failedTiers.size).toBeGreaterThan(0)
  })

  it('uses the recipe_origin marker (not preCount) to pick which lines to validate', () => {
    // No preCount passed at all — the marker alone selects the recipe extra.
    const draft: any = {
      good: tier([
        { description: 'Downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52 },
        { description: 'Cable run', source: 'material:mat-cable-twin', quantity: 3, unit: 'm', unit_price_ex_gst: 99, recipe_origin: true },
      ], 0),
    }
    const { failedTiers } = validateAppendedLines(draft, {}, pricingBook, candidates)
    expect(failedTiers.has('good')).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────
// R10 — markKbRewrittenLines
// ───────────────────────────────────────────────────────────────────────
describe('R10 — markKbRewrittenLines', () => {
  it('stamps each KB-rewritten line with origin marker + appends risk_flags', () => {
    const draft: any = {
      good: tier([
        { description: 'Downlight', unit: 'each', quantity: 1, unit_price_ex_gst: 52 },
        { description: 'Cable run', unit: 'm', quantity: 3, unit_price_ex_gst: 6.5 },
      ], 71.5),
    }
    const corrections = [{ tier: 'good' as const, lineIndex: 1, from: 5, to: 6.5 }]
    const { stamped, flags } = markKbRewrittenLines(draft, corrections)
    expect(stamped).toBe(1)
    expect(draft.good.line_items[1].kb_origin).toBe(true)
    expect(draft.good.line_items[1].kb_rewritten_from).toBe(5)
    expect(flags).toHaveLength(1)
    expect(draft.risk_flags).toEqual(expect.arrayContaining([expect.stringContaining('[kb-origin]')]))
  })

  it('is a no-op with zero corrections (KB off / shadow / no mismatch)', () => {
    const draft: any = {
      good: tier([{ description: 'Downlight', unit: 'each', quantity: 1, unit_price_ex_gst: 52 }], 52),
    }
    const before = JSON.stringify(draft)
    const { stamped, flags } = markKbRewrittenLines(draft, [])
    expect(stamped).toBe(0)
    expect(flags).toHaveLength(0)
    expect(JSON.stringify(draft)).toBe(before)
  })

  it('preserves existing risk_flags when appending', () => {
    const draft: any = {
      risk_flags: ['[pre-existing] something'],
      good: tier([{ description: 'X', unit: 'each', quantity: 1, unit_price_ex_gst: 10 }], 10),
    }
    markKbRewrittenLines(draft, [{ tier: 'good', lineIndex: 0, from: 9, to: 10 }])
    expect(draft.risk_flags[0]).toBe('[pre-existing] something')
    expect(draft.risk_flags).toHaveLength(2)
  })

  it('a stamped KB price that is ungrounded STILL fails the validator (no laundering)', () => {
    // KB rewrote the cable line to an invented $99/m. R10 stamps it, but the
    // grounding pass (which run.ts runs AFTER KB) still rejects it.
    const draft: any = {
      good: tier([
        { description: 'Downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52 },
        { description: 'Labour', source: 'labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110 },
        { description: 'Cable run', source: 'material:mat-cable-twin', quantity: 3, unit: 'm', unit_price_ex_gst: 99 },
      ], 0),
    }
    markKbRewrittenLines(draft, [{ tier: 'good', lineIndex: 2, from: 6.5, to: 99 }])
    expect(draft.good.line_items[2].kb_origin).toBe(true)
    const res = validateQuoteGrounding(draft, pricingBook, candidates)
    expect(res.valid).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────
// R14 — post-reconciliation re-check (validator semantics)
// ───────────────────────────────────────────────────────────────────────
describe('R14 — post-reconciliation grounding re-check', () => {
  it('re-running the validator catches an ungrounded number introduced post-grounding', () => {
    // Simulate a (hypothetical) reconciliation that left an ungrounded unit
    // price. The re-check must reject it exactly like the first pass would.
    const draft: any = {
      good: tier([
        { description: 'Downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52 },
        { description: 'Labour', source: 'labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110 },
        { description: 'Cable run', source: 'material:mat-cable-twin', quantity: 3, unit: 'm', unit_price_ex_gst: 88 },
      ], 0),
    }
    const res = validateQuoteGrounding(draft, pricingBook, candidates)
    expect(res.valid).toBe(false)
  })

  it('a still-grounded post-reconcile draft passes the re-check (no false downgrade)', () => {
    const draft: any = {
      good: tier([
        { description: 'Downlight', source: 'assembly:asm-downlight', quantity: 1, unit: 'each', unit_price_ex_gst: 52 },
        { description: 'Labour', source: 'labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110 },
      ], 272),
    }
    const res = validateQuoteGrounding(draft, pricingBook, candidates)
    expect(res.valid).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────
// R15 — enforceSpecMismatch
// ───────────────────────────────────────────────────────────────────────
describe('R15 — enforceSpecMismatch', () => {
  function threeTierDraft() {
    return {
      good: tier([{ description: '10A GPO', unit: 'each', quantity: 1, unit_price_ex_gst: 30 }], 30),
      better: tier([{ description: '15A GPO', unit: 'each', quantity: 1, unit_price_ex_gst: 45 }], 45),
      best: tier([{ description: '15A GPO premium', unit: 'each', quantity: 1, unit_price_ex_gst: 60 }], 60),
      selected_tier: 'good',
    } as any
  }

  it('blocks only the spec-contradicting tier(s) in enforce mode, keeps the rest', () => {
    const draft = threeTierDraft()
    const r = enforceSpecMismatch(
      draft,
      [{ tier: 'good', reason: 'amperage: requested 15A but product is 10A' }],
      'enforce',
    )
    expect(r.routeToInspection).toBe(false)
    expect(r.blockedTiers).toEqual(['good'])
    expect(draft.good).toBeNull()
    expect(draft.better).not.toBeNull()
    expect(draft.best).not.toBeNull()
    // selected_tier re-pointed off the nulled tier
    expect(draft.selected_tier).toBe('better')
    expect(draft.risk_flags).toEqual(expect.arrayContaining([expect.stringContaining('[spec-guard]')]))
  })

  it('routes to inspection when EVERY priced tier mismatches (no safe tier)', () => {
    const draft = threeTierDraft()
    const r = enforceSpecMismatch(
      draft,
      [
        { tier: 'good', reason: 'amperage mismatch' },
        { tier: 'better', reason: 'amperage mismatch' },
        { tier: 'best', reason: 'amperage mismatch' },
      ],
      'enforce',
    )
    expect(r.routeToInspection).toBe(true)
    expect(r.blockedTiers.sort()).toEqual(['best', 'better', 'good'])
    // The helper does NOT null tiers on the inspection route — the caller
    // owns the downgrade shape.
    expect(draft.good).not.toBeNull()
    expect(draft.risk_flags).toEqual(expect.arrayContaining([expect.stringContaining('routed to inspection')]))
  })

  it('shadow mode is a no-op (logging only — never blocks)', () => {
    const draft = threeTierDraft()
    const before = JSON.stringify(draft)
    const r = enforceSpecMismatch(draft, [{ tier: 'good', reason: 'mismatch' }], 'shadow')
    expect(r.routeToInspection).toBe(false)
    expect(r.blockedTiers).toHaveLength(0)
    expect(JSON.stringify(draft)).toBe(before)
  })

  it('off mode is a no-op', () => {
    const draft = threeTierDraft()
    const before = JSON.stringify(draft)
    const r = enforceSpecMismatch(draft, [{ tier: 'good', reason: 'mismatch' }], 'off')
    expect(r.blockedTiers).toHaveLength(0)
    expect(JSON.stringify(draft)).toBe(before)
  })

  it('ignores a mismatch tier that is not actually priced (already null)', () => {
    const draft: any = {
      good: null,
      better: tier([{ description: '15A GPO', unit: 'each', quantity: 1, unit_price_ex_gst: 45 }], 45),
      best: null,
    }
    const r = enforceSpecMismatch(draft, [{ tier: 'good', reason: 'mismatch' }], 'enforce')
    // 'good' is not a priced tier → no block, no inspection.
    expect(r.blockedTiers).toHaveLength(0)
    expect(r.routeToInspection).toBe(false)
    expect(draft.better).not.toBeNull()
  })

  it('routes to inspection when the only priced tier mismatches', () => {
    const draft: any = {
      good: null,
      better: tier([{ description: '10A GPO', unit: 'each', quantity: 1, unit_price_ex_gst: 30 }], 30),
      best: null,
    }
    const r = enforceSpecMismatch(draft, [{ tier: 'better', reason: 'amperage mismatch' }], 'enforce')
    expect(r.routeToInspection).toBe(true)
    expect(r.blockedTiers).toEqual(['better'])
  })

  // R15b — the partial-block path must stamp an explicit downgrade signal so
  // the route's routing + risk_flags treat a nulled tier consistently instead
  // of it vanishing silently.
  it('partial block stamps the structured downgrade signal (spec_block + needs_review)', () => {
    const draft = threeTierDraft()
    const r = enforceSpecMismatch(
      draft,
      [{ tier: 'good', reason: 'amperage: requested 15A but product is 10A' }],
      'enforce',
    )
    expect(r.routeToInspection).toBe(false)
    expect(r.blockedTiers).toEqual(['good'])
    // The quote still ships its spec-correct tier(s) — NOT a whole-quote
    // inspection downgrade.
    expect(draft.needs_inspection).not.toBe(true)
    expect(draft.better).not.toBeNull()
    // ...but the nulled tier is NOT silent: an explicit, machine-readable
    // signal is stamped for the route + routing.
    expect(draft.needs_review).toBe(true)
    expect(draft.spec_block).toBeTruthy()
    expect(draft.spec_block.partial).toBe(true)
    expect(draft.spec_block.blocked_tiers).toEqual(['good'])
    expect(draft.spec_block.reasons[0].tier).toBe('good')
  })

  it('does NOT stamp the partial signal on the inspection-route path (caller owns that shape)', () => {
    const draft = threeTierDraft()
    const r = enforceSpecMismatch(
      draft,
      [
        { tier: 'good', reason: 'amperage mismatch' },
        { tier: 'better', reason: 'amperage mismatch' },
        { tier: 'best', reason: 'amperage mismatch' },
      ],
      'enforce',
    )
    expect(r.routeToInspection).toBe(true)
    // All-tier mismatch hands off to the caller's inspection downgrade; the
    // partial spec_block signal must NOT be set (it's specifically the
    // some-tiers-survive case).
    expect(draft.spec_block).toBeUndefined()
    expect(draft.needs_review).not.toBe(true)
  })

  it('clears a stale spec_block signal on a re-run that no longer blocks', () => {
    const draft = threeTierDraft()
    // First run stamps the partial signal.
    enforceSpecMismatch(draft, [{ tier: 'good', reason: 'amperage mismatch' }], 'enforce')
    expect(draft.spec_block).toBeTruthy()
    // A subsequent run with a non-priced mismatch tier blocks nothing → the
    // stale signal must be cleared so it can't ship a phantom marker.
    const r = enforceSpecMismatch(draft, [{ tier: 'good', reason: 'mismatch' }], 'enforce')
    expect(r.blockedTiers).toHaveLength(0) // 'good' already null → not a priced tier
    expect(draft.spec_block).toBeUndefined()
  })
})
