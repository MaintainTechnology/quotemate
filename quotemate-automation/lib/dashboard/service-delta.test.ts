// Unit tests for the pure service-delta helpers (R36 + R40).
//
// No DB, no Supabase — these functions are the testable core the
// /api/tenant/me route wires to. The route-level test (app/api/tenant/me/
// route.test.ts) covers the Supabase-write wiring; this file covers the
// branchy pure logic in isolation.

import { describe, it, expect } from 'vitest'
import {
  normalizeServiceDelta,
  buildServiceWritePlan,
  mergeWithLegacyDicts,
  normalizeServiceName,
  annotateNameCollisions,
  type ServiceDeltaEntry,
} from './service-delta'

const A = 'a0000000-0000-4000-8000-000000000001'
const B = 'b0000000-0000-4000-8000-000000000002'
const C = 'c0000000-0000-4000-8000-000000000003'

describe('normalizeServiceDelta (R36)', () => {
  it('wraps a single entry into a one-element array', () => {
    expect(normalizeServiceDelta({ assembly_id: A, enabled: true })).toEqual([
      { assembly_id: A, enabled: true },
    ])
  })

  it('passes an array through unchanged', () => {
    const arr: ServiceDeltaEntry[] = [
      { assembly_id: A, enabled: false },
      { assembly_id: B, enabled: true, is_custom: true },
    ]
    expect(normalizeServiceDelta(arr)).toEqual(arr)
  })

  it('drops malformed leaves defensively (null / wrong types)', () => {
    const dirty = [
      { assembly_id: A, enabled: true },
      null,
      { assembly_id: B }, // no enabled
      { enabled: true }, // no assembly_id
      { assembly_id: 123, enabled: true }, // wrong type
    ] as unknown as ServiceDeltaEntry[]
    expect(normalizeServiceDelta(dirty)).toEqual([{ assembly_id: A, enabled: true }])
  })
})

describe('buildServiceWritePlan (R36)', () => {
  it('routes shared vs custom by is_custom', () => {
    const plan = buildServiceWritePlan([
      { assembly_id: A, enabled: true },
      { assembly_id: B, enabled: false, is_custom: true },
      { assembly_id: C, enabled: true, is_custom: false },
    ])
    expect(plan).toEqual({
      shared: { [A]: true, [C]: true },
      custom: { [B]: false },
    })
  })

  it('last-write-wins on duplicate assembly_id (deterministic merge)', () => {
    const plan = buildServiceWritePlan([
      { assembly_id: A, enabled: true },
      { assembly_id: A, enabled: false },
    ])
    expect(plan.shared[A]).toBe(false)
  })

  it('empty input yields empty plan', () => {
    expect(buildServiceWritePlan([])).toEqual({ shared: {}, custom: {} })
  })
})

describe('mergeWithLegacyDicts (R36 back-compat)', () => {
  it('combines legacy full-dicts with the delta plan', () => {
    const plan = buildServiceWritePlan([{ assembly_id: C, enabled: true, is_custom: true }])
    const merged = mergeWithLegacyDicts(plan, { [A]: false }, { [B]: false })
    expect(merged).toEqual({
      shared: { [A]: false },
      custom: { [B]: false, [C]: true },
    })
  })

  it('delta WINS over legacy dict on the same key (fresher signal)', () => {
    const plan = buildServiceWritePlan([{ assembly_id: A, enabled: true }])
    const merged = mergeWithLegacyDicts(plan, { [A]: false }, undefined)
    expect(merged.shared[A]).toBe(true)
  })

  it('handles undefined legacy dicts', () => {
    const plan = buildServiceWritePlan([{ assembly_id: A, enabled: true }])
    const merged = mergeWithLegacyDicts(plan, undefined, undefined)
    expect(merged).toEqual({ shared: { [A]: true }, custom: {} })
  })

  it('an empty delta leaves the legacy dicts as the sole source', () => {
    const plan = buildServiceWritePlan([])
    const merged = mergeWithLegacyDicts(plan, { [A]: true }, undefined)
    expect(merged).toEqual({ shared: { [A]: true }, custom: {} })
  })
})

describe('normalizeServiceName (R40)', () => {
  it('trims, lowercases, collapses internal whitespace', () => {
    expect(normalizeServiceName('  LED   Downlight ')).toBe('led downlight')
    expect(normalizeServiceName('led downlight')).toBe('led downlight')
  })

  it('non-strings → empty (never collide)', () => {
    expect(normalizeServiceName(null)).toBe('')
    expect(normalizeServiceName(undefined)).toBe('')
    expect(normalizeServiceName(42)).toBe('')
  })
})

describe('annotateNameCollisions (R40)', () => {
  it('flags a custom service colliding with a shared service in the same trade', () => {
    const out = annotateNameCollisions([
      { assembly_id: A, name: 'LED Downlight', trade: 'electrical', is_custom: false },
      { assembly_id: B, name: 'led downlight', trade: 'electrical', is_custom: true },
    ])
    // BOTH sides flagged so the UI can badge either row.
    expect(out.find((s) => s.assembly_id === A)!.name_collision).toBe(true)
    expect(out.find((s) => s.assembly_id === B)!.name_collision).toBe(true)
  })

  it('does NOT flag same-name rows in DIFFERENT trades', () => {
    const out = annotateNameCollisions([
      { assembly_id: A, name: 'Inspection', trade: 'electrical', is_custom: false },
      { assembly_id: B, name: 'Inspection', trade: 'plumbing', is_custom: true },
    ])
    expect(out.every((s) => s.name_collision === false)).toBe(true)
  })

  it('does NOT flag a same-table duplicate (only cross-table collisions)', () => {
    // Two shared rows with the same name is a catalogue bug, not a tradie
    // action — not the cross-table case this discriminator is for.
    const out = annotateNameCollisions([
      { assembly_id: A, name: 'Downlight', trade: 'electrical', is_custom: false },
      { assembly_id: B, name: 'Downlight', trade: 'electrical', is_custom: false },
    ])
    expect(out.every((s) => s.name_collision === false)).toBe(true)
  })

  it('no collision when names differ', () => {
    const out = annotateNameCollisions([
      { assembly_id: A, name: 'Downlight', trade: 'electrical', is_custom: false },
      { assembly_id: B, name: 'Power Point', trade: 'electrical', is_custom: true },
    ])
    expect(out.every((s) => s.name_collision === false)).toBe(true)
  })

  it('does not mutate inputs and preserves order', () => {
    const input = [
      { assembly_id: A, name: 'X', trade: 'electrical', is_custom: false },
      { assembly_id: B, name: 'Y', trade: 'electrical', is_custom: true },
    ]
    const out = annotateNameCollisions(input)
    expect(out.map((s) => s.assembly_id)).toEqual([A, B])
    expect((input[0] as Record<string, unknown>).name_collision).toBeUndefined()
  })

  it('empty / whitespace-only names never collide', () => {
    const out = annotateNameCollisions([
      { assembly_id: A, name: '   ', trade: 'electrical', is_custom: false },
      { assembly_id: B, name: '', trade: 'electrical', is_custom: true },
    ])
    expect(out.every((s) => s.name_collision === false)).toBe(true)
  })
})
