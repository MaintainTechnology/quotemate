// Phase 4 R9, the task half — a step can depend on the product.
//
// Migration 184 created the task tables, gave them a CRUD API and a dashboard
// panel, and stopped. Nothing in lib/estimate ever read them, so a checklist a
// tradie curated never reached a quote, and R9's second acceptance scenario —
// "a smart product adds its dimmer part AND its pairing task" — had only the
// part half. Migration 188 added include_when; this is the estimator side.
//
// The evaluator is shouldIncludeLine, REUSED not reimplemented, so the unknown
// rule cannot drift between parts and steps. That asymmetry is the subtle bit:
// a REQUIRED step survives an unevaluable condition, an OPTIONAL one does not.

import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, it, expect } from 'vitest'
import { resolveAssemblyTasks, type AssemblyTask } from './assembly-tasks'
import { buildDeterministicTiers } from './deterministic-bom'
import { buildBomQuoteLines, type TenantMaterial, type BomLine } from './catalogue'

const SHARED: AssemblyTask[] = [
  { title: 'Isolate the circuit and prove dead', required: true, sort: 1 },
  { title: 'Test and tag on completion', required: true, sort: 3 },
  { title: 'Pair the light to the app', required: false, sort: 2, include_when: { smart: true } },
]

const titles = (t: ReturnType<typeof resolveAssemblyTasks>) => t.map((x) => x.title)

describe('R9 — the pairing task appears only for a smart product', () => {
  it('a SMART product gets the pairing step — the acceptance scenario', () => {
    const out = resolveAssemblyTasks({ sharedTasks: SHARED, productProperties: { smart: true } })
    expect(titles(out)).toContain('Pair the light to the app')
  })

  it('a plain product does NOT', () => {
    const out = resolveAssemblyTasks({ sharedTasks: SHARED, productProperties: { smart: false } })
    expect(titles(out)).not.toContain('Pair the light to the app')
  })

  it('an UNTAGGED product does not get it either — optional plus unknown means no', () => {
    // Adding a step nobody established the job needs is as wrong as dropping
    // one it does. Same rule as an optional BOM line.
    const out = resolveAssemblyTasks({ sharedTasks: SHARED, productProperties: null })
    expect(titles(out)).not.toContain('Pair the light to the app')
  })

  it('but the REQUIRED steps always survive an unknown product', () => {
    const out = resolveAssemblyTasks({ sharedTasks: SHARED, productProperties: null })
    expect(titles(out)).toEqual([
      'Isolate the circuit and prove dead',
      'Test and tag on completion',
    ])
  })

  it('a REQUIRED conditional step survives an unknown attribute', () => {
    // Never silently drop a step the job needs because a product was untagged.
    const out = resolveAssemblyTasks({
      sharedTasks: [{ title: 'Fit the driver', required: true, include_when: { integrated_driver: false } }],
      productProperties: {},
    })
    expect(titles(out)).toEqual(['Fit the driver'])
  })

  it('and is dropped on a KNOWN mismatch — that is the condition working', () => {
    const out = resolveAssemblyTasks({
      sharedTasks: [{ title: 'Fit the driver', required: true, include_when: { integrated_driver: false } }],
      productProperties: { integrated_driver: true },
    })
    expect(out).toEqual([])
  })
})

describe('R9 — the tradie’s own checklist wins outright', () => {
  const TENANT: AssemblyTask[] = [{ title: 'My own way of doing it', required: true, sort: 1 }]

  it('tenant steps REPLACE the shared ones, they are not merged', () => {
    // A tradie who wrote their own checklist has said what the job is.
    // Appending shared steps would put words in their mouth.
    const out = resolveAssemblyTasks({ tenantTasks: TENANT, sharedTasks: SHARED })
    expect(titles(out)).toEqual(['My own way of doing it'])
  })

  it('falls back to shared when the tenant has authored none', () => {
    const out = resolveAssemblyTasks({ tenantTasks: [], sharedTasks: SHARED, productProperties: { smart: true } })
    expect(titles(out)).toHaveLength(3)
  })

  it('an all-blank tenant list is treated as none, not as an override', () => {
    // Otherwise one empty row would silently wipe the shared checklist.
    const out = resolveAssemblyTasks({
      tenantTasks: [{ title: '   ', required: true }],
      sharedTasks: SHARED,
    })
    expect(titles(out)).toContain('Isolate the circuit and prove dead')
  })
})

describe('R9 — shape and ordering', () => {
  it('orders by sort, not array order', () => {
    const out = resolveAssemblyTasks({
      sharedTasks: [
        { title: 'second', required: true, sort: 2 },
        { title: 'first', required: true, sort: 1 },
      ],
    })
    expect(titles(out)).toEqual(['first', 'second'])
  })

  it('carries notes when set and omits the key when blank', () => {
    const out = resolveAssemblyTasks({
      sharedTasks: [
        { title: 'A', required: true, notes: 'watch the ceiling cavity' },
        { title: 'B', required: true, notes: '  ' },
      ],
    })
    expect(out[0].notes).toBe('watch the ceiling cavity')
    expect('notes' in out[1]).toBe(false)
  })

  it('defaults required to true, matching the DB default', () => {
    expect(resolveAssemblyTasks({ sharedTasks: [{ title: 'A' }] })[0].required).toBe(true)
  })

  it('drops blank titles rather than shipping an empty step', () => {
    const out = resolveAssemblyTasks({ sharedTasks: [{ title: '', required: true }, { title: 'A', required: true }] })
    expect(titles(out)).toEqual(['A'])
  })

  it('no tasks at all returns an empty list, never null', () => {
    expect(resolveAssemblyTasks({})).toEqual([])
    expect(resolveAssemblyTasks({ tenantTasks: null, sharedTasks: null })).toEqual([])
  })

  it('is pure — same input twice, same steps', () => {
    const i = { sharedTasks: SHARED, productProperties: { smart: true } }
    expect(resolveAssemblyTasks(i)).toEqual(resolveAssemblyTasks(i))
  })
})

// ── the attributes have to actually ARRIVE ──────────────────────────────
//
// This section exists because the first wiring was silently broken. run.ts read
// `line.properties` off the quote line to condition the steps — but QuoteLine
// has no `properties` field, so it was ALWAYS undefined and no conditional step
// could ever appear. A cast hid it from the typechecker and every pure test
// above still passed, because they inject the attributes directly.
//
// So the pure tests are not enough on their own: they prove the filter works
// given attributes, not that anything supplies them.

describe('R9 — the builder surfaces the headline attributes', () => {
  it('buildBomQuoteLines returns them', () => {
    const r = buildBomQuoteLines({
      bom: [{ material_category: 'downlight', quantity: 2, required: true }],
      resolveMaterial: () => ({
        name: 'Smart DL',
        markedUpPrice: 30,
        properties: { smart: true },
      }),
      labourHours: 0,
      labourRate: 0,
    })
    expect(r.headlineProperties).toEqual({ smart: true })
  })

  it('and NOT on the quote line, which is persisted and shown to customers', () => {
    // Product tags on every line would persist and expose data no quote
    // surface needs. It travels as a result field for one decision instead.
    const r = buildBomQuoteLines({
      bom: [{ material_category: 'downlight', quantity: 2, required: true }],
      resolveMaterial: () => ({ name: 'Smart DL', markedUpPrice: 30, properties: { smart: true } }),
      labourHours: 0,
      labourRate: 0,
    })
    expect('properties' in r.lines[0]).toBe(false)
  })

  it('each TIER carries its own, because each can hold a different product', () => {
    const cat: TenantMaterial[] = [
      { id: 'dl-plain', category: 'downlight', name: 'Plain DL', brand: 'A', range_series: '2000', unit_price_ex_gst: 10, active: true, properties: { smart: false } },
      { id: 'dl-smart', category: 'downlight', name: 'Smart DL', brand: 'A', range_series: 'Iconic', unit_price_ex_gst: 20, active: true, properties: { smart: true } },
      { id: 'dl-elite', category: 'downlight', name: 'Elite DL', brand: 'A', range_series: 'Signature', unit_price_ex_gst: 30, active: true, properties: { smart: false } },
    ]
    const bom: BomLine[] = [{ material_category: 'downlight', quantity: 2, required: true }]
    const t = buildDeterministicTiers({
      bom,
      tenantMaterials: cat,
      sharedMaterials: [],
      labourHours: 1,
      hourlyRate: 100,
      markupPct: 0,
    }).tiers!
    expect(t.good.headlineProperties).toEqual({ smart: false })
    expect(t.better.headlineProperties).toEqual({ smart: true })

    // And the payoff: the smart tier earns the pairing step, the plain one
    // does not — from the SAME shared checklist.
    const goodSteps = resolveAssemblyTasks({ sharedTasks: SHARED, productProperties: t.good.headlineProperties })
    const betterSteps = resolveAssemblyTasks({ sharedTasks: SHARED, productProperties: t.better.headlineProperties })
    expect(titles(goodSteps)).not.toContain('Pair the light to the app')
    expect(titles(betterSteps)).toContain('Pair the light to the app')
  })
})

describe('R9 — run.ts wires it the right way round', () => {
  const runTs = readFileSync(resolvePath(process.cwd(), 'lib', 'estimate', 'run.ts'), 'utf8')

  it('conditions steps on the BUILDER’s attributes, not on a quote line', () => {
    // The exact bug: `line.properties` does not exist. If this regresses, no
    // conditional step will ever appear again and nothing else will notice.
    expect(runTs).toMatch(/productProperties: built\.tiers\[tier\]\.headlineProperties/)
    expect(runTs).not.toMatch(/\?\.properties \?\? null,\s*\}\)/)
  })

  it('loads both tenant and shared task rows', () => {
    expect(runTs).toMatch(/from\('tenant_assembly_tasks'\)/)
    expect(runTs).toMatch(/from\('shared_assembly_tasks'\)/)
    expect(runTs).toMatch(/include_when/)
  })

  it('attaches tasks inside the tier, and omits the key when empty', () => {
    // The tier jsonb is already persisted on the quotes row, so this needs no
    // schema change; omitting when empty keeps a checklist-less quote
    // byte-identical to before.
    expect(runTs).toMatch(/tasks\.length > 0 \? \{ tasks \} : \{\}/)
  })

  it('never lets a checklist read fail the quote', () => {
    // A checklist is not a price. The load is wrapped and falls back to empty.
    const from = runTs.indexOf('let taskRows')
    const block = runTs.slice(from, from + 1400)
    expect(from).toBeGreaterThan(-1)
    expect(block).toMatch(/try \{/)
    expect(block).toMatch(/catch/)
  })
})
