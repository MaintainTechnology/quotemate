import { describe, it, expect, vi } from 'vitest'
import {
  buildSolarBriefFacts,
  briefInputHash,
  extractNumericTokens,
  factsNumericSet,
  validateBriefGrounding,
  buildBriefPrompt,
  parseBriefResponse,
  applySolarAiBrief,
  type SolarAiBrief,
  type SolarAiBriefRecord,
} from './ai-brief'
import { makeFixtureEstimate } from './__fixtures__/estimate'
import type { SupabaseClient } from '@supabase/supabase-js'

const FACTS = buildSolarBriefFacts(makeFixtureEstimate())!

function groundedBrief(): SolarAiBrief {
  return {
    headline: 'A strong north-facing roof for solar',
    layout_rationale:
      'The layout places 25 panels on the north face, which is pitched at 22 degrees and offers 120 square metres of usable area.',
    best_plane_note: 'The north face does the heavy lifting — it rates excellent for sun.',
    seasonal_note: 'With 2510 hours of sun a year, output stays solid across the seasons.',
    caveats: ['Based on 2025 satellite imagery.'],
  }
}

describe('buildSolarBriefFacts', () => {
  it('extracts geometry + sun facts, never prices', () => {
    expect(FACTS.panel_count).toBe(25)
    expect(FACTS.system_kw).toBe(10)
    expect(FACTS.max_sunshine_hours_per_year).toBe(2510)
    expect(FACTS.planes).toHaveLength(1)
    expect(FACTS.planes[0].orientation).toBe('north')
    expect(FACTS.shade_free_hours).toBe(9)
    const json = JSON.stringify(FACTS)
    // No dollar figures from the estimate may leak into the prompt facts.
    expect(json).not.toContain('9215')
    expect(json).not.toContain('net_inc_gst')
    expect(json).not.toContain('"stc"')
    expect(json).not.toContain('rebate')
    expect(json).not.toContain('gross')
  })

  it('manual path → null (nothing to ground on)', () => {
    const manual = makeFixtureEstimate({ coverage_source: 'manual' })
    expect(buildSolarBriefFacts(manual)).toBeNull()
    const noPlanes = makeFixtureEstimate()
    noPlanes.roof = { ...noPlanes.roof, planes: [] }
    expect(buildSolarBriefFacts(noPlanes)).toBeNull()
  })

  it('hash is stable for identical facts and changes with them', () => {
    const a = briefInputHash(FACTS)
    expect(briefInputHash(buildSolarBriefFacts(makeFixtureEstimate())!)).toBe(a)
    expect(briefInputHash({ ...FACTS, panel_count: 24 })).not.toBe(a)
  })
})

describe('extractNumericTokens', () => {
  it('parses plain, decimal, and comma-grouped numbers', () => {
    expect(extractNumericTokens('25 panels at 22.5 degrees over 1,200 hours')).toEqual([
      25, 22.5, 1200,
    ])
  })
  it('no numbers → empty', () => {
    expect(extractNumericTokens('a sunny north-facing roof')).toEqual([])
  })
})

describe('validateBriefGrounding', () => {
  it('accepts a fully grounded brief', () => {
    expect(validateBriefGrounding(groundedBrief(), FACTS)).toEqual([])
  })

  it('rejects a fabricated number', () => {
    const brief = groundedBrief()
    brief.seasonal_note = 'Expect roughly 9999 kWh of generation every single year.'
    const violations = validateBriefGrounding(brief, FACTS)
    expect(violations).toContain(9999)
  })

  it('allows rounded forms of real facts', () => {
    const brief = groundedBrief()
    brief.layout_rationale = 'The roof pitch of 22 degrees suits fixed mounting.'
    expect(validateBriefGrounding(brief, FACTS)).toEqual([])
  })

  it('imagery year and postcode are grounded', () => {
    const brief = groundedBrief()
    brief.caveats = ['Imagery captured in 2025 over postcode 2570.']
    expect(validateBriefGrounding(brief, FACTS)).toEqual([])
  })
})

describe('buildBriefPrompt', () => {
  it('embeds the facts and the hard rules', () => {
    const prompt = buildBriefPrompt(FACTS)
    expect(prompt).toContain('Do not invent any number')
    expect(prompt).toContain('Never mention prices')
    expect(prompt).toContain('"panel_count": 25')
    expect(prompt).toContain('southern-hemisphere')
  })
})

describe('parseBriefResponse', () => {
  it('parses bare JSON and fenced JSON', () => {
    const json = JSON.stringify(groundedBrief())
    expect(parseBriefResponse(json)).not.toBeNull()
    expect(parseBriefResponse('```json\n' + json + '\n```')).not.toBeNull()
  })
  it('schema violations → null', () => {
    expect(parseBriefResponse('{"headline": "x"}')).toBeNull()
    expect(parseBriefResponse('not json')).toBeNull()
  })
})

// ── applySolarAiBrief (fake supabase + injected generator) ───────────

function makeFakeSupabase(row: Record<string, unknown> | null) {
  const updates: Array<Record<string, unknown>> = []
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row }) }),
      }),
      update: (payload: Record<string, unknown>) => {
        updates.push(payload)
        return { eq: async () => ({ error: null }) }
      },
    }),
  } as unknown as SupabaseClient
  return { supabase, updates }
}

describe('applySolarAiBrief', () => {
  it('generates, validates, persists a grounded brief', async () => {
    const { supabase, updates } = makeFakeSupabase({
      id: 'r1',
      estimate: makeFixtureEstimate(),
      ai_brief: null,
    })
    const generate = vi.fn(async () => JSON.stringify(groundedBrief()))
    const rec = await applySolarAiBrief(
      supabase,
      { publicToken: 'tok' },
      { generate, forceEnabled: true, modelId: 'test-model' },
    )
    expect(rec).not.toBeNull()
    expect(rec!.model).toBe('test-model')
    expect(rec!.input_hash).toBe(briefInputHash(FACTS))
    expect(updates).toHaveLength(1)
    expect((updates[0].ai_brief as SolarAiBriefRecord).headline).toBe(
      groundedBrief().headline,
    )
  })

  it('discards an ungrounded brief — nothing persisted', async () => {
    const { supabase, updates } = makeFakeSupabase({
      id: 'r1',
      estimate: makeFixtureEstimate(),
      ai_brief: null,
    })
    const bad = groundedBrief()
    bad.headline = 'Save 5000 dollars with 77 panels'
    const generate = vi.fn(async () => JSON.stringify(bad))
    const rec = await applySolarAiBrief(
      supabase,
      { publicToken: 'tok' },
      { generate, forceEnabled: true },
    )
    expect(rec).toBeNull()
    expect(updates).toHaveLength(0)
  })

  it('skips regeneration when the facts hash matches', async () => {
    const existing: SolarAiBriefRecord = {
      ...groundedBrief(),
      model: 'm',
      input_hash: briefInputHash(FACTS),
      generated_at: '2026-06-13T00:00:00.000Z',
    }
    const { supabase, updates } = makeFakeSupabase({
      id: 'r1',
      estimate: makeFixtureEstimate(),
      ai_brief: existing,
    })
    const generate = vi.fn()
    const rec = await applySolarAiBrief(
      supabase,
      { publicToken: 'tok' },
      { generate, forceEnabled: true },
    )
    expect(rec).toEqual(existing)
    expect(generate).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('manual estimate → null without calling the model', async () => {
    const { supabase } = makeFakeSupabase({
      id: 'r1',
      estimate: makeFixtureEstimate({ coverage_source: 'manual' }),
      ai_brief: null,
    })
    const generate = vi.fn()
    const rec = await applySolarAiBrief(
      supabase,
      { publicToken: 'tok' },
      { generate, forceEnabled: true },
    )
    expect(rec).toBeNull()
    expect(generate).not.toHaveBeenCalled()
  })

  it('generator throwing → null, never throws', async () => {
    const { supabase } = makeFakeSupabase({
      id: 'r1',
      estimate: makeFixtureEstimate(),
      ai_brief: null,
    })
    const generate = vi.fn(async () => {
      throw new Error('model down')
    })
    await expect(
      applySolarAiBrief(supabase, { publicToken: 'tok' }, { generate, forceEnabled: true }),
    ).resolves.toBeNull()
  })
})
