// Unit tests for the Services-tab name-collision DISPLAY layer (R40).
//
// The cross-table detection itself is tested in service-delta.test.ts; here we
// verify the labelling/view-model that makes the two same-named rows
// unambiguous in the UI.

import { describe, it, expect } from 'vitest'
import {
  annotateNameCollisions,
  serviceSource,
  collisionTag,
  collisionHint,
  collisionView,
  type AnnotatedService,
} from './name-collision'

const annotated = (
  partial: { assembly_id: string; name: string; trade: string; is_custom: boolean },
): AnnotatedService => {
  // Run through the real annotator so the test exercises the full pipeline.
  const [row] = annotateNameCollisions([partial])
  return row as AnnotatedService
}

describe('annotateNameCollisions wiring (R40)', () => {
  it('flags BOTH the disabled shared row and the same-named custom row in one trade', () => {
    const rows = annotateNameCollisions([
      { assembly_id: '1', name: 'Smoke Alarm Install', trade: 'electrical', is_custom: false },
      { assembly_id: '2', name: 'smoke alarm install', trade: 'electrical', is_custom: true },
    ])
    expect(rows[0].name_collision).toBe(true)
    expect(rows[1].name_collision).toBe(true)
  })
  it('does NOT flag same-named rows in DIFFERENT trades', () => {
    const rows = annotateNameCollisions([
      { assembly_id: '1', name: 'Inspection', trade: 'electrical', is_custom: false },
      { assembly_id: '2', name: 'Inspection', trade: 'plumbing', is_custom: true },
    ])
    expect(rows.every((r) => r.name_collision === false)).toBe(true)
  })
})

describe('serviceSource', () => {
  it('maps is_custom to a source label', () => {
    expect(serviceSource({ is_custom: true })).toBe('custom')
    expect(serviceSource({ is_custom: false })).toBe('catalogue')
  })
})

describe('collisionTag + collisionHint + collisionView', () => {
  it('tags the custom row as YOUR CUSTOM and the shared row as CATALOGUE when colliding', () => {
    const custom = annotated({ assembly_id: '2', name: 'X', trade: 'electrical', is_custom: true })
    // force a collision by annotating both together
    const [sharedRow, customRow] = annotateNameCollisions([
      { assembly_id: '1', name: 'X', trade: 'electrical', is_custom: false },
      { assembly_id: '2', name: 'X', trade: 'electrical', is_custom: true },
    ]) as AnnotatedService[]
    expect(collisionTag(sharedRow)).toBe('CATALOGUE')
    expect(collisionTag(customRow)).toBe('YOUR CUSTOM')
    // sanity: standalone custom (no collision) gets no tag
    expect(collisionTag(custom)).toBeNull()
  })

  it('returns null tag/hint for a non-colliding row', () => {
    const solo = annotated({ assembly_id: '9', name: 'Solo', trade: 'electrical', is_custom: false })
    expect(collisionTag(solo)).toBeNull()
    expect(collisionHint(solo)).toBeNull()
    const v = collisionView(solo)
    expect(v.collides).toBe(false)
    expect(v.tag).toBeNull()
    expect(v.hint).toBeNull()
    expect(v.source).toBe('catalogue')
  })

  it('hint distinguishes the custom side from the catalogue side', () => {
    const [sharedRow, customRow] = annotateNameCollisions([
      { assembly_id: '1', name: 'X', trade: 'electrical', is_custom: false },
      { assembly_id: '2', name: 'X', trade: 'electrical', is_custom: true },
    ]) as AnnotatedService[]
    expect(collisionHint(customRow)).toMatch(/YOUR custom version/i)
    expect(collisionHint(sharedRow)).toMatch(/STANDARD catalogue version/i)
  })

  it('collisionView packages everything for a colliding custom row', () => {
    const [, customRow] = annotateNameCollisions([
      { assembly_id: '1', name: 'X', trade: 'electrical', is_custom: false },
      { assembly_id: '2', name: 'X', trade: 'electrical', is_custom: true },
    ]) as AnnotatedService[]
    const v = collisionView(customRow)
    expect(v).toEqual({
      source: 'custom',
      collides: true,
      tag: 'YOUR CUSTOM',
      hint: expect.stringMatching(/YOUR custom version/i),
    })
  })
})
