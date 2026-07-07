import { describe, expect, it } from 'vitest'
import {
  buildTradieAnalytics,
  humanizeJobType,
  type TradieAnalyticsInput,
} from './tradie-analytics'

// now = Fri 3 Jul 2026, 12:00 Sydney (AEST). Current week starts Mon 29 Jun.
const NOW = new Date('2026-07-03T02:00:00Z')

function fixture(): TradieAnalyticsInput {
  return {
    quotes: [
      { id: 'q1', tenant_id: 't', intake_id: 'i1', created_at: '2026-06-30T05:00:00Z', sent_at: '2026-06-30T06:00:00Z', accepted_at: null, paid_at: null, status: 'sent', total_inc_gst: 300, needs_inspection: false },
      { id: 'q2', tenant_id: 't', intake_id: 'i2', created_at: '2026-07-01T02:00:00Z', sent_at: '2026-07-01T03:00:00Z', accepted_at: '2026-07-02T00:00:00Z', paid_at: null, status: 'accepted', total_inc_gst: 500, needs_inspection: false },
      { id: 'q3', tenant_id: 't', intake_id: 'i3', created_at: '2026-06-24T01:00:00Z', sent_at: null, accepted_at: null, paid_at: null, status: 'draft', total_inc_gst: null, needs_inspection: true },
    ],
    intakes: [
      { id: 'i1', tenant_id: 't', created_at: '2026-06-30T00:00:00Z', call_id: 'c1', customer_id: 'cu1', job_type: 'hot_water' },
      { id: 'i2', tenant_id: 't', created_at: '2026-07-01T00:00:00Z', call_id: null, customer_id: 'cu2', job_type: 'downlights' },
      { id: 'i3', tenant_id: 't', created_at: '2026-06-24T00:00:00Z', call_id: null, customer_id: 'cu1', job_type: 'downlights' },
    ],
    calls: [
      { id: 'call1', tenant_id: 't', created_at: '2026-06-30T00:00:00Z', caller_number: '+61411111111' },
      { id: 'call2', tenant_id: 't', created_at: '2026-06-29T00:00:00Z', caller_number: '+61411111111' },
      { id: 'call3', tenant_id: 't', created_at: '2026-06-28T00:00:00Z', caller_number: '+61422222222' },
    ],
    sms: [
      { id: 's1', tenant_id: 't', intake_id: 'i2', created_at: '2026-07-01T00:00:00Z', conversation_type: 'customer_quote', from_number: '+61433333333', status: 'done' },
      { id: 's2', tenant_id: 't', intake_id: null, created_at: '2026-06-20T00:00:00Z', conversation_type: 'customer_quote', from_number: '+61433333333', status: 'abandoned' },
      { id: 's3', tenant_id: 't', intake_id: null, created_at: '2026-07-02T00:00:00Z', conversation_type: 'customer_quote', from_number: '+61444444444', status: 'open' },
      { id: 's4', tenant_id: 't', intake_id: null, created_at: '2026-07-01T00:00:00Z', conversation_type: 'tradie_registration', from_number: '+61999999999', status: 'done' },
    ],
    customers: [],
  }
}

describe('humanizeJobType', () => {
  it('turns snake_case into a readable label', () => {
    expect(humanizeJobType('hot_water')).toBe('Hot water')
    expect(humanizeJobType('power-points')).toBe('Power points')
    expect(humanizeJobType('downlights')).toBe('Downlights')
  })
})

describe('buildTradieAnalytics', () => {
  const a = buildTradieAnalytics(fixture(), { now: NOW, weeks: 4 })

  it('counts distinct texters/callers separately from totals', () => {
    expect(a.headline.peopleTexting).toBe(2) // two distinct from_numbers (customer chats only)
    expect(a.headline.peopleCalling).toBe(2) // two distinct caller_numbers across 3 calls
    expect(a.headline.totalChats).toBe(3) // tradie_registration excluded
    expect(a.headline.totalCalls).toBe(3)
    expect(a.headline.totalRequests).toBe(3)
    expect(a.headline.totalQuotes).toBe(3)
    expect(a.headline.processedQuotes).toBe(2) // q1+q2 priced; q3 inspection-only excluded
    expect(a.headline.uniqueCustomers).toBe(2) // cu1, cu2
  })

  it('surfaces the actionable items', () => {
    expect(a.needsAttention.awaitingReview).toBe(1) // q3 drafted
    expect(a.needsAttention.coldChats).toBe(1) // s2 abandoned
    expect(a.needsAttention.inspectionsToBook).toBe(1) // q3 needs_inspection
  })

  it('reports median speed-to-quote in minutes', () => {
    // deltas: q1 300m, q2 120m, q3 60m → median 120
    expect(a.speedToQuoteMinutes).toBe(120)
  })

  it('builds the lead funnel', () => {
    expect(a.funnel).toEqual([
      { label: 'Requests', count: 3 },
      { label: 'Quotes', count: 3 },
      { label: 'Sent', count: 2 },
      { label: 'Accepted', count: 1 },
    ])
  })

  it('splits channel and ranks job types', () => {
    expect(a.channelSplit).toEqual([
      { key: 'voice', label: 'Voice', count: 1 },
      { key: 'sms', label: 'SMS', count: 1 },
      { key: 'portal', label: 'Portal', count: 1 },
    ])
    expect(a.topJobTypes).toEqual([
      { label: 'Downlights', count: 2 },
      { label: 'Hot water', count: 1 },
    ])
  })

  it('returns a weekly trend of the requested length', () => {
    expect(a.weeklyTrend).toHaveLength(4)
    expect(a.weeklyTrend[3]).toMatchObject({ weekStart: '2026-06-29', quotes: 2, intakes: 2 })
  })
})

describe('lead funnel stays monotonic under Path B', () => {
  it('folds accepted/paid into Sent so Accepted never exceeds Sent', () => {
    // Two quotes accepted/paid WITHOUT sent_at ever being stamped (Path B).
    const input: TradieAnalyticsInput = {
      quotes: [
        { id: 'a', tenant_id: 't', intake_id: null, created_at: '2026-06-30T00:00:00Z', sent_at: null, accepted_at: '2026-07-01T00:00:00Z', paid_at: null, status: 'accepted', total_inc_gst: 400, needs_inspection: false },
        { id: 'b', tenant_id: 't', intake_id: null, created_at: '2026-06-30T00:00:00Z', sent_at: null, accepted_at: null, paid_at: '2026-07-01T00:00:00Z', status: 'paid', total_inc_gst: 400, needs_inspection: false },
      ],
      intakes: [], calls: [], sms: [], customers: [],
    }
    const a = buildTradieAnalytics(input, { now: NOW, weeks: 4 })
    const sent = a.funnel.find((s) => s.label === 'Sent')!.count
    const accepted = a.funnel.find((s) => s.label === 'Accepted')!.count
    expect(accepted).toBe(2)
    expect(sent).toBeGreaterThanOrEqual(accepted)
    expect(sent).toBe(2)
  })
})

describe('awaitingReview matches the app canonical review set', () => {
  it("counts 'draft' and a null status (production reality), not 'sent'", () => {
    const q = (id: string, status: string | null) => ({
      id, tenant_id: 't', intake_id: null, created_at: '2026-06-30T00:00:00Z',
      sent_at: null, accepted_at: null, paid_at: null, status,
      total_inc_gst: null, needs_inspection: false,
    })
    const input: TradieAnalyticsInput = {
      quotes: [q('a', 'draft'), q('b', null), q('c', 'sent'), q('d', 'awaiting_review')],
      intakes: [], calls: [], sms: [], customers: [],
    }
    const a = buildTradieAnalytics(input, { now: NOW, weeks: 4 })
    expect(a.needsAttention.awaitingReview).toBe(3)
  })
})

describe('buildTradieAnalytics (period window)', () => {
  // Window to 1–3 Jul 2026 (as absolute instants): of the fixture only
  // q2 / i2 / s1 / s3 land inside.
  const w = buildTradieAnalytics(fixture(), {
    now: NOW,
    weeks: 4,
    from: '2026-07-01T00:00:00Z',
    to: '2026-07-03T23:59:59Z',
  })

  it('scopes headline counters to the window', () => {
    expect(w.headline.totalQuotes).toBe(1) // q2 only (q1 30-Jun, q3 24-Jun out)
    expect(w.headline.totalRequests).toBe(1) // i2 only
    expect(w.headline.totalCalls).toBe(0) // all calls fall before 1 Jul
    expect(w.headline.totalChats).toBe(2) // s1 + s3 (s2 20-Jun out, s4 registration)
    expect(w.headline.processedQuotes).toBe(1) // q2 priced, not inspection
    expect(w.headline.uniqueCustomers).toBe(1) // cu2 via i2
  })

  it('scopes funnel + actionables to the window', () => {
    expect(w.funnel).toEqual([
      { label: 'Requests', count: 1 },
      { label: 'Quotes', count: 1 },
      { label: 'Sent', count: 1 },
      { label: 'Accepted', count: 1 },
    ])
    expect(w.needsAttention.awaitingReview).toBe(0) // q3 (drafted) is out of window
    expect(w.topJobTypes).toEqual([{ label: 'Downlights', count: 1 }])
  })

  it('still pairs speed-to-quote using intakes outside the window', () => {
    expect(w.speedToQuoteMinutes).toBe(120) // q2 (in window) ↔ i2
  })

  it('leaves the rolling weekly trend period-independent', () => {
    // The trend reads the UNwindowed inputs — identical to the all-time run.
    expect(w.weeklyTrend).toHaveLength(4)
    expect(w.weeklyTrend[3]).toMatchObject({
      weekStart: '2026-06-29',
      quotes: 2,
      intakes: 2,
    })
  })
})

describe('buildTradieAnalytics (empty)', () => {
  it('produces no NaN/undefined on an empty account', () => {
    const empty: TradieAnalyticsInput = {
      quotes: [], intakes: [], calls: [], sms: [], customers: [],
    }
    const a = buildTradieAnalytics(empty, { now: NOW, weeks: 8 })
    expect(a.headline.peopleTexting).toBe(0)
    expect(a.headline.uniqueCustomers).toBe(0)
    expect(a.speedToQuoteMinutes).toBeNull()
    expect(a.funnel.every((s) => s.count === 0)).toBe(true)
    expect(a.topJobTypes).toEqual([])
    expect(a.weeklyTrend).toHaveLength(8)
  })
})
