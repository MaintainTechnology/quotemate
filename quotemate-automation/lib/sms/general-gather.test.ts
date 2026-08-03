// The signal that closes the trade-hijack class.
//
// Fixtures are REAL live states from the 378-conversation dataset, not invented
// shapes, because the whole difficulty here was picking a signal that fires on
// the 7 genuine class rows and not on the 15 legitimate handoffs.

import { describe, it, expect } from 'vitest'
import { generalDialogIsMidGather } from './general-gather'
import { shouldEngageRoofing } from './roofing-receptionist'
import { shouldEngagePainting } from './painting-receptionist'

describe('the failing thread — b2625cbe, verbatim', () => {
  // conversation_state exactly as stored when the roofing receptionist took the
  // thread. Every slot from_transcript; job_type correctly 'downlights'.
  const FAILURE = {
    slots: { room: 'patio', count: 16, suburb: 'Chandler', job_type: 'downlights', first_name: 'Jon' },
    sources: {
      room: 'from_transcript',
      count: 'from_transcript',
      suburb: 'from_transcript',
      job_type: 'from_transcript',
      first_name: 'from_transcript',
    },
    last_extracted_at: '2026-07-31T22:14:06.482Z',
  }

  it('is recognised as mid-gather', () => {
    expect(generalDialogIsMidGather(FAILURE)).toBe(true)
  })

  it('is still recognised WITHOUT job_type — the slot CLAUDE.md said to avoid', () => {
    // 5 of the 7 historical class rows have no job_type. A guard keyed on it
    // alone would have missed them, which is why the signal is broader.
    const slots = { ...FAILURE.slots } as Record<string, unknown>
    const sources = { ...FAILURE.sources } as Record<string, unknown>
    delete slots.job_type
    delete sources.job_type
    expect(generalDialogIsMidGather({ slots, sources })).toBe(true)
  })

  it('is recognised from a SINGLE trade-specific slot', () => {
    // ccb1a539 and c28b6b48 carry only `requested_specs`; 28d7d73d only
    // `job_type`; f3069b7b only `replace_or_new`.
    for (const [k, v] of [
      ['requested_specs', { amperage: '15' }],
      ['replace_or_new', 'new'],
      ['job_type', 'downlights'],
      ['count', 16],
      ['room', 'patio'],
      ['ceiling_type', 'sheet_metal'],
      ['colour', 'white'],
      ['circuit_required', '20A'],
    ] as const) {
      expect(
        generalDialogIsMidGather({ slots: { [k]: v }, sources: { [k]: 'from_transcript' } }),
        k,
      ).toBe(true)
    }
  })
})

describe('the 15 LEGITIMATE handoffs must not be blocked', () => {
  it('agnostic slots pre-seeded from the customers row are NOT a gather', () => {
    // c9f5e4e0 — Ricardos Roofing, trades=['roofing']. Name/suburb/address
    // harvested from memory, then roofing engaged. Correct behaviour; a guard
    // that fired here would block a roofing-only tenant's core flow.
    expect(
      generalDialogIsMidGather({
        slots: { first_name: 'Ric', suburb: 'Chandler', address: '1 Test St' },
        sources: { first_name: 'from_memory', suburb: 'from_memory', address: 'from_memory' },
      }),
    ).toBe(false)
  })

  it('agnostic slots are not a gather even when the customer DID say them', () => {
    // Giving a name and suburb does not say which trade. Roofing must still be
    // reachable by keyword after "Hi, Jon here, Chandler".
    expect(
      generalDialogIsMidGather({
        slots: { first_name: 'Jon', suburb: 'Chandler', address: '670 London Rd', verified: true },
        sources: {
          first_name: 'from_transcript',
          suburb: 'from_transcript',
          address: 'from_transcript',
          verified: 'from_transcript',
        },
      }),
    ).toBe(false)
  })

  it('an empty state is not a gather — 159 of 183 recent conversations', () => {
    expect(generalDialogIsMidGather({ slots: {}, sources: {} })).toBe(false)
    expect(generalDialogIsMidGather({ slots: {}, sources: {}, last_extracted_at: null })).toBe(false)
  })

  it('a trade-specific slot carried FROM MEMORY is not a gather', () => {
    // The customers row is keyed on phone number alone and can hold a job_type
    // from an unrelated earlier job. That must not lock out a new trade.
    expect(
      generalDialogIsMidGather({
        slots: { job_type: 'downlights', room: 'kitchen' },
        sources: { job_type: 'from_memory', room: 'from_memory' },
      }),
    ).toBe(false)
  })

  it('a corrected slot IS a gather — the customer engaged with the question', () => {
    expect(
      generalDialogIsMidGather({
        slots: { count: 10 },
        sources: { count: 'customer_corrected' },
      }),
    ).toBe(true)
  })
})

describe('conservative on anything unexpected — uncertainty keeps today’s behaviour', () => {
  it('null, undefined and non-objects are not a gather', () => {
    for (const v of [null, undefined, 'string', 42, [], true]) {
      expect(generalDialogIsMidGather(v), JSON.stringify(v)).toBe(false)
    }
  })

  it('a slot with no matching source entry is not a gather', () => {
    // Provenance unknown means we cannot tell memory from transcript, and
    // guessing "transcript" would block roofing on stale seeded data.
    expect(generalDialogIsMidGather({ slots: { count: 16 } })).toBe(false)
    expect(generalDialogIsMidGather({ slots: { count: 16 }, sources: {} })).toBe(false)
  })

  it('null and blank slot values are ignored', () => {
    expect(
      generalDialogIsMidGather({
        slots: { count: null, room: '', job_type: undefined },
        sources: { count: 'from_transcript', room: 'from_transcript', job_type: 'from_transcript' },
      }),
    ).toBe(false)
  })

  it('an explicit false on a trade-specific slot still counts as an answer', () => {
    // `verified` is agnostic and excluded, but a future boolean slot answered
    // "no" is still the customer engaging with the gather.
    expect(
      generalDialogIsMidGather({
        slots: { supplied_by: 'customer' },
        sources: { supplied_by: 'from_transcript' },
      }),
    ).toBe(true)
  })

  it('is pure — same state twice, same verdict', () => {
    const s = { slots: { count: 16 }, sources: { count: 'from_transcript' } }
    expect(generalDialogIsMidGather(s)).toBe(generalDialogIsMidGather(s))
  })
})

// ── the guard itself, end to end ────────────────────────────────────────
//
// The signal above is only useful if the engagement arms actually consult it.
// These drive the real shouldEngageRoofing / shouldEngagePainting.

describe('the guard closes the class', () => {
  const MID_GATHER = true
  const COLD = false

  it('roofing does NOT engage on a keyword mid-electrical-gather', () => {
    // The exact failing turn against the exact failing state.
    expect(
      shouldEngageRoofing(null, "It's a 125mm insulated panel roofing", false, false, MID_GATHER),
    ).toBe(false)
  })

  it('and not even on an UNAMBIGUOUS roofing keyword mid-gather', () => {
    // This is the accepted trade-off, asserted so it is a decision and not a
    // surprise: a real roof request on a live electrical thread stays with the
    // general dialog. A missed upsell beats quoting the wrong trade.
    expect(shouldEngageRoofing(null, 'I need a re-roof', false, false, MID_GATHER)).toBe(false)
  })

  it('but DOES engage on a cold thread — normal routing is untouched', () => {
    expect(shouldEngageRoofing(null, 'I need a re-roof', false, false, COLD)).toBe(true)
  })

  it('an ACTIVE roofing thread still resumes, gather or not', () => {
    // canResume is deliberately not gated: a genuine roofing conversation must
    // survive across turns. Gating it would strand every live roofing thread.
    const active = { slots: {}, last_step: 'intent' as const }
    expect(shouldEngageRoofing(active, 'flat', false, false, MID_GATHER)).toBe(true)
  })

  it('a roofing-ONLY tenant still engages with no keyword, gather or not', () => {
    // Bills roofing / Bob Roofing / Ricardos have no other trade to route to.
    expect(shouldEngageRoofing(null, 'how much for my place?', false, true, MID_GATHER)).toBe(true)
  })

  it('a declined trade still wins over everything', () => {
    const declined = { slots: {}, declined_trades: ['roofing'] } as never
    expect(shouldEngageRoofing(declined, 'I need a re-roof', false, false, COLD)).toBe(false)
  })

  it('painting does NOT engage on a keyword mid-electrical-gather', () => {
    // Worse on this side: there is no namesOtherTrade equivalent, so once
    // painting engages on a live electrical thread there is no escape at all.
    expect(shouldEngagePainting(null, 'can you paint my house', false, MID_GATHER)).toBe(false)
  })

  it('but painting DOES engage on a cold thread', () => {
    expect(shouldEngagePainting(null, 'can you paint my house', false, COLD)).toBe(true)
  })

  it('default argument keeps every existing caller unchanged', () => {
    // Both new parameters default false, so any caller that has not been
    // updated behaves exactly as it did before this change.
    expect(shouldEngageRoofing(null, 'I need a re-roof', false)).toBe(true)
    expect(shouldEngagePainting(null, 'can you paint my house', false)).toBe(true)
  })
})
