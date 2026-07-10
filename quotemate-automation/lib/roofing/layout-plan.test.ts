// Spec specs/quote-visual-parity.md R6 — the AI roof layout plan.
// The LLM proposes work-strategy ZONES as structured JSON (labels only —
// never prices or quantities); geometry drawing and material quantities are
// deterministic in code. House DI pattern for the orchestrator (fake client,
// fake generate) — no Supabase, no Gemini.

import { describe, it, expect } from 'vitest'
import {
  layoutModeForJob,
  MODE_PALETTES,
  ZONE_COLOR_HEX,
  buildLayoutPlanPrompt,
  layoutPlanSchema,
  parseLayoutPlan,
  layoutMaterials,
  combinedLayoutMetrics,
  layoutClaimFilter,
  STALE_CLAIM_MS,
  generateRoofLayoutPlan,
  type LayoutPlan,
} from './layout-plan'

// ── Mode mapping ──────────────────────────────────────────────────────
describe('layoutModeForJob', () => {
  it('maps repair-type intents to patch_repair', () => {
    for (const intent of ['patch_repair', 'flashing_repair', 'leak_trace', 'ridge_cap', 'gutter_replace']) {
      expect(layoutModeForJob(intent)).toBe('patch_repair')
    }
  })

  it('maps full_reroof (and unknown) to reroof', () => {
    expect(layoutModeForJob('full_reroof')).toBe('reroof')
    expect(layoutModeForJob('unknown')).toBe('reroof')
    expect(layoutModeForJob(null)).toBe('reroof')
  })

  it('upgrades to upgrade mode when the Best tier is the selected one', () => {
    expect(layoutModeForJob('full_reroof', { selectedTier: 'best' })).toBe('upgrade')
    // Repairs stay repairs even on Best.
    expect(layoutModeForJob('patch_repair', { selectedTier: 'best' })).toBe('patch_repair')
  })
})

// ── Palettes ──────────────────────────────────────────────────────────
describe('MODE_PALETTES', () => {
  it('every palette colour has a hex mapping', () => {
    for (const palette of Object.values(MODE_PALETTES)) {
      for (const c of palette) expect(ZONE_COLOR_HEX[c]).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('the three mode palettes are pairwise distinct sets', () => {
    const keys = Object.keys(MODE_PALETTES) as Array<keyof typeof MODE_PALETTES>
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = [...MODE_PALETTES[keys[i]]].sort().join(',')
        const b = [...MODE_PALETTES[keys[j]]].sort().join(',')
        expect(a).not.toBe(b)
      }
    }
  })
})

// ── Prompt + schema ───────────────────────────────────────────────────
describe('buildLayoutPlanPrompt / layoutPlanSchema', () => {
  const structures = [
    { index: 1, label: 'Main dwelling', sloped_area_m2: 194, form: 'hip', ridge_lm: 21, hips: 4, valleys: 2, storeys: 2 },
    { index: 2, label: 'Detached garage', sloped_area_m2: 40, form: 'gable', ridge_lm: 8, hips: 0, valleys: 0, storeys: 1 },
  ]

  it('is pure and carries the tradie persona, the mode, and the structures', () => {
    const a = buildLayoutPlanPrompt({ address: '1 Test St', mode: 'reroof', structures, scopeSummary: 'Full re-roof.' })
    const b = buildLayoutPlanPrompt({ address: '1 Test St', mode: 'reroof', structures, scopeSummary: 'Full re-roof.' })
    expect(a).toEqual(b)
    expect(a.prompt).toMatch(/roofing tradie/i)
    expect(a.prompt).toContain('Main dwelling')
    expect(a.prompt).toContain('Detached garage')
    expect(a.prompt).toMatch(/re-?roof/i)
  })

  it('forbids prices and quantities in zone labels', () => {
    const p = buildLayoutPlanPrompt({ address: '1 Test St', mode: 'reroof', structures, scopeSummary: null })
    expect(p.prompt).toMatch(/no prices|never.*price|do not.*price/i)
  })

  it('schema constrains colours to the mode palette', () => {
    const schema = layoutPlanSchema('patch_repair') as {
      properties: { zones: { items: { properties: { color: { enum: string[] } } } } }
    }
    expect(schema.properties.zones.items.properties.color.enum).toEqual([...MODE_PALETTES.patch_repair])
  })

  it("schema and prompt support 'point' zones localised on the aerial (x_pct/y_pct)", () => {
    const schema = layoutPlanSchema('reroof') as {
      properties: {
        zones: {
          items: { properties: { placement: { enum: string[] }; x_pct?: unknown; y_pct?: unknown } }
        }
      }
    }
    expect(schema.properties.zones.items.properties.placement.enum).toContain('point')
    expect(schema.properties.zones.items.properties.x_pct).toBeTruthy()
    expect(schema.properties.zones.items.properties.y_pct).toBeTruthy()
    const p = buildLayoutPlanPrompt({
      address: '1 Test St',
      mode: 'reroof',
      structures: [{ index: 1, label: 'Main', sloped_area_m2: 100, form: 'hip', ridge_lm: 10, hips: 2, valleys: 0, storeys: 1 }],
      scopeSummary: null,
    })
    expect(p.prompt).toMatch(/point/i)
    expect(p.prompt).toMatch(/x_pct/i)
  })
})

// ── Parser (money-path guard) ─────────────────────────────────────────
describe('parseLayoutPlan', () => {
  const opts = { mode: 'reroof' as const, structureCount: 2 }
  const zone = (over: Record<string, unknown> = {}) => ({
    color: 'teal',
    label: 'Install NEW Colorbond roof sheeting to replace existing.',
    placement: 'structure',
    structureIndex: 1,
    ...over,
  })

  it('parses a clean payload and tolerates code fences', () => {
    const raw = '```json\n' + JSON.stringify({ header: 'See below!', zones: [zone()] }) + '\n```'
    const plan = parseLayoutPlan(raw, opts)
    expect(plan).not.toBeNull()
    expect(plan!.mode).toBe('reroof')
    expect(plan!.header).toBe('See below!')
    expect(plan!.zones).toHaveLength(1)
  })

  it('drops zones whose label carries a $ amount (hard money guard)', () => {
    const raw = JSON.stringify({
      header: 'h',
      zones: [zone(), zone({ label: 'Re-sheet for $4,500' })],
    })
    const plan = parseLayoutPlan(raw, opts)
    expect(plan!.zones).toHaveLength(1)
    expect(plan!.zones[0].label).not.toContain('$')
  })

  it('drops zones with an out-of-range structureIndex or off-palette colour', () => {
    const raw = JSON.stringify({
      header: 'h',
      zones: [
        zone({ structureIndex: 3 }),
        zone({ structureIndex: 0 }),
        zone({ color: 'purple' }), // purple is not in the reroof palette
        zone(),
      ],
    })
    const plan = parseLayoutPlan(raw, opts)
    expect(plan!.zones).toHaveLength(1)
  })

  it('returns null on unparseable JSON or when no zone survives', () => {
    expect(parseLayoutPlan('not json', opts)).toBeNull()
    expect(parseLayoutPlan(JSON.stringify({ header: 'h', zones: [] }), opts)).toBeNull()
  })

  it("keeps 'point' zones with valid 0–100 coords and drops invalid ones", () => {
    const raw = JSON.stringify({
      header: 'h',
      zones: [
        zone({ placement: 'point', x_pct: 55.2, y_pct: 40 }),
        zone({ placement: 'point' }), // no coords → dropped
        zone({ placement: 'point', x_pct: 140, y_pct: 40 }), // out of range → dropped
        zone({ placement: 'point', x_pct: 'left', y_pct: 40 }), // wrong type → dropped
      ],
    })
    const plan = parseLayoutPlan(raw, opts)
    expect(plan!.zones).toHaveLength(1)
    expect(plan!.zones[0].x_pct).toBe(55.2)
    expect(plan!.zones[0].y_pct).toBe(40)
  })

  it("strips stray coords from non-point zones", () => {
    const raw = JSON.stringify({
      header: 'h',
      zones: [zone({ placement: 'structure', x_pct: 10, y_pct: 10 })],
    })
    const plan = parseLayoutPlan(raw, opts)
    expect(plan!.zones[0].x_pct).toBeUndefined()
    expect(plan!.zones[0].y_pct).toBeUndefined()
  })
})

// ── Deterministic material quantities ────────────────────────────────
describe('layoutMaterials', () => {
  const metrics = {
    sloped_area_m2: 200,
    ridge_lm: 20,
    footprint_m2: 169,
    polygon_geojson: null,
  }

  it('derives exact quantities from the stored geometry (reroof)', () => {
    const { items, note } = layoutMaterials(metrics, 'reroof')
    const byItem = Object.fromEntries(items.map((i) => [i.item, i]))
    // sheets = ceil(200 / (0.762 × 5.5) × 1.1) = ceil(52.49…) = 53
    expect(byItem['Colorbond sheets'].qty).toBe(53)
    expect(byItem['Colorbond sheets'].unit).toBe('sheets')
    // screws = ceil(200 × 9)
    expect(byItem['Roofing screws'].qty).toBe(1800)
    // battens = ceil(200 × 1.1)
    expect(byItem['Battens'].qty).toBe(220)
    expect(byItem['Battens'].unit).toBe('lm')
    // ridge capping = ceil(ridge_lm)
    expect(byItem['Ridge capping'].qty).toBe(20)
    // edge protection: no polygon → 4 × √footprint = 4 × 13 = 52
    expect(byItem['Edge protection'].qty).toBe(52)
    expect(note).toBeNull()
  })

  it('every item explains its basis (the arithmetic) and where it is used', () => {
    const { items } = layoutMaterials(metrics, 'reroof')
    for (const item of items) {
      expect(item.basis).toBeTruthy()
      expect(item.use).toBeTruthy()
    }
    const byItem = Object.fromEntries(items.map((i) => [i.item, i]))
    // Sheets: the measured area, the per-sheet cover, and the waste factor.
    expect(byItem['Colorbond sheets'].basis).toContain('200 m²')
    expect(byItem['Colorbond sheets'].basis).toMatch(/4\.19 m² .*sheet/)
    expect(byItem['Colorbond sheets'].basis).toContain('10% cutting waste')
    expect(byItem['Colorbond sheets'].use).toMatch(/sheeting/i)
    // Screws: the fixing density.
    expect(byItem['Roofing screws'].basis).toContain('9 screws/m²')
    // Ridge capping: from the measured ridge/hip lines.
    expect(byItem['Ridge capping'].basis).toContain('20 lm')
    expect(byItem['Ridge capping'].basis).toMatch(/ridge/i)
    // Edge protection (no polygon): names the footprint approximation.
    expect(byItem['Edge protection'].basis).toMatch(/√|square root/i)
    expect(byItem['Edge protection'].use).toMatch(/WHS|safety|perimeter/i)
  })

  it('edge protection cites the measured outline when a polygon exists', () => {
    const square = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [153.02, -27.47],
          [153.0201, -27.47],
          [153.0201, -27.4701],
          [153.02, -27.4701],
          [153.02, -27.47],
        ],
      ],
    }
    const { items } = layoutMaterials({ ...metrics, polygon_geojson: square }, 'reroof')
    const edge = items.find((i) => i.item === 'Edge protection')!
    expect(edge.basis).toMatch(/measured footprint outline/i)
  })

  it('patch_repair annotates instead of committing full-roof quantities', () => {
    const { note } = layoutMaterials(metrics, 'patch_repair')
    expect(note).toMatch(/on-site measure/i)
  })

  it('degrades gracefully when metrics are missing', () => {
    const { items } = layoutMaterials({ sloped_area_m2: null, ridge_lm: null, footprint_m2: 0, polygon_geojson: null }, 'reroof')
    expect(items).toEqual([])
  })
})

// Shared metrics derivation for /m, /q/roof and the PDF — sums the job,
// uses the exact ring perimeter only when it covers the WHOLE job.
describe('combinedLayoutMetrics', () => {
  const poly = { type: 'Polygon' as const, coordinates: [[[153.02, -27.47], [153.0201, -27.47], [153.0201, -27.4701], [153.02, -27.4701], [153.02, -27.47]]] }
  const structure = (sloped: number, ridge: number, footprint: number) => ({
    metrics: { sloped_area_m2: sloped, ridge_lm: ridge, footprint_m2: footprint, polygon_geojson: poly },
  })

  it('sums sloped area, ridge and footprint across all structures', () => {
    const m = combinedLayoutMetrics([structure(100, 10, 80), structure(50, 5, 40)])
    expect(m.sloped_area_m2).toBe(150)
    expect(m.ridge_lm).toBe(15)
    expect(m.footprint_m2).toBe(120)
    // Two structures → one ring does not cover the job → no polygon.
    expect(m.polygon_geojson).toBeNull()
  })

  it('keeps the exact ring only for a single-structure job', () => {
    const m = combinedLayoutMetrics([structure(100, 10, 80)])
    expect(m.polygon_geojson).toBe(poly)
  })

  it('nulls zero sums so layoutMaterials skips those items', () => {
    const m = combinedLayoutMetrics([{ metrics: { sloped_area_m2: null, ridge_lm: null, footprint_m2: 0, polygon_geojson: null } }])
    expect(m.sloped_area_m2).toBeNull()
    expect(m.ridge_lm).toBeNull()
  })
})

// ── Orchestrator (DI) ────────────────────────────────────────────────
type Row = Record<string, unknown>

/** Minimal fake of the supabase chain generateRoofLayoutPlan uses. */
function fakeClient(row: Row | null, opts: { claimSucceeds?: boolean } = {}) {
  const updates: Row[] = []
  const client = {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_c: string, _v: string) => ({
          maybeSingle: async () => ({ data: row }),
        }),
      }),
      update: (patch: Row) => {
        updates.push(patch)
        const chain = {
          eq: (_c: string, _v: string) => ({
            ...chain,
            or: (_f: string) => ({
              select: (_s: string) => ({
                maybeSingle: async () => ({
                  data: (opts.claimSucceeds ?? true) ? { id: 'x' } : null,
                }),
              }),
            }),
            // plain update path (persist / failed) resolves as a thenable
            then: (res: (v: { error: null }) => void) => res({ error: null }),
          }),
        }
        return chain
      },
    }),
  }
  return { client: client as never, updates }
}

const quoteFixture = {
  structures: [
    {
      label: 'Main dwelling',
      inputs: { intent: 'full_reroof' },
      metrics: {
        sloped_area_m2: 194,
        footprint_m2: 168,
        form: 'hip',
        ridge_lm: 21,
        hips: 4,
        valleys: 2,
        storeys: 2,
        polygon_geojson: { type: 'Polygon', coordinates: [[[153.02, -27.47], [153.0201, -27.47], [153.0201, -27.4701], [153.02, -27.4701], [153.02, -27.47]]] },
      },
    },
  ],
}

const goodPlanJson = JSON.stringify({
  header: 'Please see the roof layout map below!',
  zones: [{ color: 'teal', label: 'Install NEW Colorbond sheeting.', placement: 'structure', structureIndex: 1 }],
})

describe('generateRoofLayoutPlan (DI)', () => {
  it('short-circuits when a plan is already ready', async () => {
    const stored: LayoutPlan = { header: 'h', mode: 'reroof', zones: [] }
    const { client } = fakeClient({ id: 'r1', address: '1 Test St', quote: quoteFixture, layout_status: 'ready', layout_plan: stored })
    let generated = 0
    const res = await generateRoofLayoutPlan('tok12345', {
      client,
      fetchAerial: async () => ({ base64: 'x', mime: 'image/png' }),
      generate: async () => {
        generated++
        return goodPlanJson
      },
    })
    expect(res).toEqual({ ok: true, plan: stored })
    expect(generated).toBe(0)
  })

  it('returns busy when the CAS claim loses', async () => {
    const { client } = fakeClient(
      { id: 'r1', address: '1 Test St', quote: quoteFixture, layout_status: 'generating', layout_plan: null },
      { claimSucceeds: false },
    )
    const res = await generateRoofLayoutPlan('tok12345', {
      client,
      fetchAerial: async () => ({ base64: 'x', mime: 'image/png' }),
      generate: async () => goodPlanJson,
    })
    expect(res).toEqual({ ok: false, status: 'busy' })
  })

  it('generates, parses and persists a plan', async () => {
    const { client, updates } = fakeClient({ id: 'r1', address: '1 Test St', quote: quoteFixture, layout_status: null, layout_plan: null })
    const res = await generateRoofLayoutPlan('tok12345', {
      client,
      fetchAerial: async () => ({ base64: 'x', mime: 'image/png' }),
      generate: async () => goodPlanJson,
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.plan.zones).toHaveLength(1)
      expect(res.plan.mode).toBe('reroof')
    }
    // claim + persist
    expect(updates.some((u) => u.layout_status === 'generating')).toBe(true)
    expect(updates.some((u) => u.layout_status === 'ready' && u.layout_plan != null)).toBe(true)
  })

  it("uses the customer's paid/accepted tier — Best ⇒ upgrade mode", async () => {
    const { client } = fakeClient({
      id: 'r1',
      address: '1 Test St',
      quote: quoteFixture,
      layout_status: null,
      layout_plan: null,
      paid_tier: 'best',
      customer_accepted_tier: null,
    })
    const res = await generateRoofLayoutPlan('tok12345', {
      client,
      fetchAerial: async () => ({ base64: 'x', mime: 'image/png' }),
      generate: async () => goodPlanJson,
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.plan.mode).toBe('upgrade')
  })

  it('CAS claim stamps claimed_at and the filter reclaims STALE generating rows', async () => {
    // A crash/timeout after claiming 'generating' must not strand the row
    // forever: the claim filter reclaims 'generating' rows whose claimed_at
    // marker is older than STALE_CLAIM_MS.
    const now = new Date('2026-07-10T00:20:00.000Z')
    const filter = layoutClaimFilter(now)
    expect(filter).toContain('layout_status.is.null')
    expect(filter).toContain('layout_status.eq.failed')
    const cutoff = new Date(now.getTime() - STALE_CLAIM_MS).toISOString()
    expect(filter).toContain(`and(layout_status.eq.generating,layout_plan->>claimed_at.lt.${cutoff})`)

    const { client, updates } = fakeClient({ id: 'r1', address: '1 Test St', quote: quoteFixture, layout_status: null, layout_plan: null })
    await generateRoofLayoutPlan('tok12345', {
      client,
      fetchAerial: async () => ({ base64: 'x', mime: 'image/png' }),
      generate: async () => goodPlanJson,
    })
    const claim = updates.find((u) => u.layout_status === 'generating')
    expect(claim).toBeTruthy()
    expect((claim!.layout_plan as { claimed_at?: string } | null)?.claimed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('marks failed when the model output cannot be parsed', async () => {
    const { client, updates } = fakeClient({ id: 'r1', address: '1 Test St', quote: quoteFixture, layout_status: null, layout_plan: null })
    const res = await generateRoofLayoutPlan('tok12345', {
      client,
      fetchAerial: async () => ({ base64: 'x', mime: 'image/png' }),
      generate: async () => 'not json at all',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe('failed')
    expect(updates.some((u) => u.layout_status === 'failed')).toBe(true)
  })
})
