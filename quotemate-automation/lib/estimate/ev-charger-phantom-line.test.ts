// ═══════════════════════════════════════════════════════════════════
// Regression: a $0 phantom EV charger unit line must not ghost the
// customer.
//
// Live 2026-09-04 (Sparky, +61468048422, intake 31799f4f). Opus turned
// the WP5 description prefix "Customer to supply - ..." into the ref
// `material:customer` and emitted it as a $0 line in ALL THREE tiers:
//
//   description: "Customer to supply - Tesla Wall Connector EV charger"
//   unit: each   unit_price_ex_gst: 0   source: "material:customer"
//
// `material:customer` matches no candidate row, so validateQuoteGrounding
// (run.ts:866) failed 3/3 and the run bailed to the "hold priced draft
// for tradie review" branch — which is BELOW the real EV customer-supply
// fence at run.ts:1406, so the fence never got a turn. Net effect: the
// customer was told "quote's on its way shortly" and received nothing.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest'
import { dropUnpricedPhantomEvChargerLines } from './ev-charger-supply'

const phantom = {
  description: 'Customer to supply - Tesla Wall Connector EV charger',
  quantity: 1,
  unit: 'each',
  unit_price_ex_gst: 0,
  total_ex_gst: 0,
  source: 'material:customer',
}
const install = {
  description: 'Install EV charger on new dedicated single-phase circuit',
  quantity: 1,
  unit: 'each',
  unit_price_ex_gst: 136.8,
  total_ex_gst: 136.8,
  source: 'assembly:52f354d2-a5e3-4d9f-a7c9-aa13cbe020c7',
}
const labour = {
  description: 'Installation labour - run dedicated circuit, terminate, test',
  quantity: 3,
  unit: 'hr',
  unit_price_ex_gst: 120,
  total_ex_gst: 360,
  source: 'labour',
}

const draft = () => ({
  good: { line_items: [phantom, install, labour], subtotal_ex_gst: 496.8 },
  better: { line_items: [phantom, install, labour], subtotal_ex_gst: 496.8 },
  best: { line_items: [phantom, install, labour], subtotal_ex_gst: 496.8 },
})

describe('dropUnpricedPhantomEvChargerLines', () => {
  it('drops the $0 hallucinated unit line from every tier', () => {
    const r = dropUnpricedPhantomEvChargerLines(draft(), { jobType: 'ev_charger', candidates: null })
    expect(r.dropped).toHaveLength(3)
    for (const tier of ['good', 'better', 'best'] as const) {
      expect(r.draft[tier].line_items).toHaveLength(2)
      expect(r.draft[tier].line_items.map((l: any) => l.source)).not.toContain('material:customer')
    }
  })

  it('keeps the install assembly and labour untouched — money must not move', () => {
    const r = dropUnpricedPhantomEvChargerLines(draft(), { jobType: 'ev_charger', candidates: null })
    const items = r.draft.good.line_items as any[]
    expect(items.map((l) => l.source)).toEqual([install.source, 'labour'])
    // The phantom was $0, so no subtotal can change.
    expect(items.reduce((n, l) => n + l.total_ex_gst, 0)).toBeCloseTo(496.8, 2)
  })

  it('leaves a PRICED charger unit line alone (the real fence judges that)', () => {
    const priced = { ...phantom, unit_price_ex_gst: 1200, total_ex_gst: 1200 }
    const r = dropUnpricedPhantomEvChargerLines(
      { good: { line_items: [priced, install, labour] } },
      { jobType: 'ev_charger', candidates: null },
    )
    expect(r.dropped).toHaveLength(0)
    expect(r.draft.good.line_items).toHaveLength(3)
  })

  it('does nothing for a non-EV job', () => {
    const r = dropUnpricedPhantomEvChargerLines(draft(), { jobType: 'downlights', candidates: null })
    expect(r.dropped).toHaveLength(0)
    expect(r.draft.good.line_items).toHaveLength(3)
  })

  it('never drops labour or assembly lines even if worded like a charger', () => {
    const worded = { ...labour, description: 'Labour to fit EV charger wall connector' }
    const r = dropUnpricedPhantomEvChargerLines(
      { good: { line_items: [{ ...worded, unit_price_ex_gst: 0, total_ex_gst: 0 }] } },
      { jobType: 'ev_charger', candidates: null },
    )
    expect(r.dropped).toHaveLength(0)
  })

  it('leaves an ANCHORED $0 unit line to the existing fence', () => {
    const anchoredId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const r = dropUnpricedPhantomEvChargerLines(
      { good: { line_items: [{ ...phantom, source: `material:${anchoredId}` }] } },
      {
        jobType: 'ev_charger',
        candidates: { material: [{ sourceId: anchoredId, categories: new Set(['ev_charger']) }] } as any,
      },
    )
    expect(r.dropped).toHaveLength(0)
  })
})
