import { describe, expect, it } from 'vitest'
import { calculateAuthoritativeQuote, exactDecimalNumber, exactMarkedUpCents, exactPriceCents, type QuoteCoreInput } from './quote-core'

const base = (): QuoteCoreInput => ({
  tenantId: 'tenant-a', pricingBookVersionId: 'book-1', recipeSourceId: 'recipe-1',
  serviceMode: 'supply_and_install', gstRegistered: true,
  sources: [{ id: 'product-1', tenantId: 'tenant-a', pricingBookVersionId: 'book-1', approved: true,
    active: true, kind: 'catalogue', unitPriceCents: 100 }],
  lines: [{ id: 'line-1', sourceId: 'product-1', role: 'supply', quantity: 2, markupPct: '0.5' }],
})

describe('Quote Core exact arithmetic', () => {
  it('rounds a decimal markup half-cent up without float drift, then applies quantity and GST', () => {
    const result = calculateAuthoritativeQuote(base())
    expect(result).toMatchObject({ ok: true, calculation: {
      tenantId: 'tenant-a', pricingBookVersionId: 'book-1', recipeSourceId: 'recipe-1',
      subtotalExGstCents: 202, gstCents: 20, totalIncGstCents: 222,
      lines: [{ sourceId: 'product-1', sourceUnitPriceCents: 100, unitPriceCents: 101, totalExGstCents: 202 }],
    } })
  })

  it('rounds fractional quantities per line and GST once on the subtotal', () => {
    const input = base()
    input.sources[0].unitPriceCents = 10
    input.lines[0] = { ...input.lines[0], quantity: '0.5', markupPct: 0 }
    expect(calculateAuthoritativeQuote(input)).toMatchObject({ ok: true, calculation: {
      subtotalExGstCents: 5, gstCents: 1, totalIncGstCents: 6,
    } })
    input.gstRegistered = false
    expect(calculateAuthoritativeQuote(input)).toMatchObject({ ok: true, calculation: {
      subtotalExGstCents: 5, gstCents: 0, totalIncGstCents: 5,
    } })
  })

  it('preserves decimal currency conversion and rejects sub-cent or malformed source prices', () => {
    expect(exactPriceCents('0.29')).toBe(29)
    expect(exactPriceCents(1.01)).toBe(101)
    expect(exactPriceCents('1e2')).toBe(10000)
    for (const value of ['1.005', '', '12oops', 'Infinity', '-2', '0x10', '1e10000']) {
      expect(exactPriceCents(value)).toBeNull()
    }
    expect(exactMarkedUpCents(100, '0.5')).toBe(101)
    expect(exactDecimalNumber('0.500')).toBe(0.5)
    expect(exactDecimalNumber('0.12345678901234567890')).toBeNull()
  })

  it('rejects unsafe integer source amounts and overflow after GST', () => {
    const input = base()
    input.sources[0].unitPriceCents = Number.MAX_SAFE_INTEGER
    input.lines[0] = { ...input.lines[0], quantity: 1, markupPct: 0 }
    expect(calculateAuthoritativeQuote(input)).toMatchObject({ ok: false, code: 'invalid_amount' })
    input.sources[0].unitPriceCents = 1.5
    expect(calculateAuthoritativeQuote(input)).toMatchObject({ ok: false, code: 'invalid_amount' })
  })

  it('returns JSON-safe stable traces for identical inputs', () => {
    expect(calculateAuthoritativeQuote(base())).toEqual(calculateAuthoritativeQuote(base()))
    expect(() => JSON.stringify(calculateAuthoritativeQuote(base()))).not.toThrow()
  })
})

describe('Quote Core source authority', () => {
  it.each(['tenantId', 'pricingBookVersionId', 'recipeSourceId'] as const)('requires %s', (key) => {
    const input = base(); input[key] = ''
    expect(calculateAuthoritativeQuote(input)).toMatchObject({ ok: false, code: 'missing_authority' })
  })

  it.each(['tenantId', 'pricingBookVersionId'] as const)('rejects a source from another %s', (key) => {
    const input = base(); input.sources[0][key] = 'another'
    expect(calculateAuthoritativeQuote(input)).toMatchObject({ ok: false, code: 'source_scope_mismatch' })
  })

  it.each(['approved', 'active'] as const)('requires the source to be %s', (key) => {
    const input = base(); input.sources[0][key] = false
    expect(calculateAuthoritativeQuote(input)).toMatchObject({ ok: false, code: 'unapproved_source' })
  })

  it('fails for missing or ambiguous sources without producing any totals', () => {
    const input = base(); input.sources = []
    expect(calculateAuthoritativeQuote(input)).toEqual({ ok: false, code: 'missing_price', reason: 'Missing price source: product-1' })
    const duplicate = base(); duplicate.sources.push({ ...duplicate.sources[0] })
    expect(calculateAuthoritativeQuote(duplicate)).toMatchObject({ ok: false, code: 'ambiguous_source' })
    const duplicateLine = base(); duplicateLine.lines.push({ ...duplicateLine.lines[0] })
    expect(calculateAuthoritativeQuote(duplicateLine)).toMatchObject({ ok: false, code: 'ambiguous_source' })
  })

  it.each([0, -1, NaN, '', '1e9999'])('rejects invalid quantities %s', (quantity) => {
    const input = base(); input.lines[0].quantity = quantity
    expect(calculateAuthoritativeQuote(input)).toMatchObject({ ok: false, code: 'invalid_quantity' })
  })

  it('rejects negative markups', () => {
    const input = base(); input.lines[0].markupPct = -1
    expect(calculateAuthoritativeQuote(input)).toMatchObject({ ok: false, code: 'invalid_markup' })
  })
})

describe('Quote Core service scope', () => {
  it('allows product supply only and rejects installation labour on that job', () => {
    const input = base(); input.serviceMode = 'supply_only'
    expect(calculateAuthoritativeQuote(input).ok).toBe(true)
    input.sources[0].kind = 'labour_rate'; input.lines[0].role = 'labour'
    expect(calculateAuthoritativeQuote(input)).toMatchObject({ ok: false, code: 'service_mode_conflict' })
  })

  it('allows install-only consumables while refusing to bill the customer-supplied product', () => {
    const input = base(); input.serviceMode = 'install_only'
    expect(calculateAuthoritativeQuote(input)).toMatchObject({ ok: false, code: 'service_mode_conflict' })
    input.lines[0].role = 'installation_material'
    expect(calculateAuthoritativeQuote(input).ok).toBe(true)
  })

  it('rejects relabelling a catalogue product as a labour price', () => {
    const input = base(); input.lines[0].role = 'labour'
    expect(calculateAuthoritativeQuote(input)).toMatchObject({ ok: false, code: 'service_mode_conflict' })
  })

  it('never uses an unspecified material role to bypass supply-only or install-only scope', () => {
    const input = base(); input.lines[0].role = 'material'
    expect(calculateAuthoritativeQuote(input).ok).toBe(true)
    for (const serviceMode of ['supply_only', 'install_only'] as const) {
      input.serviceMode = serviceMode
      expect(calculateAuthoritativeQuote(input)).toMatchObject({ ok: false, code: 'service_mode_conflict' })
    }
  })
})
