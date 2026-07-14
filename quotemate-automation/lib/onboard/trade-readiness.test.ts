// Unit tests for the trade-readiness gate (spec A4/A5).
//
// electrical/plumbing must always be onboardable (bundled estimator + the
// pilot pricing/licence config); a trade with no catalogue, no prompt, and
// no pricing/licence config must be gated out with the missing items named.

import { describe, expect, it } from 'vitest'
import {
  checkTradeReadiness,
  getOnboardableTrades,
} from './trade-readiness'

// Mock supabase covering the two reads the gate makes:
//   • shared_assemblies: select('id',{count,head}).eq('trade', t) → {count}
//   • trade_prompts:     select(...).eq('trades.name', t).maybeSingle() → {data}
function mockSupabase(opts: {
  assemblyCounts?: Record<string, number>
  promptTrades?: string[]
}) {
  const assemblyCounts = opts.assemblyCounts ?? {}
  const promptTrades = opts.promptTrades ?? []
  return {
    from(table: string) {
      return {
        select(_cols: string, _opts?: unknown) {
          return {
            eq(_col: string, val: string) {
              if (table === 'shared_assemblies') {
                return Promise.resolve({ count: assemblyCounts[val] ?? 0, error: null })
              }
              // trade_prompts path
              return {
                maybeSingle() {
                  return Promise.resolve({
                    data: promptTrades.includes(val)
                      ? { estimator_system_prompt: 'template' }
                      : null,
                    error: null,
                  })
                },
              }
            },
          }
        },
      }
    },
  } as any
}

describe('checkTradeReadiness', () => {
  it('marks electrical ready when it has catalogue rows (bundled estimator)', async () => {
    const sb = mockSupabase({ assemblyCounts: { electrical: 20 } })
    const r = await checkTradeReadiness(sb, 'electrical')
    expect(r.ready).toBe(true)
    expect(r.missing).toEqual([])
    expect(r.checks).toMatchObject({
      pricingDefaults: true,
      sharedAssemblies: true,
      estimatorPrompt: true,
      intakeRules: true,
      licenceSchema: true,
    })
  })

  it('marks plumbing ready with catalogue rows', async () => {
    const sb = mockSupabase({ assemblyCounts: { plumbing: 23 } })
    const r = await checkTradeReadiness(sb, 'plumbing')
    expect(r.ready).toBe(true)
  })

  it('marks roofing ready with NO catalogue and NO prompt (deterministic — prices from the measured roof)', async () => {
    // Roofing quotes come from lib/roofing/pricing.ts: sloped area off the
    // measured footprint × pricing_book.overlays.roofing_rate_card. No Opus on
    // the money path, so there is no estimator prompt to find and no assembly
    // catalogue to quote from — the deterministic exemption satisfies both,
    // exactly as it does for painting. Onboardable on a fresh DB.
    const sb = mockSupabase({ assemblyCounts: {}, promptTrades: [] })
    const r = await checkTradeReadiness(sb, 'roofing')
    expect(r.ready).toBe(true)
    expect(r.missing).toEqual([])
    expect(r.checks).toMatchObject({
      pricingDefaults: true,
      sharedAssemblies: true,
      estimatorPrompt: true,
      intakeRules: true,
      licenceSchema: true,
    })
  })

  it('still gates out solar and commercial painting', async () => {
    // The remaining bespoke surfaces have no onboarding pricing defaults,
    // no licence schema, and are not deterministic-exempt — they must stay
    // out of the self-serve wizard until they're wired.
    const sb = mockSupabase({ assemblyCounts: {}, promptTrades: [] })
    for (const trade of ['solar', 'commercial_painting']) {
      const r = await checkTradeReadiness(sb, trade)
      expect(r.ready).toBe(false)
      expect(r.checks.pricingDefaults).toBe(false)
      expect(r.checks.licenceSchema).toBe(false)
    }
  })

  it('marks painting ready with catalogue rows — no estimator prompt needed (deterministic)', async () => {
    // Painting prices from a deterministic per-m² rate card, so it has no
    // bundled estimator template and no trade_prompts row, yet must still be
    // onboardable. The deterministic-trade exemption satisfies estimatorPrompt,
    // and the LICENCE_BODIES painting key satisfies the licence-optional check.
    const sb = mockSupabase({ assemblyCounts: { painting: 11 }, promptTrades: [] })
    const r = await checkTradeReadiness(sb, 'painting')
    expect(r.ready).toBe(true)
    expect(r.missing).toEqual([])
    expect(r.checks).toMatchObject({
      pricingDefaults: true,
      sharedAssemblies: true,
      estimatorPrompt: true,
      intakeRules: true,
      licenceSchema: true,
    })
  })

  it('marks painting ready even with NO catalogue rows (deterministic — prices from a rate card)', async () => {
    // Painting quotes from pricing_book.overlays.painting_rate_card, not a
    // shared_assemblies catalogue, so an empty catalogue must NOT gate it out.
    // The deterministic exemption satisfies BOTH sharedAssemblies and
    // estimatorPrompt; pricing defaults + intake + licence-optional come from
    // the onboarding schema. Net: painting is onboardable on a fresh DB.
    const sb = mockSupabase({ assemblyCounts: {}, promptTrades: [] })
    const r = await checkTradeReadiness(sb, 'painting')
    expect(r.ready).toBe(true)
    expect(r.missing).toEqual([])
    expect(r.checks.sharedAssemblies).toBe(true)
    expect(r.checks.estimatorPrompt).toBe(true)
    expect(r.checks.licenceSchema).toBe(true)
  })

  it('still gates out a trade that has a catalogue + prompt but no pricing/licence config', async () => {
    // e.g. a hypothetical 'carpentry' with DB catalogue + a trade_prompts row
    // but no onboarding pricing defaults / licence schema → not onboardable.
    const sb = mockSupabase({ assemblyCounts: { carpentry: 5 }, promptTrades: ['carpentry'] })
    const r = await checkTradeReadiness(sb, 'carpentry')
    expect(r.checks.sharedAssemblies).toBe(true)
    expect(r.checks.estimatorPrompt).toBe(true)
    expect(r.checks.pricingDefaults).toBe(false)
    expect(r.checks.intakeRules).toBe(false)
    expect(r.checks.licenceSchema).toBe(false)
    expect(r.ready).toBe(false)
  })
})

describe('getOnboardableTrades', () => {
  it('returns only the trades that pass every check', async () => {
    const sb = mockSupabase({ assemblyCounts: { electrical: 20, plumbing: 23 } })
    const onboardable = await getOnboardableTrades(sb)
    expect(onboardable).toContain('electrical')
    expect(onboardable).toContain('plumbing')
    expect(onboardable).not.toContain('solar')
    expect(onboardable).not.toContain('commercial_painting')
    // painting + roofing are deterministic — onboardable without a catalogue.
    expect(onboardable).toContain('painting')
    expect(onboardable).toContain('roofing')
  })

  it('includes painting even with no catalogue (deterministic trade)', async () => {
    const sb = mockSupabase({
      assemblyCounts: { electrical: 20, plumbing: 23 }, // no painting rows
    })
    const onboardable = await getOnboardableTrades(sb)
    expect(onboardable).toContain('painting')
    expect(onboardable).toContain('electrical')
    expect(onboardable).toContain('plumbing')
  })
})
