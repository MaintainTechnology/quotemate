// Phase 2b — a tradie can tag a catalogue product's attributes.
//
// The column and its GIN index have existed since migrations 028/082, but
// nothing tradie-facing could ever write it, so it is empty on every row.
//
// The load-bearing risk is the WRITE, not the read. PATCH does a bare
// `.update(fields)` on tenant_material_catalogue, so assigning `properties`
// wholesale replaces the jsonb and destroys keys other code owns — notably
// `amperage`, which a GPO backfill wrote to feed the spec guard. Hence a
// merge, proven here.
//
// Pure — no DB, no route. Co-located per the 486-file lib/ convention.

import { describe, it, expect } from 'vitest'
import { MaterialCatalogueSchema } from './update-schema'
import { mergeProductProperties, PRODUCT_ATTRIBUTE_KEYS } from './catalogue-properties'

const base = {
  trade: 'electrical' as const,
  category: 'downlight',
  name: 'Brilliant Halo 90 9W LED downlight',
  unit_price_ex_gst: 42,
}

describe('Phase 2b — the properties field on MaterialCatalogueSchema', () => {
  it('accepts the three known attributes', () => {
    const r = MaterialCatalogueSchema.safeParse({
      ...base,
      properties: { smart: true, dimmable: false, integrated_driver: true },
    })
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true)
  })

  it('is optional — an existing caller that omits it still validates', () => {
    expect(MaterialCatalogueSchema.safeParse(base).success).toBe(true)
  })

  it('rejects an unknown attribute key rather than storing a key no filter reads', () => {
    // An open z.record would let `smrt: true` through, and it would then sit in
    // the jsonb forever matching nothing. applyPropertyFilters only reads
    // specific keys, so the writer has to be closed too.
    const r = MaterialCatalogueSchema.safeParse({ ...base, properties: { smrt: true } })
    expect(r.success).toBe(false)
  })

  it('rejects a non-boolean value — properties->>smart is compared to the string "true"', () => {
    expect(MaterialCatalogueSchema.safeParse({ ...base, properties: { smart: 'yes' } }).success)
      .toBe(false)
    expect(MaterialCatalogueSchema.safeParse({ ...base, properties: { smart: 1 } }).success)
      .toBe(false)
  })

  it('exports the attribute keys applyPropertyFilters actually reads', () => {
    // smart and dimmable are already strict-true filters in
    // lib/estimate/tools.ts:103-104. Matching those names verbatim is what
    // makes tagging effective with no reader change.
    expect(PRODUCT_ATTRIBUTE_KEYS).toContain('smart')
    expect(PRODUCT_ATTRIBUTE_KEYS).toContain('dimmable')
    expect(PRODUCT_ATTRIBUTE_KEYS).toContain('integrated_driver')
  })
})

describe('Phase 2b — mergeProductProperties never destroys a key it does not own', () => {
  it('preserves amperage, which a GPO backfill writes for the spec guard', () => {
    const merged = mergeProductProperties({ amperage: '10A' }, { smart: true })
    expect(merged).toEqual({ amperage: '10A', smart: true })
  })

  it('preserves every unrelated key, not just amperage', () => {
    const merged = mergeProductProperties(
      { amperage: '20A', colour_temp: '4000K', weatherproof: true },
      { dimmable: true },
    )
    expect(merged.amperage).toBe('20A')
    expect(merged.colour_temp).toBe('4000K')
    expect(merged.weatherproof).toBe(true)
    expect(merged.dimmable).toBe(true)
  })

  it('lets a tradie turn an attribute OFF — false must persist, not vanish', () => {
    const merged = mergeProductProperties({ smart: true, amperage: '10A' }, { smart: false })
    expect(merged.smart).toBe(false)
    expect(merged.amperage).toBe('10A')
  })

  it('stores real JSON booleans so the ->> text accessor yields "true"', () => {
    const merged = mergeProductProperties({}, { smart: true })
    expect(typeof merged.smart).toBe('boolean')
    // This is precisely what query.eq('properties->>smart', 'true') compares.
    expect(String(merged.smart)).toBe('true')
  })

  it('treats a null or absent existing column as an empty object', () => {
    expect(mergeProductProperties(null, { smart: true })).toEqual({ smart: true })
    expect(mergeProductProperties(undefined, { dimmable: true })).toEqual({ dimmable: true })
  })

  it('is a no-op when there is nothing incoming', () => {
    expect(mergeProductProperties({ amperage: '10A' }, undefined)).toEqual({ amperage: '10A' })
    expect(mergeProductProperties({ amperage: '10A' }, {})).toEqual({ amperage: '10A' })
  })

  it('ignores an unknown incoming key even if one slips past validation', () => {
    const merged = mergeProductProperties({ amperage: '10A' }, { smrt: true } as never)
    expect(merged).toEqual({ amperage: '10A' })
  })
})
