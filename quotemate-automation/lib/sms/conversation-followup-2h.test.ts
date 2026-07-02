// Pure-logic coverage for the 2-hour CONVERSATION follow-up decision
// module (migration 159) — the mid-intake companion to
// lib/quote/followup-2h.test.ts. Locks every fire/skip gate so the cron
// sweep can never nag engaged customers, double-send, text onboarding
// or closed threads, or revive dead conversations.

import { describe, expect, it } from 'vitest'
import {
  shouldSendConversationFollowup2h,
  type ConversationFollowup2hInput,
} from './conversation-followup-2h'
import {
  FOLLOWUP_2H_MIN_AGE_MS,
  FOLLOWUP_2H_MAX_AGE_MS,
} from '../quote/followup-2h'

const NOW = new Date('2026-07-01T12:00:00.000Z').getTime()

/** Build a baseline ripe input — every test starts from "would fire" and
 *  mutates one field to assert a specific skip reason. */
function baseRipe(
  overrides: Partial<ConversationFollowup2hInput> = {},
): ConversationFollowup2hInput {
  const lastMs = NOW - 3 * 60 * 60 * 1000 // 3h idle — inside [2h, 24h)
  return {
    enabledForTenant: true,
    conversationType: 'customer_quote',
    conversationStatus: 'open',
    followup2hSentAt: null,
    lastMessageAt: new Date(lastMs).toISOString(),
    lastMessageDirection: 'outbound',
    hasDeliveredQuote: false,
    currentTime: NOW,
    ...overrides,
  }
}

describe('shouldSendConversationFollowup2h — fires when ripe', () => {
  it('receptionist asked 3h ago, customer silent, tenant opted in → fire', () => {
    expect(shouldSendConversationFollowup2h(baseRipe())).toEqual({
      fire: true,
      reason: 'ripe',
    })
  })
})

describe('shouldSendConversationFollowup2h — tenant + thread-type gates', () => {
  it('disabled tenant returns skip:disabled even when everything else is ripe', () => {
    expect(
      shouldSendConversationFollowup2h(baseRipe({ enabledForTenant: false })),
    ).toEqual({ fire: false, reason: 'disabled' })
  })

  it('tradie_registration thread returns skip:wrong_type', () => {
    expect(
      shouldSendConversationFollowup2h(
        baseRipe({ conversationType: 'tradie_registration' }),
      ),
    ).toEqual({ fire: false, reason: 'wrong_type' })
  })

  it('converted thread returns skip:wrong_type', () => {
    expect(
      shouldSendConversationFollowup2h(baseRipe({ conversationType: 'converted' })),
    ).toEqual({ fire: false, reason: 'wrong_type' })
  })

  it('null conversation_type returns skip:wrong_type', () => {
    expect(
      shouldSendConversationFollowup2h(baseRipe({ conversationType: null })),
    ).toEqual({ fire: false, reason: 'wrong_type' })
  })
})

describe('shouldSendConversationFollowup2h — thread lifecycle gates', () => {
  it.each(['done', 'abandoned', 'structuring'] as const)(
    "status '%s' returns skip:not_open",
    (status) => {
      expect(
        shouldSendConversationFollowup2h(baseRipe({ conversationStatus: status })),
      ).toEqual({ fire: false, reason: 'not_open' })
    },
  )

  it('null status returns skip:not_open', () => {
    expect(
      shouldSendConversationFollowup2h(baseRipe({ conversationStatus: null })),
    ).toEqual({ fire: false, reason: 'not_open' })
  })

  it('existing followup_2h_sent_at returns skip:already_sent (one per thread, ever)', () => {
    expect(
      shouldSendConversationFollowup2h(
        baseRipe({
          followup2hSentAt: new Date(NOW - 30 * 60 * 1000).toISOString(),
        }),
      ),
    ).toEqual({ fire: false, reason: 'already_sent' })
  })

  it('thread with a delivered quote returns skip:quote_covered (quote sweep territory)', () => {
    expect(
      shouldSendConversationFollowup2h(baseRipe({ hasDeliveredQuote: true })),
    ).toEqual({ fire: false, reason: 'quote_covered' })
  })
})

describe('shouldSendConversationFollowup2h — message-trail gates', () => {
  it('null lastMessageAt returns skip:no_messages', () => {
    expect(
      shouldSendConversationFollowup2h(baseRipe({ lastMessageAt: null })),
    ).toEqual({ fire: false, reason: 'no_messages' })
  })

  it('null lastMessageDirection returns skip:no_messages', () => {
    expect(
      shouldSendConversationFollowup2h(baseRipe({ lastMessageDirection: null })),
    ).toEqual({ fire: false, reason: 'no_messages' })
  })

  it('unparseable lastMessageAt returns skip:no_messages', () => {
    expect(
      shouldSendConversationFollowup2h(baseRipe({ lastMessageAt: 'not-a-date' })),
    ).toEqual({ fire: false, reason: 'no_messages' })
  })

  it('newest message inbound returns skip:customer_engaged (ball is in OUR court)', () => {
    expect(
      shouldSendConversationFollowup2h(baseRipe({ lastMessageDirection: 'inbound' })),
    ).toEqual({ fire: false, reason: 'customer_engaged' })
  })
})

describe('shouldSendConversationFollowup2h — idle-window boundaries', () => {
  it('exactly 2h idle fires (floor is inclusive)', () => {
    const lastMs = NOW - FOLLOWUP_2H_MIN_AGE_MS
    expect(
      shouldSendConversationFollowup2h(
        baseRipe({ lastMessageAt: new Date(lastMs).toISOString() }),
      ),
    ).toEqual({ fire: true, reason: 'ripe' })
  })

  it('1ms under 2h idle returns skip:too_young', () => {
    const lastMs = NOW - FOLLOWUP_2H_MIN_AGE_MS + 1
    expect(
      shouldSendConversationFollowup2h(
        baseRipe({ lastMessageAt: new Date(lastMs).toISOString() }),
      ),
    ).toEqual({ fire: false, reason: 'too_young' })
  })

  it('exactly 24h idle returns skip:too_old (ceiling is exclusive)', () => {
    const lastMs = NOW - FOLLOWUP_2H_MAX_AGE_MS
    expect(
      shouldSendConversationFollowup2h(
        baseRipe({ lastMessageAt: new Date(lastMs).toISOString() }),
      ),
    ).toEqual({ fire: false, reason: 'too_old' })
  })

  it('1s under 24h idle fires', () => {
    const lastMs = NOW - FOLLOWUP_2H_MAX_AGE_MS + 1000
    expect(
      shouldSendConversationFollowup2h(
        baseRipe({ lastMessageAt: new Date(lastMs).toISOString() }),
      ),
    ).toEqual({ fire: true, reason: 'ripe' })
  })

  it('multi-day-old thread returns skip:too_old (never resurrect dead leads)', () => {
    const lastMs = NOW - 3 * 24 * 60 * 60 * 1000
    expect(
      shouldSendConversationFollowup2h(
        baseRipe({ lastMessageAt: new Date(lastMs).toISOString() }),
      ),
    ).toEqual({ fire: false, reason: 'too_old' })
  })
})
