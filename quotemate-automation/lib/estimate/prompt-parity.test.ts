// Phase 0 exit gate (admin bulk loader — docs/admin-bulk-loader-spec.md §12,
// §13): the estimator system prompt produced by the data-driven router must
// be byte-identical to the hand-written electrical/plumbing prompt modules.
// If this fails, the prompt-router refactor changed what Opus sees — Phase 1
// must not start until it is green.
//
// It checks renderEstimatorSystemPrompt() — the real function lib/estimate/
// prompt.ts uses — on BOTH paths: dbTemplate present (the trade_prompts row)
// and dbTemplate absent (the bundled-template fallback).

import { describe, it, expect } from 'vitest'
import { renderEstimatorSystemPrompt } from './prompt'
import { type EstimatorPricingBook } from './prompt-context'
import { ELECTRICAL_ESTIMATOR_TEMPLATE } from './prompt-templates/electrical-estimator'
import { PLUMBING_ESTIMATOR_TEMPLATE } from './prompt-templates/plumbing-estimator'
import { electricalSystemPrompt } from './electrical-prompt'
import { plumbingSystemPrompt } from './plumbing-prompt'

// A spread of pricing books: the electrical/plumbing pilots, a 15%-markup
// GST-unregistered book with NULL licences + NULL min_labour_hours, and a
// high-rate book — so every {{placeholder}} and the {{markup}} helper are
// exercised against real value variety.
//
// P-1/P-2 (2026-05-25): books #0 and #3 set the optional senior_rate +
// after_hours_multiplier so the new prompt sections render against real
// values; books #1 and #2 leave them null so the "(not configured)" /
// fallback-to-1.5 paths are also covered.
const BOOKS: EstimatorPricingBook[] = [
  {
    hourly_rate: 110,
    call_out_minimum: 150,
    apprentice_rate: 65,
    senior_rate: 165,
    default_markup_pct: 28,
    risk_buffer_pct: 15,
    after_hours_multiplier: 2,
    min_labour_hours: 2,
    gst_registered: true,
    licence_type: 'NSW electrical contractor licence',
    licence_state: 'NSW',
  },
  {
    hourly_rate: 120,
    call_out_minimum: 110,
    apprentice_rate: 70,
    default_markup_pct: 20,
    risk_buffer_pct: 15,
    min_labour_hours: 1.5,
    gst_registered: true,
    licence_type: 'QBCC',
    licence_state: 'QLD',
  },
  {
    hourly_rate: 95,
    call_out_minimum: 99,
    apprentice_rate: 55,
    default_markup_pct: 15,
    risk_buffer_pct: 10,
    min_labour_hours: null,
    gst_registered: false,
    licence_type: null,
    licence_state: null,
  },
  {
    hourly_rate: 135,
    call_out_minimum: 180,
    apprentice_rate: 75,
    senior_rate: 210,
    default_markup_pct: 35,
    risk_buffer_pct: 20,
    after_hours_multiplier: 1.75,
    min_labour_hours: 3,
    gst_registered: true,
    licence_type: 'VIC REC',
    licence_state: 'VIC',
  },
]

describe('estimator prompt parity — electrical', () => {
  BOOKS.forEach((book, i) => {
    it(`book #${i}: bundled-template fallback === electricalSystemPrompt()`, () => {
      // dbTemplate omitted → renderEstimatorSystemPrompt uses the bundled
      // template (the DB-unavailable path).
      expect(renderEstimatorSystemPrompt('electrical', book)).toBe(
        electricalSystemPrompt(book),
      )
    })

    it(`book #${i}: trade_prompts-template path === electricalSystemPrompt()`, () => {
      // dbTemplate supplied → simulates the trade_prompts row being read.
      expect(
        renderEstimatorSystemPrompt(
          'electrical',
          book,
          ELECTRICAL_ESTIMATOR_TEMPLATE,
        ),
      ).toBe(electricalSystemPrompt(book))
    })
  })
})

describe('estimator prompt parity — plumbing', () => {
  BOOKS.forEach((book, i) => {
    it(`book #${i}: bundled-template fallback === plumbingSystemPrompt()`, () => {
      expect(renderEstimatorSystemPrompt('plumbing', book)).toBe(
        plumbingSystemPrompt(book),
      )
    })

    it(`book #${i}: trade_prompts-template path === plumbingSystemPrompt()`, () => {
      expect(
        renderEstimatorSystemPrompt('plumbing', book, PLUMBING_ESTIMATOR_TEMPLATE),
      ).toBe(plumbingSystemPrompt(book))
    })
  })
})

// R11 (prompt half) — both estimator prompts must EXPLICITLY instruct the
// model to set source:"after_hours" / "after_hours_callout" on emergency
// after-hours lines (so the validator's after-hours accept branch can ground
// hourly×multiplier + call_out_minimum×multiplier) AND to NOT carry the tag
// on standard-hours lines. The validator's isAfterHours() only accepts those
// exact source tags, so the instruction has to name them verbatim.
describe('R11 — after-hours source-tag instruction present in both prompts', () => {
  // Books #0 and #3 carry an after_hours_multiplier > 1, so the emergency
  // branch renders concrete inflated rates; books #1/#2 leave it unset and
  // fall back to 1.5. The directive must be present regardless.
  BOOKS.forEach((book, i) => {
    it(`book #${i}: electrical prompt names the source-tag rule`, () => {
      const prompt = electricalSystemPrompt(book)
      expect(prompt).toContain('AFTER-HOURS SOURCE-TAGGING')
      // Names the EXACT source tags the validator's isAfterHours() accepts.
      expect(prompt).toContain('source: "after_hours"')
      expect(prompt).toContain('source: "after_hours_callout"')
      // Conditional on emergency urgency AND a >1 multiplier.
      expect(prompt).toContain("intake.timing.urgency === 'emergency'")
      expect(prompt).toContain('after_hours_multiplier')
      // Standard-hours lines must NOT carry the tag.
      expect(prompt).toMatch(/MUST NOT set source: "after_hours"/)
    })

    it(`book #${i}: plumbing prompt names the source-tag rule`, () => {
      const prompt = plumbingSystemPrompt(book)
      expect(prompt).toContain('AFTER-HOURS SOURCE-TAGGING')
      expect(prompt).toContain('source: "after_hours"')
      expect(prompt).toContain('source: "after_hours_callout"')
      expect(prompt).toContain("intake.timing.urgency === 'emergency'")
      expect(prompt).toContain('after_hours_multiplier')
      expect(prompt).toMatch(/MUST NOT set source: "after_hours"/)
    })

    it(`book #${i}: instruction is identical wording across both trades`, () => {
      // Extract the inserted block from each prompt and assert byte-identity,
      // so electrical + plumbing stay consistent (spec: "Keep it consistent
      // across electrical + plumbing").
      const grab = (p: string) => {
        const start = p.indexOf('AFTER-HOURS SOURCE-TAGGING')
        expect(start).toBeGreaterThan(-1)
        const end = p.indexOf('the validator rejects both.', start)
        expect(end).toBeGreaterThan(-1)
        return p.slice(start, end)
      }
      expect(grab(electricalSystemPrompt(book))).toBe(
        grab(plumbingSystemPrompt(book)),
      )
    })
  })
})
