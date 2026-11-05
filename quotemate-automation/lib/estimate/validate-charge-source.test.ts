import { describe, expect, it } from 'vitest'
import { buildCandidatePrices, validateQuoteGrounding, type PricingBookForValidation } from './validate'
import { stripUngroundedUpsellLines } from './upsell-guard'
import { filterIncludedOptionalUpsells } from './optional-extras'

const book: PricingBookForValidation = {
  hourly_rate: 150,
  apprentice_rate: 80,
  call_out_minimum: 150,
  default_markup_pct: 30,
  min_labour_hours: 2,
  after_hours_multiplier: 2,
}
const labour = { description: 'Installation labour', source: 'labour', unit: 'hr', quantity: 3, unit_price_ex_gst: 150 }
const empty = buildCandidatePrices([], [], book)
const draft = (line: Record<string, unknown>) => ({ good: { line_items: [labour, { quantity: 1, unit: 'each', ...line }] } })

describe('charge identity before rate equality', () => {
  it.each(['labour', 'material:invented-charger', 'assembly:invented-assembly', 'material', ''])('rejects a charger/assessment at the callout amount with source %s', (source) => {
    const result = validateQuoteGrounding(draft({ description: 'Switchboard health check and load assessment', source, unit_price_ex_gst: 150 }), book, empty)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.failures).toEqual(expect.arrayContaining([expect.objectContaining({ lineIndex: 1 })]))
  })

  it('does not bypass an explicit catalogue row when its incorrect price equals callout', () => {
    const candidates = buildCandidatePrices([{ id: 'charger-real', name: 'EV charger unit', price: 600 }], [], book)
    expect(validateQuoteGrounding(draft({ description: 'EV charger unit', source: 'material:charger-real', unit_price_ex_gst: 150 }), book, candidates).valid).toBe(false)
  })

  it('does not turn a forged material into a callout by naming it Call-out', () => {
    expect(validateQuoteGrounding(draft({ description: 'Call-out', source: 'material:invented', unit_price_ex_gst: 150 }), book, empty).valid).toBe(false)
  })

  it.each(['material:invented-charger', 'assembly:invented-assembly'])('does not borrow an hourly rate for a catalogue charge (%s)', (source) => {
    expect(validateQuoteGrounding(draft({ description: 'EV charger unit', source, unit: 'hr', unit_price_ex_gst: 150 }), book, empty).valid).toBe(false)
  })

  it('accepts a genuine catalogue each price even when equal to the callout amount', () => {
    const candidates = buildCandidatePrices([], [{ id: 'health-real', name: 'Switchboard health check', price: 150 }], book)
    expect(validateQuoteGrounding(draft({ description: 'Switchboard health check', source: 'assembly:health-real', unit_price_ex_gst: 150 }), book, candidates).valid).toBe(true)
  })

  it('preserves assembly-tagged labour when its assembly exists and the hourly rate grounds', () => {
    const candidates = buildCandidatePrices([], [{ id: 'install-real', name: 'Install EV charger', price: 120 }], book)
    const line = { description: 'Install EV charger labour', source: 'assembly:install-real', unit: 'hr', unit_price_ex_gst: 150 }
    expect(validateQuoteGrounding(draft(line), book, candidates).valid).toBe(true)
    expect(validateQuoteGrounding(draft({ ...line, unit_price_ex_gst: 700 }), book, candidates).valid).toBe(false)
  })

  it('does not ground a labour/each tag through an unrelated each catalogue row either', () => {
    const candidates = buildCandidatePrices([], [{ id: 'health-real', name: 'Switchboard health check', price: 150 }], book)
    expect(validateQuoteGrounding(draft({ description: 'Switchboard health check', source: 'labour', unit_price_ex_gst: 150 }), book, candidates).valid).toBe(false)
  })

  it.each(['callout', ' CALLOUT ', undefined])('retains standard callouts with typed or legacy source %s', (source) => {
    expect(validateQuoteGrounding(draft({ description: 'Diagnostic call-out', source, unit_price_ex_gst: 150 }), book, empty).valid).toBe(true)
  })

  it.each(['after_hours_callout', 'emergency_callout', 'after_hours'])('retains a correctly tagged after-hours callout (%s)', (source) => {
    expect(validateQuoteGrounding(draft({ description: 'Emergency call-out', source, unit_price_ex_gst: 300 }), book, empty).valid).toBe(true)
  })

  it('does not use an after-hours tag to price an each assessment or product', () => {
    expect(validateQuoteGrounding(draft({ description: 'Switchboard health check', source: 'after_hours', unit_price_ex_gst: 300 }), book, empty).valid).toBe(false)
  })

  it('does not accept an hourly callout or a sourceless after-hours surcharge', () => {
    expect(validateQuoteGrounding(draft({ description: 'Call-out', source: 'callout', unit: 'hr', unit_price_ex_gst: 150 }), book, empty).valid).toBe(false)
    expect(validateQuoteGrounding(draft({ description: 'Emergency call-out', unit_price_ex_gst: 300 }), book, empty).valid).toBe(false)
  })
})

describe('EST-0018 stored pricing regression', () => {
  it('finds both ungrounded extras, removes their charges and clears advertised optional prices', () => {
    // Exact identities/amounts from the stored quote; no contact information.
    const assemblyId = '5b48eed9-3f37-4d1c-a3e2-d4afae0a5e32'
    const installation = { description: 'Install 32A three-phase outlet', source: `assembly:${assemblyId}`, unit: 'each', quantity: 1, unit_price_ex_gst: 156 }
    const health = { description: 'Switchboard health check and load assessment', source: 'labour', unit: 'each', quantity: 1, unit_price_ex_gst: 150 }
    const capacity = { description: 'Capacity/load verification allowance', source: 'risk_buffer', unit: 'hr', quantity: 0.3, unit_price_ex_gst: 150 }
    const rcbo = { description: 'Add RCBO safety switch', source: 'material:unavailable-rcbo', unit: 'each', quantity: 1, unit_price_ex_gst: 95 }
    const input = {
      good: { line_items: [installation, labour, capacity], subtotal_ex_gst: 651 },
      better: { line_items: [installation, labour, health, capacity], subtotal_ex_gst: 801 },
      best: { line_items: [installation, labour, health, capacity, rcbo], subtotal_ex_gst: 896 },
      optional_upsells: [{ name: 'Add RCBO safety switch', price_ex_gst: 95 }, { name: 'Switchboard health check', price_ex_gst: 150 }],
    }
    const candidates = buildCandidatePrices([], [{ id: assemblyId, name: installation.description, price: 120, category: 'gpo' }], book)
    const result = validateQuoteGrounding(input, book, candidates)
    expect(result.valid).toBe(false)
    if (result.valid) throw new Error('Stored quote must fail grounding')
    expect(result.failures.map((failure) => failure.description)).toEqual([
      health.description, health.description, rcbo.description,
    ])
    const stripped = stripUngroundedUpsellLines(input, result.failures)
    expect(stripped.draft.better.subtotal_ex_gst).toBe(651)
    expect(stripped.draft.best.subtotal_ex_gst).toBe(651)
    expect(stripped.draft.optional_upsells.every((item) => item.price_ex_gst === null)).toBe(true)
    expect(validateQuoteGrounding(stripped.draft, book, candidates).valid).toBe(true)
    // The same generic RCBO extra remains unnecessary after its rejected
    // separate charge is removed: the installation assembly includes it.
    expect(filterIncludedOptionalUpsells(stripped.draft.optional_upsells, stripped.draft.better, [{
      id: assemblyId, description: 'Dedicated circuit, three-phase RCBO and certification',
    }]).map((item) => item.name)).toEqual(['Switchboard health check'])
    // This arithmetic verifies the guard only; supply/design approval is
    // separately required and this is not a replacement customer quote.
    expect(input.better.subtotal_ex_gst).toBe(801)
  })
})
