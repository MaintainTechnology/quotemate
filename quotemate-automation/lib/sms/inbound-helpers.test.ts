// Unit coverage for the pure inbound-route hardening helpers (R42/R43/R44/R47).
// Pure functions over plain data — no supabase/twilio/next mocks needed.

import { describe, expect, it } from 'vitest'
import {
  arrivalTimestampsFromTurns,
  classifyInboundInsert,
  decideConversationUpsert,
  decideSidDedup,
  DispatchFailedError,
  isNearMaxDuration,
  PG_UNIQUE_VIOLATION,
  sideEffectsAllowed,
  throwIfDispatchFailed,
} from './inbound-helpers'
import { isRetryableSendError } from './send-reliability'

// ---------------------------------------------------------------------------
// R47 — decideSidDedup
// ---------------------------------------------------------------------------

describe('decideSidDedup', () => {
  it('processes when there is no SID (fail-open, never drop a real message)', () => {
    expect(decideSidDedup(null, null)).toEqual({ action: 'process', reason: 'no_sid' })
    expect(decideSidDedup(undefined, { id: 'x' })).toEqual({ action: 'process', reason: 'no_sid' })
  })

  it('processes when the SID has not been persisted yet', () => {
    expect(decideSidDedup('SM123', null)).toEqual({ action: 'process', reason: 'no_existing_row' })
    expect(decideSidDedup('SM123', undefined)).toEqual({ action: 'process', reason: 'no_existing_row' })
  })

  it('skips as duplicate when the SID already has an inbound row', () => {
    expect(decideSidDedup('SM123', { id: 'row-1', conversation_id: 'c-1' })).toEqual({
      action: 'skip_duplicate',
      reason: 'sid_already_persisted',
      existingId: 'row-1',
    })
  })

  it('does not treat a row with a falsy id as a duplicate', () => {
    expect(decideSidDedup('SM123', { id: '' })).toEqual({ action: 'process', reason: 'no_existing_row' })
  })
})

// ---------------------------------------------------------------------------
// R47 — classifyInboundInsert
// ---------------------------------------------------------------------------

describe('classifyInboundInsert', () => {
  it('continues when there is no insert error', () => {
    expect(classifyInboundInsert(null)).toEqual({ action: 'continue' })
    expect(classifyInboundInsert(undefined)).toEqual({ action: 'continue' })
  })

  it('acks as duplicate on a unique_violation (the same-ms retry race)', () => {
    expect(classifyInboundInsert({ code: PG_UNIQUE_VIOLATION })).toEqual({
      action: 'ack_duplicate',
      reason: 'unique_sid_race',
    })
    expect(PG_UNIQUE_VIOLATION).toBe('23505')
  })

  it('reports a real db error for any other code', () => {
    expect(classifyInboundInsert({ code: 'PGRST204' })).toEqual({ action: 'db_error', code: 'PGRST204' })
    expect(classifyInboundInsert({})).toEqual({ action: 'db_error', code: null })
  })
})

// ---------------------------------------------------------------------------
// R47 — sideEffectsAllowed
// ---------------------------------------------------------------------------

describe('sideEffectsAllowed', () => {
  const base = {
    decisionIsFinish: true,
    hasExistingIntake: false,
    wp9HoldingForChoice: false,
    inflightContinuation: false,
  }
  it('allows side effects only on a clean finish', () => {
    expect(sideEffectsAllowed(base)).toBe(true)
  })
  it('blocks when not a finish', () => {
    expect(sideEffectsAllowed({ ...base, decisionIsFinish: false })).toBe(false)
  })
  it('blocks when a quote already exists (duplicate-quote guard)', () => {
    expect(sideEffectsAllowed({ ...base, hasExistingIntake: true })).toBe(false)
  })
  it('blocks while a product choice is held', () => {
    expect(sideEffectsAllowed({ ...base, wp9HoldingForChoice: true })).toBe(false)
  })
  it('blocks during an in-flight continuation', () => {
    expect(sideEffectsAllowed({ ...base, inflightContinuation: true })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// R43 — decideConversationUpsert
// ---------------------------------------------------------------------------

describe('decideConversationUpsert', () => {
  it('uses the created row when the insert won the race', () => {
    expect(decideConversationUpsert({ id: 'new-1' }, null)).toEqual({
      action: 'use_created',
      id: 'new-1',
    })
  })

  it('adopts the existing row when ON CONFLICT DO NOTHING swallowed our insert', () => {
    // created=null (lost race), existing fetched by the follow-up select.
    expect(decideConversationUpsert(null, { id: 'winner-1' })).toEqual({
      action: 'use_existing',
      id: 'winner-1',
      reason: 'lost_insert_race',
    })
  })

  it('prefers the created row even if an existing one is also present', () => {
    expect(decideConversationUpsert({ id: 'new-1' }, { id: 'old-1' })).toEqual({
      action: 'use_created',
      id: 'new-1',
    })
  })

  it('fails when neither a created nor an existing row is available', () => {
    expect(decideConversationUpsert(null, null)).toEqual({
      action: 'fail',
      reason: 'no_row_after_upsert',
    })
  })
})

// ---------------------------------------------------------------------------
// R44 — arrivalTimestampsFromTurns
// ---------------------------------------------------------------------------

describe('arrivalTimestampsFromTurns', () => {
  it('returns only inbound timestamps from the current un-replied burst', () => {
    const t0 = Date.parse('2026-06-18T10:00:00.000Z')
    const rows = [
      { direction: 'inbound', created_at: '2026-06-18T09:00:00.000Z' }, // old turn
      { direction: 'outbound', created_at: '2026-06-18T09:00:05.000Z' }, // agent replied
      { direction: 'inbound', created_at: '2026-06-18T10:00:00.000Z' }, // burst 1
      { direction: 'inbound', created_at: '2026-06-18T10:00:00.800Z' }, // burst 2
    ]
    expect(arrivalTimestampsFromTurns(rows)).toEqual([t0, t0 + 800])
  })

  it('returns all inbound timestamps when there is no prior outbound (first burst)', () => {
    const rows = [
      { direction: 'inbound', created_at: '2026-06-18T10:00:00.000Z' },
      { direction: 'inbound', created_at: '2026-06-18T10:00:01.000Z' },
    ]
    expect(arrivalTimestampsFromTurns(rows)).toHaveLength(2)
  })

  it('drops rows with unparseable/blank timestamps', () => {
    const rows = [
      { direction: 'inbound', created_at: 'not-a-date' },
      { direction: 'inbound', created_at: null },
      { direction: 'inbound', created_at: '2026-06-18T10:00:00.000Z' },
    ]
    expect(arrivalTimestampsFromTurns(rows)).toHaveLength(1)
  })

  it('handles null/empty input', () => {
    expect(arrivalTimestampsFromTurns(null)).toEqual([])
    expect(arrivalTimestampsFromTurns([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// R46-inbound — throwIfDispatchFailed + classification round-trip
// ---------------------------------------------------------------------------

describe('throwIfDispatchFailed', () => {
  it('passes a successful dispatch through unchanged', () => {
    const ok = { ok: true as const, channel: 'sms' }
    expect(throwIfDispatchFailed(ok)).toBe(ok)
  })

  it('throws a DispatchFailedError carrying the SMS attempt code', () => {
    try {
      throwIfDispatchFailed({ ok: false, smsAttempt: { code: 'NETWORK', reason: 'fetch failed' } })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(DispatchFailedError)
      expect((e as DispatchFailedError).code).toBe('NETWORK')
    }
  })

  it('defaults to UNKNOWN when no smsAttempt code is present', () => {
    try {
      throwIfDispatchFailed({ ok: false })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as DispatchFailedError).code).toBe('UNKNOWN')
    }
  })

  it('a thrown NETWORK failure is classified retryable by the shared policy (R46 gap closed)', () => {
    let thrown: unknown
    try {
      throwIfDispatchFailed({ ok: false, smsAttempt: { code: 'NETWORK', reason: 'aborted' } })
    } catch (e) {
      thrown = e
    }
    // This is the precise case the AI-reply path used to skip: a transient
    // abort/network failure must be retryable.
    expect(isRetryableSendError(thrown)).toBe(true)
  })

  it('a carrier-permanent failure (21610 STOP) is classified terminal', () => {
    let thrown: unknown
    try {
      throwIfDispatchFailed({ ok: false, smsAttempt: { code: '21610', reason: 'STOP' } })
    } catch (e) {
      thrown = e
    }
    expect(isRetryableSendError(thrown)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// R42 — isNearMaxDuration
// ---------------------------------------------------------------------------

describe('isNearMaxDuration', () => {
  it('is false early in the budget', () => {
    expect(isNearMaxDuration(10_000, 300)).toBe(false) // 10s of 300s
  })

  it('is true once past the default 85% margin', () => {
    expect(isNearMaxDuration(255_001, 300)).toBe(true) // > 0.85 * 300s
    expect(isNearMaxDuration(254_999, 300)).toBe(false)
  })

  it('respects a custom margin ratio', () => {
    expect(isNearMaxDuration(150_000, 300, 0.5)).toBe(true)
    expect(isNearMaxDuration(149_000, 300, 0.5)).toBe(false)
  })

  it('is false for nonsensical inputs (never alerts spuriously)', () => {
    expect(isNearMaxDuration(-1, 300)).toBe(false)
    expect(isNearMaxDuration(10_000, 0)).toBe(false)
    expect(isNearMaxDuration(NaN, 300)).toBe(false)
  })
})
