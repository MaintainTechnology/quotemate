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

  it('gates out roofing with every missing piece named', async () => {
    const sb = mockSupabase({ assemblyCounts: {}, promptTrades: [] })
    const r = await checkTradeReadiness(sb, 'roofing')
    expect(r.ready).toBe(false)
    expect(r.checks.pricingDefaults).toBe(false)
    expect(r.checks.sharedAssemblies).toBe(false)
    expect(r.checks.estimatorPrompt).toBe(false)
    expect(r.checks.licenceSchema).toBe(false)
    expect(r.missing.length).toBeGreaterThanOrEqual(4)
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

  it('gates painting out when it has no catalogue rows (exemptions still hold)', async () => {
    const sb = mockSupabase({ assemblyCounts: {}, promptTrades: [] })
    const r = await checkTradeReadiness(sb, 'painting')
    expect(r.ready).toBe(false)
    expect(r.checks.sharedAssemblies).toBe(false)
    // The deterministic + licence-optional exemptions are independent of the
    // catalogue check, so they remain satisfied even when painting is gated.
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
    expect(onboardable).not.toContain('roofing')
    expect(onboardable).not.toContain('solar')
    expect(onboardable).not.toContain('commercial_painting')
    // painting has no catalogue in this mock → not yet onboardable
    expect(onboardable).not.toContain('painting')
  })

  it('includes painting once it has a catalogue (deterministic trade)', async () => {
    const sb = mockSupabase({
      assemblyCounts: { electrical: 20, plumbing: 23, painting: 11 },
    })
    const onboardable = await getOnboardableTrades(sb)
    expect(onboardable).toContain('painting')
    expect(onboardable).toContain('electrical')
    expect(onboardable).toContain('plumbing')
  })
})
