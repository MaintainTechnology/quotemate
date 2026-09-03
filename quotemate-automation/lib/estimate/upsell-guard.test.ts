// R2 (2026-09-02) — an OPTIONAL UPSELL must never sink a priced quote.
//
// Live 2026-09-01: "Switchboard health check" at $150 — a figure no catalogue
// row carries, offered by the estimator prompt itself — was folded into the
// best tier and failed grounding. Together with two mis-tagged RCBO lines it
// turned a fully priced EV charger quote into a $99 inspection.
import { describe, expect, it } from 'vitest'
import type { DraftWithTiers } from './merge-recipes'
import type { GroundingFailure } from './validate'
import { isUpsellDescription, stripUngroundedUpsellLines } from './upsell-guard'

const labour = {
  description: 'Electrician labour',
  quantity: 3,
  unit: 'hr',
  unit_price_ex_gst: 120,
  total_ex_gst: 360,
  source: 'labour',
}
const install = {
  description: 'Install EV charger',
  quantity: 1,
  unit: 'each',
  unit_price_ex_gst: 120,
  total_ex_gst: 120,
  source: 'assembly:ev-install',
}
const healthCheck = {
  description: 'Switchboard health check',
  quantity: 1,
  unit: 'each',
  unit_price_ex_gst: 150,
  total_ex_gst: 150,
  source: 'material:made-up',
}

function failure(over: Partial<GroundingFailure> = {}): GroundingFailure {
  return {
    tier: 'best',
    lineIndex: 2,
    description: 'Switchboard health check',
    unit: 'each',
    unit_price_ex_gst: 150,
    expected: 'shared_materials/shared_assemblies (raw or × 14% markup)',
    ...over,
  }
}

function draft(): DraftWithTiers {
  return {
    needs_inspection: false,
    good: { line_items: [labour, install], subtotal_ex_gst: 480 },
    better: null,
    best: { line_items: [labour, install, healthCheck], subtotal_ex_gst: 630 },
  }
}

describe('isUpsellDescription', () => {
  it('recognises every upsell the electrical prompt offers', () => {
    expect(isUpsellDescription('Switchboard health check')).toBe(true)
    expect(isUpsellDescription('Add RCBO safety switch')).toBe(true)
    expect(isUpsellDescription('Per-property compliance certificate')).toBe(true)
  })

  it('does NOT match the job’s own work', () => {
    expect(isUpsellDescription('Install EV charger')).toBe(false)
    expect(isUpsellDescription('Electrician labour')).toBe(false)
    expect(isUpsellDescription('Tesla Wall Connector')).toBe(false)
    expect(isUpsellDescription('')).toBe(false)
  })

  // These are REAL jobs and a REAL stocked product ('HPM 2-pole RCBO 32A' is
  // active for three live tenants at $45). Matching any of them would delete
  // the work the customer asked for and send a quietly cheaper quote — worse
  // than the $99 inspection this guard exists to avoid.
  it('does NOT match a job that IS an RCBO or safety-switch replacement', () => {
    expect(isUpsellDescription('Replace faulty RCBO safety switch in switchboard')).toBe(false)
    expect(isUpsellDescription('Supply and install RCBO 32A on existing circuit')).toBe(false)
    expect(isUpsellDescription('HPM 2-pole RCBO 32A')).toBe(false)
    expect(isUpsellDescription('Install safety switch on hot water circuit')).toBe(false)
  })

  it('does NOT match an unrelated health check or certificate', () => {
    expect(isUpsellDescription('Annual smoke alarm health check')).toBe(false)
    expect(isUpsellDescription('Heat pump health check')).toBe(false)
  })
})

describe('stripUngroundedUpsellLines (R2)', () => {
  it('moves the ungrounded upsell out of the tier and recomputes the subtotal', () => {
    const input = draft()
    const res = stripUngroundedUpsellLines(input, [failure()])

    expect(res.changed).toBe(true)
    expect(res.draft.best!.line_items).toHaveLength(2)
    expect(res.draft.best!.line_items!.map((l) => l.description)).toEqual([
      'Electrician labour',
      'Install EV charger',
    ])
    // 360 + 120 — the $150 that could not ground is gone from the money.
    expect(res.draft.best!.subtotal_ex_gst).toBe(480)
    expect(res.removed).toEqual([
      expect.objectContaining({ tier: 'best', lineIndex: 2, description: 'Switchboard health check' }),
    ])
  })

  it('offers the upsell WITHOUT a price rather than dropping it silently', () => {
    const res = stripUngroundedUpsellLines(draft(), [failure()])
    expect(res.draft.optional_upsells).toEqual([
      { name: 'Switchboard health check', price_ex_gst: null, note: 'quoted on site' },
    ])
  })

  it('never mutates the input draft', () => {
    const input = draft()
    const before = JSON.stringify(input)
    const res = stripUngroundedUpsellLines(input, [failure()])
    expect(JSON.stringify(input)).toBe(before)
    expect(res.draft).not.toBe(input)
  })

  it('leaves a GROUNDED upsell line alone — a stocked RCBO stays priced', () => {
    // A grounded line never appears in `failures`, so the guard never sees it.
    const withRcbo = {
      ...draft(),
      best: {
        line_items: [
          labour,
          install,
          {
            description: 'Add RCBO safety switch',
            quantity: 1,
            unit: 'each',
            unit_price_ex_gst: 85,
            total_ex_gst: 85,
            source: 'material:real-rcbo',
          },
        ],
        subtotal_ex_gst: 565,
      },
    }
    const res = stripUngroundedUpsellLines(withRcbo, [])
    expect(res.changed).toBe(false)
    expect(res.draft).toBe(withRcbo)
  })

  it('leaves a NON-upsell ungrounded line alone — that is a real failure', () => {
    const res = stripUngroundedUpsellLines(draft(), [
      failure({ tier: 'best', lineIndex: 1, description: 'Install EV charger', unit_price_ex_gst: 120 }),
    ])
    expect(res.changed).toBe(false)
    expect(res.remainingFailures).toHaveLength(1)
  })

  it('reports the remaining failures so the caller still sees a broken quote', () => {
    const baseFailure = failure({ tier: 'best', lineIndex: 1, description: 'Install EV charger' })
    const res = stripUngroundedUpsellLines(draft(), [failure(), baseFailure])
    expect(res.changed).toBe(true)
    expect(res.remainingFailures).toEqual([baseFailure])
  })

  it('ignores a failure whose index no longer matches the line (stale index)', () => {
    const res = stripUngroundedUpsellLines(draft(), [failure({ lineIndex: 0 })])
    expect(res.changed).toBe(false)
  })

  it('fails closed when a surviving line has no usable arithmetic', () => {
    const broken = {
      ...draft(),
      best: {
        line_items: [{ ...labour, unit_price_ex_gst: 'n/a' }, healthCheck],
        subtotal_ex_gst: 150,
      },
    }
    const res = stripUngroundedUpsellLines(broken, [failure({ lineIndex: 1 })])
    // Tier untouched, failure preserved — never a subtotal that lies.
    expect(res.changed).toBe(false)
    expect(res.draft).toBe(broken)
    expect(res.remainingFailures).toHaveLength(1)
  })

  it('strips the same upsell from every tier that carries it', () => {
    const both: DraftWithTiers = {
      needs_inspection: false,
      good: { line_items: [labour, install], subtotal_ex_gst: 480 },
      better: { line_items: [labour, install, healthCheck], subtotal_ex_gst: 630 },
      best: { line_items: [labour, install, healthCheck], subtotal_ex_gst: 630 },
    }
    const res = stripUngroundedUpsellLines(both, [
      failure({ tier: 'better', lineIndex: 2 }),
      failure({ tier: 'best', lineIndex: 2 }),
    ])
    expect(res.draft.better!.subtotal_ex_gst).toBe(480)
    expect(res.draft.best!.subtotal_ex_gst).toBe(480)
    // Offered once, not once per tier.
    expect(res.draft.optional_upsells).toHaveLength(1)
  })
})


describe('never empties a tier (R2 fail-closed)', () => {
  it('leaves the tier untouched when stripping would remove every line', () => {
    const onlyUpsell: DraftWithTiers = {
      needs_inspection: false,
      good: { line_items: [healthCheck], subtotal_ex_gst: 150 },
      better: null,
      best: null,
    }
    const res = stripUngroundedUpsellLines(onlyUpsell, [
      failure({ tier: 'good', lineIndex: 0 }),
    ])
    // A $0 tier would PASS validation (the labour floor skips empty tiers)
    // and quote the customer nothing for real work. Hold instead.
    expect(res.changed).toBe(false)
    expect(res.draft).toBe(onlyUpsell)
    expect(res.remainingFailures).toHaveLength(1)
  })
})