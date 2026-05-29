// Pure-logic coverage for the 2-hour customer follow-up decision module.
//
// Locks every fire/skip gate so the cron sweep can never silently start
// nagging customers, double-sending, or resurrecting stale quotes.

import { describe, expect, it } from 'vitest'
import {
  FOLLOWUP_2H_MIN_AGE_MS,
  FOLLOWUP_2H_MAX_AGE_MS,
  shouldSendFollowup2h,
  type Followup2hInput,
} from './followup-2h'

const NOW = new Date('2026-05-29T12:00:00.000Z').getTime()

/** Build a baseline ripe input — every test starts from "would fire" and
 *  mutates one field to assert a specific skip reason. */
function baseRipe(overrides: Partial<Followup2hInput> = {}): Followup2hInput {
  const sentMs = NOW - 3 * 60 * 60 * 1000 // 3h ago — inside [2h, 24h)
  return {
    enabledForTenant: true,
    quoteStatus: 'sent',
    sentAt: new Date(sentMs).toISOString(),
    quoteCreatedAt: new Date(sentMs - 60_000).toISOString(),
    followup2hSentAt: null,
    lastCustomerInboundAt: null,
    needsInspection: false,
    paidAt: null,
    acceptedAt: null,
    currentTime: NOW,
    ...overrides,
  }
}

describe('shouldSendFollowup2h — tenant + idempotency gates', () => {
  it('disabled tenant returns skip:disabled even when everything else is ripe', () => {
    expect(shouldSendFollowup2h(baseRipe({ enabledForTenant: false }))).toEqual({
      fire: false,
      reason: 'disabled',
    })
  })

  it('quote with null sent_at returns skip:not_sent', () => {
    expect(shouldSendFollowup2h(baseRipe({ sentAt: null }))).toEqual({
      fire: false,
      reason: 'not_sent',
    })
  })

  it('quote with existing followup_2h_sent_at returns skip:already_sent', () => {
    const decision = shouldSendFollowup2h(
      baseRipe({
        followup2hSentAt: new Date(NOW - 30 * 60 * 1000).toISOString(),
      }),
    )
    expect(decision).toEqual({ fire: false, reason: 'already_sent' })
  })
})

describe('shouldSendFollowup2h — inspection + terminal-state gates', () => {
  it('needs_inspection=true returns skip:inspection', () => {
    expect(shouldSendFollowup2h(baseRipe({ needsInspection: true }))).toEqual({
      fire: false,
      reason: 'inspection',
    })
  })

  it('paid_at set returns skip:converted', () => {
    expect(
      shouldSendFollowup2h(baseRipe({ paidAt: new Date(NOW - 60_000).toISOString() })),
    ).toEqual({ fire: false, reason: 'converted' })
  })

  it('accepted_at set returns skip:converted', () => {
    expect(
      shouldSendFollowup2h(
        baseRipe({ acceptedAt: new Date(NOW - 60_000).toISOString() }),
      ),
    ).toEqual({ fire: false, reason: 'converted' })
  })

  it.each(['paid', 'accepted', 'booked', 'cancelled'] as const)(
    "quoteStatus='%s' returns skip:converted",
    (status) => {
      expect(shouldSendFollowup2h(baseRipe({ quoteStatus: status }))).toEqual({
        fire: false,
        reason: 'converted',
      })
    },
  )
})

describe('shouldSendFollowup2h — status gate', () => {
  it.each(['draft', 'awaiting_tradie_approval'] as const)(
    "quoteStatus='%s' returns skip:wrong_status",
    (status) => {
      expect(shouldSendFollowup2h(baseRipe({ quoteStatus: status }))).toEqual({
        fire: false,
        reason: 'wrong_status',
      })
    },
  )

  it("quoteStatus='viewed' age 6h is ripe (viewed is fire-eligible)", () => {
    const sentMs = NOW - 6 * 60 * 60 * 1000
    expect(
      shouldSendFollowup2h(
        baseRipe({
          quoteStatus: 'viewed',
          sentAt: new Date(sentMs).toISOString(),
        }),
      ),
    ).toEqual({ fire: true, reason: 'ripe' })
  })
})

describe('shouldSendFollowup2h — age window', () => {
  it('age 90 minutes returns skip:too_young', () => {
    const sentMs = NOW - 90 * 60 * 1000
    expect(
      shouldSendFollowup2h(baseRipe({ sentAt: new Date(sentMs).toISOString() })),
    ).toEqual({ fire: false, reason: 'too_young' })
  })

  it('age exactly 2h is ripe (floor inclusive)', () => {
    const sentMs = NOW - FOLLOWUP_2H_MIN_AGE_MS
    expect(
      shouldSendFollowup2h(baseRipe({ sentAt: new Date(sentMs).toISOString() })),
    ).toEqual({ fire: true, reason: 'ripe' })
  })

  it('age exactly 24h returns skip:too_old (ceiling exclusive)', () => {
    const sentMs = NOW - FOLLOWUP_2H_MAX_AGE_MS
    expect(
      shouldSendFollowup2h(baseRipe({ sentAt: new Date(sentMs).toISOString() })),
    ).toEqual({ fire: false, reason: 'too_old' })
  })

  it('age 26h returns skip:too_old', () => {
    const sentMs = NOW - 26 * 60 * 60 * 1000
    expect(
      shouldSendFollowup2h(baseRipe({ sentAt: new Date(sentMs).toISOString() })),
    ).toEqual({ fire: false, reason: 'too_old' })
  })
})

describe('shouldSendFollowup2h — customer reply gate', () => {
  it('inbound AFTER sent_at returns skip:customer_replied', () => {
    const sentMs = NOW - 3 * 60 * 60 * 1000
    const replyMs = sentMs + 5 * 60 * 1000 // 5 min after delivery
    expect(
      shouldSendFollowup2h(
        baseRipe({
          sentAt: new Date(sentMs).toISOString(),
          lastCustomerInboundAt: new Date(replyMs).toISOString(),
        }),
      ),
    ).toEqual({ fire: false, reason: 'customer_replied' })
  })

  it('inbound BEFORE sent_at (legacy thread chatter) is ignored — still ripe', () => {
    const sentMs = NOW - 3 * 60 * 60 * 1000
    const oldChatterMs = sentMs - 7 * 24 * 60 * 60 * 1000 // a week before this quote
    expect(
      shouldSendFollowup2h(
        baseRipe({
          sentAt: new Date(sentMs).toISOString(),
          lastCustomerInboundAt: new Date(oldChatterMs).toISOString(),
        }),
      ),
    ).toEqual({ fire: true, reason: 'ripe' })
  })

  it('inbound equal to sent_at counts as replied (>= guard)', () => {
    const sentIso = new Date(NOW - 3 * 60 * 60 * 1000).toISOString()
    expect(
      shouldSendFollowup2h(
        baseRipe({ sentAt: sentIso, lastCustomerInboundAt: sentIso }),
      ),
    ).toEqual({ fire: false, reason: 'customer_replied' })
  })

  it('lastCustomerInboundAt null with all other gates green is ripe', () => {
    expect(shouldSendFollowup2h(baseRipe({ lastCustomerInboundAt: null }))).toEqual({
      fire: true,
      reason: 'ripe',
    })
  })
})

describe('shouldSendFollowup2h — defensive parsing', () => {
  it('unparseable sent_at returns skip:not_sent', () => {
    expect(shouldSendFollowup2h(baseRipe({ sentAt: 'not-a-date' }))).toEqual({
      fire: false,
      reason: 'not_sent',
    })
  })

  it('unparseable lastCustomerInboundAt is ignored (treated as no reply)', () => {
    expect(
      shouldSendFollowup2h(
        baseRipe({ lastCustomerInboundAt: 'garbage-timestamp' }),
      ),
    ).toEqual({ fire: true, reason: 'ripe' })
  })
})

describe('shouldSendFollowup2h — per-quote independence', () => {
  // Per the feature brief: a single customer with 5 quotes receives 5
  // separate check-ins. The module is per-quote — assert two quotes
  // for the "same customer" (modelled here as same input shape) are
  // evaluated independently: one already_sent does NOT block the other.
  it('two quotes for the same customer: already_sent on one does not block the other', () => {
    const quoteA = baseRipe({
      followup2hSentAt: new Date(NOW - 60_000).toISOString(),
    })
    const quoteB = baseRipe({ followup2hSentAt: null })
    expect(shouldSendFollowup2h(quoteA)).toEqual({
      fire: false,
      reason: 'already_sent',
    })
    expect(shouldSendFollowup2h(quoteB)).toEqual({ fire: true, reason: 'ripe' })
  })
})
