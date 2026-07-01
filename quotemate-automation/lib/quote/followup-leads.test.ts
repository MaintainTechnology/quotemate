// Regression coverage — the no-quote SMS lead selector. Locks in exactly
// which conversations become "chase this lead" rows: customer threads
// with no quote, deduped per person, oldest-first, tradie onboarding and
// already-quoted people excluded.

import { describe, expect, it } from 'vitest'
import {
  isLeadFollowup,
  leadLastActivity,
  selectLeadFollowups,
  toLeadFollowup,
  type LeadConversation,
} from './followup-leads'

const NOW = Date.parse('2026-07-01T12:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

function convo(over: Partial<LeadConversation> = {}): LeadConversation {
  return {
    id: over.id ?? 'c1',
    from_number: '+61400000001',
    conversation_type: 'customer_quote',
    intake_id: null,
    last_message_at: hoursAgo(48),
    ...over,
  }
}

describe('leadLastActivity', () => {
  it('prefers last_message_at, falls back to created_at', () => {
    expect(leadLastActivity({ id: 'x', last_message_at: 'A', created_at: 'B' })).toBe('A')
    expect(leadLastActivity({ id: 'x', created_at: 'B' })).toBe('B')
    expect(leadLastActivity({ id: 'x' })).toBeNull()
  })
})

describe('isLeadFollowup', () => {
  it('includes a customer_quote thread with no quote', () => {
    expect(isLeadFollowup(convo(), { now: NOW })).toBe(true)
  })

  it('includes a legacy NULL-type customer thread', () => {
    expect(isLeadFollowup(convo({ conversation_type: null }), { now: NOW })).toBe(true)
  })

  it('excludes tradie registration threads', () => {
    expect(
      isLeadFollowup(convo({ conversation_type: 'tradie_registration' }), { now: NOW }),
    ).toBe(false)
  })

  it('excludes conversations whose intake already has a quote', () => {
    const c = convo({ intake_id: 'intake-1' })
    expect(
      isLeadFollowup(c, { now: NOW, quotedIntakeIds: new Set(['intake-1']) }),
    ).toBe(false)
    // a different (un-quoted) intake still qualifies
    expect(
      isLeadFollowup(c, { now: NOW, quotedIntakeIds: new Set(['intake-other']) }),
    ).toBe(true)
  })

  it('excludes phones already surfaced in the quote queue', () => {
    const c = convo({ from_number: '0400 000 001' })
    expect(
      isLeadFollowup(c, { now: NOW, excludePhones: new Set(['+61400000001']) }),
    ).toBe(false)
  })

  it('respects minAgeHours', () => {
    const recent = convo({ last_message_at: hoursAgo(1) })
    expect(isLeadFollowup(recent, { now: NOW, minAgeHours: 0 })).toBe(true)
    expect(isLeadFollowup(recent, { now: NOW, minAgeHours: 24 })).toBe(false)
  })

  it('excludes rows with no parseable activity', () => {
    expect(
      isLeadFollowup({ id: 'x', from_number: '+61400000001', conversation_type: 'customer_quote' }, { now: NOW }),
    ).toBe(false)
  })
})

describe('toLeadFollowup', () => {
  it('pulls name/job/suburb out of conversation_state.slots', () => {
    const c = convo({
      conversation_state: {
        slots: { first_name: 'Jon', job_type: 'hot_water', suburb: 'Chandler' },
      },
    })
    const row = toLeadFollowup(c, NOW)
    expect(row).toMatchObject({
      conversation_id: 'c1',
      phone: '+61400000001',
      first_name: 'Jon',
      job_type: 'hot_water',
      suburb: 'Chandler',
      age_hours: 48,
    })
  })

  it('normalises the phone to E.164 and floors the age', () => {
    const row = toLeadFollowup(convo({ from_number: '0400 000 001', last_message_at: hoursAgo(50.9) }), NOW)
    expect(row.phone).toBe('+61400000001')
    expect(row.age_hours).toBe(50)
  })
})

describe('selectLeadFollowups', () => {
  it('returns oldest-activity first', () => {
    const rows = selectLeadFollowups(
      [
        convo({ id: 'new', from_number: '+61400000002', last_message_at: hoursAgo(30) }),
        convo({ id: 'old', from_number: '+61400000003', last_message_at: hoursAgo(200) }),
      ],
      { now: NOW },
    )
    expect(rows.map((r) => r.conversation_id)).toEqual(['old', 'new'])
  })

  it('dedupes multiple no-quote threads from one number, keeping the most recent', () => {
    const rows = selectLeadFollowups(
      [
        convo({ id: 'stale', from_number: '+61400000009', last_message_at: hoursAgo(300) }),
        convo({ id: 'live', from_number: '0400 000 009', last_message_at: hoursAgo(40) }),
      ],
      { now: NOW },
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].conversation_id).toBe('live')
  })

  it('drops quoted + registration + excluded rows together', () => {
    const rows = selectLeadFollowups(
      [
        convo({ id: 'lead', from_number: '+61400000001' }),
        convo({ id: 'reg', from_number: '+61400000004', conversation_type: 'tradie_registration' }),
        convo({ id: 'quoted', from_number: '+61400000005', intake_id: 'i-quoted' }),
        convo({ id: 'dupe-of-quote', from_number: '+61400000006' }),
      ],
      {
        now: NOW,
        quotedIntakeIds: new Set(['i-quoted']),
        excludePhones: new Set(['+61400000006']),
      },
    )
    expect(rows.map((r) => r.conversation_id)).toEqual(['lead'])
  })
})
