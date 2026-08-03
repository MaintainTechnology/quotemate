// Phase 4 R7 — two ordering defects found by adversarial review of 5c2d4d50.
//
// Both were proven with probes against the committed code by two independent
// reviewers who converged on the same root cause. Both put a REQUIRED part at
// risk, which is the exact failure this phase keeps circling.
//
// ── DEFECT 1: the condition was evaluated too late ──────────────────────
// shouldIncludeLine ran AFTER the resolver-null check and AFTER the quantity
// guard. So a required line the condition would have DROPPED was still sent
// to resolveMaterial first, and when nothing could price it the line went to
// missingRequired -> buildDeterministicTiers returns {tiers:null} -> the
// quote routes to the $99 inspection.
//
// Production made this certain rather than theoretical: electrical
// shared_materials holds only ceiling_fan, downlight, gpo, outdoor_light,
// safety_switch, smoke_alarm and sundries, and no tenant catalogue row is a
// driver or a dimmer. So the FIRST tradie to seed the R9 condition this phase
// exists to support would have turned every correct integrated-driver quote
// into a $99 inspection. A condition whose whole job is "this part is not
// needed" cannot require the part to be priceable first.
//
// ── DEFECT 2: the headline could be a line that never ships ─────────────
// The headline scan filtered on include_when and SUNDRY_RE only. It could
// therefore pick:
//   · an OPTIONAL line that the optional/includeOptional short-circuit drops,
//   · a quantity_per RATIO line (scaleBomToItemCount deliberately excludes
//     those from headline consideration; this scan did not), and
//   · it walked ARRAY order while scaleBomToItemCount walks `sort` order.
// Result: every condition on the job judged against a product that was never
// priced, never shown and never billed — and with missingRequired empty, the
// quote shipped silently.
//
// The headline candidate must be a line that will actually be EMITTED:
// required (or optional when includeOptional), non-sundry, non-ratio, and
// chosen in `sort` order so it agrees with scaleBomToItemCount.

import { describe, it, expect } from 'vitest'
import { buildBomQuoteLines, type BomLine } from './catalogue'
import { buildDeterministicTiers } from './deterministic-bom'
import type { TenantMaterial } from './catalogue'

const NO_LABOUR = { labourHours: 0, labourRate: 0 }

describe('DEFECT 1 — an excluded line must not need to be priceable', () => {
  const bom: BomLine[] = [
    { material_category: 'downlight', quantity: 2, required: true },
    // The condition says: only include a separate driver when the light does
    // NOT have one built in. The light DOES, so this line is not needed.
    { material_category: 'driver', quantity: 1, required: true, include_when: { integrated_driver: false } },
  ]
  // No driver product exists anywhere — exactly the production situation.
  const resolve = (l: BomLine) =>
    l.material_category === 'downlight'
      ? { name: 'Integrated DL', markedUpPrice: 30, properties: { integrated_driver: true } }
      : null

  it('does not report missingRequired for a part the condition removed', () => {
    const { lines, missingRequired } = buildBomQuoteLines({ bom, resolveMaterial: resolve, ...NO_LABOUR })
    expect(missingRequired, 'an unneeded part must not look missing').toEqual([])
    expect(lines.map((l) => l.description)).toEqual(['Integrated DL'])
  })

  it('so the deterministic build still produces tiers instead of an inspection', () => {
    const cat: TenantMaterial[] = [
      { id: 'dl', category: 'downlight', name: 'Integrated DL', unit_price_ex_gst: 30, active: true, properties: { integrated_driver: true } },
    ]
    const r = buildDeterministicTiers({
      bom,
      tenantMaterials: cat,
      sharedMaterials: [],
      labourHours: 1,
      hourlyRate: 100,
      markupPct: 0,
    })
    expect(r.tiers, `routed to inspection: ${r.reason ?? ''}`).not.toBeNull()
  })

  it('same for a zero quantity — the guard must not pre-empt the condition', () => {
    const { missingRequired } = buildBomQuoteLines({
      bom: [
        { material_category: 'downlight', quantity: 2, required: true },
        { material_category: 'driver', quantity: 0, required: true, include_when: { integrated_driver: false } },
      ],
      resolveMaterial: (l) =>
        l.material_category === 'downlight'
          ? { name: 'Integrated DL', markedUpPrice: 30, properties: { integrated_driver: true } }
          : { name: 'LED driver', markedUpPrice: 35 },
      ...NO_LABOUR,
    })
    expect(missingRequired).toEqual([])
  })

  it('but a required line the condition KEEPS still reports missing when unpriceable', () => {
    // The guard must not be weakened into never reporting anything.
    const { missingRequired } = buildBomQuoteLines({
      bom: [
        { material_category: 'downlight', quantity: 2, required: true },
        { material_category: 'driver', quantity: 1, required: true, include_when: { integrated_driver: false } },
      ],
      resolveMaterial: (l) =>
        l.material_category === 'downlight'
          ? { name: 'Plain DL', markedUpPrice: 30, properties: { integrated_driver: false } }
          : null,
      ...NO_LABOUR,
    })
    expect(missingRequired).toEqual(['driver'])
  })
})

describe('DEFECT 2 — the headline must be a line that actually ships', () => {
  it('an OPTIONAL line cannot supply the attributes conditions are judged by', () => {
    // The hub is optional and dropped, so it must not decide anything. The
    // downlight needs its driver and the driver is priceable.
    const { lines, missingRequired } = buildBomQuoteLines({
      bom: [
        { material_category: 'smart_hub', quantity: 1, required: false },
        { material_category: 'downlight', quantity: 2, required: true },
        { material_category: 'driver', quantity: 1, required: true, include_when: { integrated_driver: false } },
      ],
      resolveMaterial: (l) =>
        l.material_category === 'smart_hub'
          ? { name: 'Smart hub', markedUpPrice: 90, properties: { integrated_driver: true } }
          : l.material_category === 'downlight'
            ? { name: 'Plain DL', markedUpPrice: 30, properties: { integrated_driver: false } }
            : { name: 'LED driver', markedUpPrice: 35 },
      ...NO_LABOUR,
    })
    expect(lines.map((l) => l.description), 'the driver was dropped by an excluded line').toEqual([
      'Plain DL',
      'LED driver',
    ])
    expect(missingRequired).toEqual([])
  })

  it('a quantity_per RATIO line cannot be the headline', () => {
    // scaleBomToItemCount already excludes ratio lines from headline
    // consideration. This scan has to agree with it or the two disagree about
    // what the job IS.
    const { lines } = buildBomQuoteLines({
      bom: [
        { material_category: 'driver', quantity: 3, required: true, quantity_per: 4 },
        { material_category: 'downlight', quantity: 10, required: true },
        { material_category: 'dimmer', quantity: 1, required: false, include_when: { smart: true } },
      ],
      resolveMaterial: (l) =>
        l.material_category === 'driver'
          ? { name: 'LED driver', markedUpPrice: 35, properties: { smart: false } }
          : l.material_category === 'downlight'
            ? { name: 'Smart DL', markedUpPrice: 30, properties: { smart: true } }
            : { name: 'Smart dimmer', markedUpPrice: 55 },
      ...NO_LABOUR,
    })
    expect(lines.map((l) => l.description), 'the ratio line hijacked the headline').toContain('Smart dimmer')
  })

  it('the headline is chosen by `sort`, not array order', () => {
    // Agrees with scaleBomToItemCount, which sorts. A caller that maps or
    // concatenates can hand these over shuffled.
    const { lines } = buildBomQuoteLines({
      bom: [
        { material_category: 'gpo', quantity: 1, required: true, sort: 2 } as BomLine,
        { material_category: 'downlight', quantity: 2, required: true, sort: 1 } as BomLine,
        { material_category: 'dimmer', quantity: 1, required: false, include_when: { smart: true } },
      ],
      resolveMaterial: (l) =>
        l.material_category === 'gpo'
          ? { name: 'A GPO', markedUpPrice: 40, properties: { smart: false } }
          : l.material_category === 'downlight'
            ? { name: 'Smart DL', markedUpPrice: 30, properties: { smart: true } }
            : { name: 'Smart dimmer', markedUpPrice: 55 },
      ...NO_LABOUR,
    })
    expect(lines.map((l) => l.description)).toContain('Smart dimmer')
  })

  it('an optional line CAN be the headline when includeOptional is on', () => {
    // Then it does ship, so it is a legitimate description of the job.
    const { lines } = buildBomQuoteLines({
      bom: [
        { material_category: 'downlight', quantity: 2, required: false },
        { material_category: 'dimmer', quantity: 1, required: false, include_when: { smart: true } },
      ],
      resolveMaterial: (l) =>
        l.material_category === 'downlight'
          ? { name: 'Smart DL', markedUpPrice: 30, properties: { smart: true } }
          : { name: 'Smart dimmer', markedUpPrice: 55 },
      includeOptional: true,
      ...NO_LABOUR,
    })
    expect(lines.map((l) => l.description)).toEqual(['Smart DL', 'Smart dimmer'])
  })
})
