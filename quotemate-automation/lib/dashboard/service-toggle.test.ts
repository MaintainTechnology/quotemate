// Unit tests for the CLIENT-side service-toggle helpers (R36).
//
// The headline guarantee: overlapping toggles on different rows do not
// clobber each other. We simulate two in-flight toggles and assert that
// settling one never disturbs the other's optimistic value.

import { describe, it, expect } from 'vitest'
import {
  liveEnabled,
  nextEnabledFor,
  buildServiceTogglePayload,
  applyOptimistic,
  reconcilePending,
  reconcileFromServer,
  type PendingMap,
  type ToggleableService,
} from './service-toggle'

const A = 'a0000000-0000-4000-8000-000000000001'
const B = 'b0000000-0000-4000-8000-000000000002'

const shared = (enabled: boolean): ToggleableService => ({
  assembly_id: A,
  enabled,
  is_custom: false,
})
const custom = (enabled: boolean): ToggleableService => ({
  assembly_id: B,
  enabled,
  is_custom: true,
})

describe('liveEnabled', () => {
  it('returns the server value when nothing is pending', () => {
    expect(liveEnabled({}, A, true)).toBe(true)
    expect(liveEnabled({}, A, false)).toBe(false)
  })
  it('prefers the pending optimistic value when present, including false', () => {
    expect(liveEnabled({ [A]: false }, A, true)).toBe(false)
    expect(liveEnabled({ [A]: true }, A, false)).toBe(true)
  })
})

describe('nextEnabledFor', () => {
  it('flips the server value when no pending entry', () => {
    expect(nextEnabledFor({}, shared(true))).toBe(false)
    expect(nextEnabledFor({}, shared(false))).toBe(true)
  })
  it('flips the PENDING value (not the stale server value) when one exists', () => {
    // server=true but the user already optimistically turned it off → next is on
    expect(nextEnabledFor({ [A]: false }, shared(true))).toBe(true)
  })
})

describe('buildServiceTogglePayload', () => {
  it('emits a single-row service_delta for a shared service', () => {
    expect(buildServiceTogglePayload(shared(true), false)).toEqual({
      service_delta: { assembly_id: A, enabled: false, is_custom: false },
    })
  })
  it('marks is_custom for a custom service', () => {
    expect(buildServiceTogglePayload(custom(false), true)).toEqual({
      service_delta: { assembly_id: B, enabled: true, is_custom: true },
    })
  })
  it('never sends a full services dict (only the single delta key)', () => {
    const payload = buildServiceTogglePayload(shared(true), false) as Record<string, unknown>
    expect(Object.keys(payload)).toEqual(['service_delta'])
    expect('services' in payload).toBe(false)
    expect('custom_services' in payload).toBe(false)
  })
})

describe('applyOptimistic + reconcile — overlapping toggles do not clobber', () => {
  it('two concurrent toggles keep independent pending entries', () => {
    let pending: PendingMap = {}
    // User flips row A off, then (before A settles) flips row B on.
    pending = applyOptimistic(pending, A, false)
    pending = applyOptimistic(pending, B, true)
    expect(pending).toEqual({ [A]: false, [B]: true })

    // Row A's PATCH settles (success) → only A's key is dropped; B untouched.
    pending = reconcilePending(pending, A)
    expect(pending).toEqual({ [B]: true })

    // Row B's PATCH settles → B's key drops; map is clean.
    pending = reconcilePending(pending, B)
    expect(pending).toEqual({})
  })

  it('settling a row leaves an UNRELATED in-flight row intact (anti-clobber)', () => {
    const pending: PendingMap = { [A]: true, [B]: false }
    const after = reconcilePending(pending, A)
    expect(after).toEqual({ [B]: false })
    // input not mutated
    expect(pending).toEqual({ [A]: true, [B]: false })
  })

  it('reconcile is a no-op when the row has no pending entry', () => {
    const pending: PendingMap = { [B]: true }
    expect(reconcilePending(pending, A)).toBe(pending)
  })

  it('failure reconcile reverts the row to its server value (drops pending)', () => {
    // optimistic flip to false, PATCH fails → drop pending → row reads server=true again
    let pending: PendingMap = applyOptimistic({}, A, false)
    pending = reconcilePending(pending, A) // same path used on failure
    expect(liveEnabled(pending, A, true)).toBe(true)
  })
})

describe('reconcileFromServer (forward-compatible echo)', () => {
  it('pins the row to the echoed value when the server echoes the delta', () => {
    const pending: PendingMap = { [A]: true }
    const out = reconcileFromServer(pending, A, { assembly_id: A, enabled: false })
    expect(out[A]).toBe(false)
  })
  it('falls back to dropping the pending entry when no echo is present', () => {
    const pending: PendingMap = { [A]: true, [B]: false }
    expect(reconcileFromServer(pending, A, null)).toEqual({ [B]: false })
    expect(reconcileFromServer(pending, A, undefined)).toEqual({ [B]: false })
  })
  it('ignores an echo for a different row', () => {
    const pending: PendingMap = { [A]: true }
    const out = reconcileFromServer(pending, A, { assembly_id: B, enabled: false })
    // echo doesn't match A → behaves like reconcilePending(A)
    expect(out).toEqual({})
  })
})
