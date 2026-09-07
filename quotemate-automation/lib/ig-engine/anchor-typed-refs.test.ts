// ═══════════════════════════════════════════════════════════════════
// Regression: pickAnchorLine must understand TYPED refs.
//
// A line item's `source` is "material:<uuid>", not the bare "material".
// The original filter compared with ===, so once typed refs landed it
// matched only legacy untyped lines. pickAnchorLine returned null,
// validate-inputs raised [no_anchor_product], and the AI preview was
// refused before any model call. In the data: 45 quotes reached
// preview_status='ready', the last on 2026-06-24, none afterwards.
//
// Second case: EV charger. The customer supplies the unit, so no material
// row names it — only the install assembly does. Anchoring on the tier's
// incidental RCBO told Gemini the headline product was a safety switch.
// Verbatim line items below are from live quote 7b1b942d.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest'
import { pickAnchorLine, pickAnchorProduct } from './prompts'

const ctx = (jobType: string, lineItems: any[]): any => ({
  intake: { job_type: jobType, scope: {} },
  quote: { selected_tier: 'better' },
  lineItems,
})

const EV_LINES = [
  {
    tier: 'better',
    source: 'assembly:52f354d2-a5e3-4d9f-a7c9-aa13cbe020c7',
    description: 'Customer to supply — Tesla Wall Connector; install on a new dedicated single-phase circuit',
    quantity: 1,
  },
  {
    tier: 'better',
    source: 'material:cb4e4c3e-e6cc-42c6-8fee-d008b1b4e5c3',
    description: 'HPM 2-pole RCBO 32A — dedicated safety switch for the EV charger',
    quantity: 1,
  },
  { tier: 'better', source: 'labour', description: 'Installation labour — run dedicated circuit', quantity: 3 },
]

describe('pickAnchorLine — typed refs', () => {
  it('accepts a typed material: ref (the regression)', () => {
    const a = pickAnchorLine(ctx('downlights', [
      { tier: 'better', source: 'material:aaaaaaaa-1111-2222-3333-444444444444', description: 'Brilliant 9W LED downlight', quantity: 6 },
      { tier: 'better', source: 'labour', description: 'Installation labour', quantity: 6 },
    ]))
    expect(a).not.toBeNull()
    expect(a!.description).toContain('LED downlight')
  })

  it('still accepts an untyped legacy line', () => {
    const a = pickAnchorLine(ctx('downlights', [
      { tier: 'better', description: 'Legacy downlight line with no source', quantity: 4 },
    ]))
    expect(a?.description).toContain('Legacy downlight')
  })

  it('still ignores sundries', () => {
    const a = pickAnchorLine(ctx('downlights', [
      { tier: 'better', source: 'material:bbbbbbbb-1111-2222-3333-444444444444', description: 'Electrical sundries', quantity: 1 },
      { tier: 'better', source: 'material:cccccccc-1111-2222-3333-444444444444', description: 'Brilliant 9W LED downlight', quantity: 6 },
    ]))
    expect(a!.description).toContain('LED downlight')
  })

  it('anchors an EV charger on the ASSEMBLY, not the incidental RCBO', () => {
    const a = pickAnchorLine(ctx('ev_charger', EV_LINES))
    expect(a).not.toBeNull()
    expect(a!.description).toContain('Tesla Wall Connector')
    expect(a!.description).not.toContain('RCBO')
    expect(pickAnchorProduct(ctx('ev_charger', EV_LINES))).toContain('Tesla Wall Connector')
  })

  it('does NOT prefer assemblies for other job types', () => {
    const a = pickAnchorLine(ctx('downlights', [
      { tier: 'better', source: 'assembly:dddddddd-1111-2222-3333-444444444444', description: 'Install LED downlight assembly', quantity: 6 },
      { tier: 'better', source: 'material:eeeeeeee-1111-2222-3333-444444444444', description: 'Brilliant 9W LED downlight', quantity: 6 },
    ]))
    expect(a!.description).toBe('Brilliant 9W LED downlight')
  })

  it('returns null when a tier genuinely has nothing to anchor on', () => {
    expect(pickAnchorLine(ctx('downlights', [
      { tier: 'better', source: 'labour', description: 'Installation labour', quantity: 3 },
    ]))).toBeNull()
  })
})
