// R1 (2026-09-02) — cross-type typed-ref resolution in the grounding
// validator.
//
// The incident this closes: Opus tagged an "Add RCBO safety switch" line
// `material:5b48eed9-…` when that UUID is a shared_ASSEMBLIES row ("Install 20A
// dedicated GPO", enabled for the tenant, description "Includes RCBO"). The
// strict path looked only in the declared table, found nothing, and failed two
// tiers — turning a fully priced EV charger quote into a $99 inspection.
//
// The rule the fix must NOT loosen: the row's own price still has to match.
import { describe, expect, it } from 'vitest'
import { buildCandidatePrices, validateQuoteGrounding, applyTypedRefRetags } from './validate'

const BOOK = {
  hourly_rate: 120,
  apprentice_rate: 60,
  call_out_minimum: 350,
  default_markup_pct: 14,
}

const ASSEMBLY_ID = '5b48eed9-3f37-4d1c-a3e2-d4afae0a5e20'

/** One assembly row priced at $85, no material rows — exactly the shape that
 *  made the live failure: the id exists, just not in the declared table. */
function candidates() {
  return buildCandidatePrices(
    [],
    [{ id: ASSEMBLY_ID, name: 'Install 20A dedicated GPO', price: 85, category: 'gpo' }],
    BOOK,
  )
}

/** A realistic single-tier draft: real installation labour (the validator
 *  enforces a per-tier minimum-labour floor, so a lone extra line is not a
 *  valid quote shape) plus the one upsell line under test. */
function draftWithRcboLine(price: number, source: string) {
  const LABOUR_HOURS = 3
  const labourTotal = LABOUR_HOURS * BOOK.hourly_rate
  return {
    needs_inspection: false,
    good: {
      line_items: [
        {
          description: 'Electrician labour — EV charger installation',
          quantity: LABOUR_HOURS,
          unit: 'hr',
          unit_price_ex_gst: BOOK.hourly_rate,
          total_ex_gst: labourTotal,
          source: 'labour',
        },
        {
          description: 'Add RCBO safety switch on the EV circuit',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: price,
          total_ex_gst: price,
          source,
        },
      ],
      subtotal_ex_gst: labourTotal + price,
    },
    better: null,
    best: null,
  }
}

describe('typed-ref cross-type resolution (R1)', () => {
  it('grounds a material:<assembly-uuid> line when the price matches the real row', () => {
    const res = validateQuoteGrounding(draftWithRcboLine(85, `material:${ASSEMBLY_ID}`), BOOK, candidates())
    expect(res.valid).toBe(true)
    expect(res.retags).toEqual([
      expect.objectContaining({
        tier: 'good',
        lineIndex: 1,
        id: ASSEMBLY_ID,
        from: 'material',
        to: 'assembly',
        sourceName: 'Install 20A dedicated GPO',
      }),
    ])
  })

  it('accepts the marked-up variant of the resolved row, same as a correctly typed ref', () => {
    // 85 × 1.14 = 96.90 — the tenant's configured markup.
    const res = validateQuoteGrounding(draftWithRcboLine(96.9, `material:${ASSEMBLY_ID}`), BOOK, candidates())
    expect(res.valid).toBe(true)
  })

  it('still FAILS when the price does not match the resolved row', () => {
    // $95 is the figure the old prompt hard-coded: neither raw (85) nor
    // marked-up (96.90). Cross-type resolution must not rescue it.
    const res = validateQuoteGrounding(draftWithRcboLine(95, `material:${ASSEMBLY_ID}`), BOOK, candidates())
    expect(res.valid).toBe(false)
    if (res.valid) throw new Error('unreachable')
    expect(res.failures).toHaveLength(1)
    // The message names the type it actually resolved, not the wrong prefix.
    expect(res.failures[0].expected).toContain(`assembly:${ASSEMBLY_ID}`)
    expect(res.retags ?? []).toHaveLength(0)
  })

  it('still FAILS when the uuid is in neither candidate table', () => {
    const res = validateQuoteGrounding(
      draftWithRcboLine(85, 'material:00000000-0000-4000-8000-000000000999'),
      BOOK,
      candidates(),
    )
    expect(res.valid).toBe(false)
    if (res.valid) throw new Error('unreachable')
    expect(res.failures[0].expected).toContain('not found in this tenant+trade candidate set')
  })

  it('prefers the DECLARED type when the id resolves in both tables', () => {
    const both = buildCandidatePrices(
      [{ id: ASSEMBLY_ID, name: 'RCBO safety switch', price: 85, category: 'safety_switch' }],
      [{ id: ASSEMBLY_ID, name: 'Install 20A dedicated GPO', price: 85, category: 'gpo' }],
      BOOK,
    )
    const res = validateQuoteGrounding(draftWithRcboLine(85, `material:${ASSEMBLY_ID}`), BOOK, both)
    expect(res.valid).toBe(true)
    // Declared type resolved, so nothing was retagged.
    expect(res.retags ?? []).toHaveLength(0)
  })

  it('leaves a correctly typed assembly ref untouched', () => {
    const res = validateQuoteGrounding(draftWithRcboLine(85, `assembly:${ASSEMBLY_ID}`), BOOK, candidates())
    expect(res.valid).toBe(true)
    expect(res.retags ?? []).toHaveLength(0)
  })
})

describe('applyTypedRefRetags', () => {
  it('rewrites the source prefix without mutating the input draft', () => {
    const draft = draftWithRcboLine(85, `material:${ASSEMBLY_ID}`)
    const res = validateQuoteGrounding(draft, BOOK, candidates())
    const next = applyTypedRefRetags(draft, res.retags)

    expect(next.good.line_items[1].source).toBe(`assembly:${ASSEMBLY_ID}`)
    // Input untouched — the validator is pure and so is this.
    expect(draft.good.line_items[1].source).toBe(`material:${ASSEMBLY_ID}`)
    expect(next).not.toBe(draft)
  })

  it('is a no-op when there are no retags', () => {
    const draft = draftWithRcboLine(85, `assembly:${ASSEMBLY_ID}`)
    expect(applyTypedRefRetags(draft, undefined)).toBe(draft)
    expect(applyTypedRefRetags(draft, [])).toBe(draft)
  })

  it('skips a line whose source changed since validation ran', () => {
    const draft = draftWithRcboLine(85, `material:${ASSEMBLY_ID}`)
    const res = validateQuoteGrounding(draft, BOOK, candidates())
    const moved = draftWithRcboLine(85, 'labour')
    const next = applyTypedRefRetags(moved, res.retags)
    expect(next.good.line_items[1].source).toBe('labour')
  })
})

describe('typed ref present in BOTH candidate tables (spec edge case)', () => {
  it('keeps the declared type AND reports the collision for logging', () => {
    const both = buildCandidatePrices(
      [{ id: ASSEMBLY_ID, name: 'RCBO safety switch', price: 85, category: 'safety_switch' }],
      [{ id: ASSEMBLY_ID, name: 'Install 20A dedicated GPO', price: 85, category: 'gpo' }],
      BOOK,
    )
    const res = validateQuoteGrounding(draftWithRcboLine(85, `material:${ASSEMBLY_ID}`), BOOK, both)
    expect(res.valid).toBe(true)
    // Declared type wins — no retag.
    expect(res.retags ?? []).toHaveLength(0)
    // ...but the collision is surfaced, which is what "log" requires.
    expect(res.ambiguousTypedRefs).toEqual([
      expect.objectContaining({
        tier: 'good',
        lineIndex: 1,
        id: ASSEMBLY_ID,
        declaredType: 'material',
      }),
    ])
  })

  it('reports nothing when the id lives in only one table', () => {
    const res = validateQuoteGrounding(
      draftWithRcboLine(85, `assembly:${ASSEMBLY_ID}`),
      BOOK,
      candidates(),
    )
    expect(res.ambiguousTypedRefs).toBeUndefined()
  })
})
