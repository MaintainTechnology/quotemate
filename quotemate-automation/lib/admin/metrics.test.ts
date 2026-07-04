import { describe, expect, it } from 'vitest'
import {
  buildMetrics,
  computeChannelSplit,
  computeScorecard,
  computeTenantUsage,
  isTestTenant,
  sydneyWeekStart,
  type CallRow,
  type CustomerRow,
  type IntakeRow,
  type MetricsInput,
  type QuoteRow,
  type SmsConversationRow,
  type TenantRow,
} from './metrics'

// now = Fri 3 Jul 2026, 12:00 Sydney (AEST, UTC+10). The current week starts
// Monday 29 Jun; the previous week starts Monday 22 Jun.
const NOW = new Date('2026-07-03T02:00:00Z')

function tenant(over: Partial<TenantRow> & { id: string }): TenantRow {
  return {
    business_name: 'Biz',
    owner_email: 'owner@example.com.au',
    trade: 'electrical',
    trades: ['electrical'],
    status: 'active',
    subscription_plan: null,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

function fixture(): MetricsInput {
  const tenants: TenantRow[] = [
    tenant({ id: 't1', business_name: 'Sparky Co', owner_email: 'jo@sparky.com.au', created_at: '2026-06-30T00:00:00Z' }),
    tenant({ id: 't2', business_name: 'Plumb Right', owner_email: 'a@plumb.com.au', trade: 'plumbing', trades: ['plumbing'], created_at: '2026-05-01T00:00:00Z' }),
    tenant({ id: 't3', business_name: 'Pilot Sparky', owner_email: 'sparky@quotemate.dev', created_at: '2026-01-01T00:00:00Z' }),
  ]
  const intakes: IntakeRow[] = [
    { id: 'i1', tenant_id: 't1', created_at: '2026-06-30T00:00:00Z', call_id: 'call1', customer_id: 'cust1', job_type: 'downlights' },
    { id: 'i2', tenant_id: 't1', created_at: '2026-07-01T00:00:00Z', call_id: null, customer_id: 'cust2', job_type: 'gpo' },
    { id: 'i3', tenant_id: 't1', created_at: '2026-06-24T00:00:00Z', call_id: null, customer_id: 'cust1', job_type: 'fan' },
    { id: 'i4', tenant_id: 't2', created_at: '2026-06-23T00:00:00Z', call_id: null, customer_id: 'cust3', job_type: 'tap' },
    { id: 'i5', tenant_id: 't3', created_at: '2026-06-30T00:00:00Z', call_id: 'call5', customer_id: 'cust9', job_type: 'downlights' },
    { id: 'i6', tenant_id: null, created_at: '2026-06-30T00:00:00Z', call_id: null, customer_id: null, job_type: null },
  ]
  const quotes: QuoteRow[] = [
    { id: 'q1', tenant_id: 't1', intake_id: 'i1', created_at: '2026-06-30T05:00:00Z', sent_at: '2026-06-30T06:00:00Z', accepted_at: null, paid_at: null, status: 'sent' },
    { id: 'q2', tenant_id: 't1', intake_id: 'i2', created_at: '2026-07-01T02:00:00Z', sent_at: '2026-07-01T03:00:00Z', accepted_at: '2026-07-02T00:00:00Z', paid_at: null, status: 'accepted' },
    { id: 'q3', tenant_id: 't2', intake_id: 'i4', created_at: '2026-06-23T02:00:00Z', sent_at: null, accepted_at: null, paid_at: null, status: 'draft' },
    { id: 'q4', tenant_id: null, intake_id: null, created_at: '2026-06-30T00:00:00Z', sent_at: null, accepted_at: null, paid_at: null, status: 'draft' },
    { id: 'q5', tenant_id: 't3', intake_id: 'i5', created_at: '2026-06-30T00:00:00Z', sent_at: null, accepted_at: null, paid_at: null, status: 'draft' },
  ]
  const calls: CallRow[] = [
    { id: 'call1', tenant_id: 't1', created_at: '2026-06-30T00:00:00Z' },
    { id: 'callX', tenant_id: null, created_at: '2026-06-30T00:00:00Z' },
  ]
  const customers: CustomerRow[] = []
  const smsConversations: SmsConversationRow[] = [
    { id: 's1', tenant_id: 't1', intake_id: 'i2', created_at: '2026-07-01T00:00:00Z', conversation_type: 'customer_quote' },
  ]
  return { tenants, quotes, intakes, calls, customers, smsConversations }
}

describe('sydneyWeekStart', () => {
  it('returns the Monday of the Sydney-local week', () => {
    expect(sydneyWeekStart(new Date('2026-07-03T02:00:00Z'))).toBe('2026-06-29')
    expect(sydneyWeekStart(new Date('2026-06-29T00:00:00Z'))).toBe('2026-06-29')
    expect(sydneyWeekStart(new Date('2026-06-22T12:00:00Z'))).toBe('2026-06-22')
  })
  it('keeps a late-UTC Sunday in the correct Sydney week', () => {
    // 2026-06-28T20:00Z is Mon 29 Jun 06:00 in Sydney → new week.
    expect(sydneyWeekStart(new Date('2026-06-28T20:00:00Z'))).toBe('2026-06-29')
  })
  it('buckets correctly across both DST boundaries', () => {
    // Autumn fall-back: Sun 5 Apr 2026 (AEDT→AEST) → week of Mon 30 Mar.
    expect(sydneyWeekStart(new Date('2026-04-05T02:00:00Z'))).toBe('2026-03-30')
    expect(sydneyWeekStart(new Date('2026-04-06T02:00:00Z'))).toBe('2026-04-06')
    // Spring forward: Sun 4 Oct 2026 (AEST→AEDT) → week of Mon 28 Sep.
    expect(sydneyWeekStart(new Date('2026-10-04T02:00:00Z'))).toBe('2026-09-28')
    expect(sydneyWeekStart(new Date('2026-10-05T02:00:00Z'))).toBe('2026-10-05')
  })
})

describe('acceptance rate is bounded by sent', () => {
  const q = (over: Partial<QuoteRow> & { id: string }): QuoteRow => ({
    tenant_id: 't',
    intake_id: null,
    created_at: '2026-06-30T00:00:00Z',
    sent_at: null,
    accepted_at: null,
    paid_at: null,
    status: 'draft',
    ...over,
  })
  it('excludes accepted-but-never-sent quotes, staying ≤100%', () => {
    const quotes = [
      q({ id: 'a', sent_at: '2026-06-30T00:00:00Z' }), // sent, not accepted
      q({ id: 'b', accepted_at: '2026-07-01T00:00:00Z' }), // accepted, never sent
    ]
    const s = computeScorecard({ quotes, intakes: [], tenants: [] }, NOW)
    expect(s.sentCount).toBe(1)
    expect(s.acceptedCount).toBe(0)
    expect(s.acceptanceRatePct).toBe(0)
  })
  it('counts an accepted+sent quote as 100%', () => {
    const quotes = [
      q({ id: 'a', sent_at: '2026-06-30T00:00:00Z', accepted_at: '2026-07-01T00:00:00Z' }),
    ]
    const s = computeScorecard({ quotes, intakes: [], tenants: [] }, NOW)
    expect(s.acceptanceRatePct).toBe(100)
  })
})

describe('isTestTenant', () => {
  it('flags @quotemate.dev pilots', () => {
    expect(isTestTenant(tenant({ id: 'x', owner_email: 'sparky@quotemate.dev' }))).toBe(true)
  })
  it('flags Pilot/Test/Demo business names', () => {
    expect(isTestTenant(tenant({ id: 'x', owner_email: 'r@real.com', business_name: 'Demo Electric' }))).toBe(true)
  })
  it('treats a normal tenant as real', () => {
    expect(isTestTenant(tenant({ id: 'x', owner_email: 'jo@sparky.com.au', business_name: 'Sparky Co' }))).toBe(false)
  })
})

describe('buildMetrics (real only)', () => {
  const m = buildMetrics(fixture(), { now: NOW, weeks: 4, includeTest: false })

  it('counts real vs test tenants and unattributed rows', () => {
    expect(m.realTenantCount).toBe(2)
    expect(m.testTenantCount).toBe(1)
    expect(m.unattributedRows).toBe(2) // q4 + i6
  })

  it('computes the weekly scorecard', () => {
    expect(m.scorecard.activeTradies).toBe(1) // only t1 active this week
    expect(m.scorecard.newSignups).toBe(1) // t1 joined this week; t3 is a pilot
    expect(m.scorecard.requestsThisWeek).toBe(2)
    expect(m.scorecard.requestsLastWeek).toBe(2)
    expect(m.scorecard.requestsWoWDelta).toBe(0)
    expect(m.scorecard.avgTurnaroundHours).toBe(3.5) // (5h + 2h) / 2
    expect(m.scorecard.sentCount).toBe(2)
    expect(m.scorecard.acceptedCount).toBe(1)
    expect(m.scorecard.acceptanceRatePct).toBe(50)
    expect(m.scorecard.repeatUsagePct).toBe(50) // t1 retained of {t1,t2}
  })

  it('computes activity totals (excluding pilots + unattributed)', () => {
    expect(m.activity.totalQuotes).toBe(3)
    expect(m.activity.totalIntakes).toBe(4)
    expect(m.activity.uniqueConsumers).toBe(3) // cust1, cust2, cust3
    expect(m.activity.totalCalls).toBe(1)
    expect(m.activity.totalSmsConversations).toBe(1)
    expect(m.activity.totalTradies).toBe(2)
  })

  it('splits intakes by channel and quotes by trade', () => {
    expect(m.channelSplit).toEqual([
      { key: 'voice', label: 'Voice', count: 1 },
      { key: 'sms', label: 'SMS', count: 1 },
      { key: 'portal', label: 'Portal', count: 2 },
    ])
    expect(m.tradeSplit).toEqual([
      { key: 'electrical', label: 'Electrical', count: 2 },
      { key: 'plumbing', label: 'Plumbing', count: 1 },
    ])
  })

  it('builds a weekly trend of the requested length', () => {
    expect(m.trends).toHaveLength(4)
    const last = m.trends[3]
    expect(last).toMatchObject({ weekStart: '2026-06-29', quotes: 2, intakes: 2, signups: 1 })
    const prev = m.trends[2]
    expect(prev).toMatchObject({ weekStart: '2026-06-22', quotes: 1, intakes: 2, signups: 0 })
  })

  it('ranks tenant usage by total quotes', () => {
    expect(m.tenants.map((t) => t.id)).toEqual(['t1', 't2'])
    const t1 = m.tenants[0]
    expect(t1).toMatchObject({ quotesTotal: 2, quotes7d: 2, uniqueConsumers: 2, status: 'active' })
    expect(m.tenants[1]).toMatchObject({ id: 't2', quotesTotal: 1, quotes7d: 0 })
  })
})

describe('buildMetrics (include test)', () => {
  it('includes pilot tenants when asked', () => {
    const m = buildMetrics(fixture(), { now: NOW, weeks: 4, includeTest: true })
    expect(m.activity.totalTradies).toBe(3)
    expect(m.activity.totalIntakes).toBe(5) // + the pilot intake i5
    expect(m.scorecard.activeTradies).toBe(2) // t1 + pilot t3 both active this week
  })
})

describe('buildMetrics (empty input)', () => {
  it('produces no NaN/Infinity and a full-length trend', () => {
    const empty: MetricsInput = {
      tenants: [], quotes: [], intakes: [], calls: [], customers: [], smsConversations: [],
    }
    const m = buildMetrics(empty, { now: NOW, weeks: 8, includeTest: false })
    expect(m.scorecard.activeTradies).toBe(0)
    expect(m.scorecard.avgTurnaroundHours).toBeNull()
    expect(m.scorecard.acceptanceRatePct).toBeNull()
    expect(m.scorecard.repeatUsagePct).toBeNull()
    expect(m.activity.totalQuotes).toBe(0)
    expect(m.trends).toHaveLength(8)
    expect(m.trends.every((p) => p.quotes === 0 && p.intakes === 0)).toBe(true)
    expect(m.tenants).toEqual([])
    expect(m.tradeSplit).toEqual([])
  })
})

describe('computeTenantUsage status', () => {
  it('classifies new / active / dormant', () => {
    const tenants: TenantRow[] = [
      tenant({ id: 'new', business_name: 'New Co', created_at: '2026-07-01T00:00:00Z' }),
      tenant({ id: 'act', business_name: 'Active Co', created_at: '2026-01-01T00:00:00Z' }),
      tenant({ id: 'dorm', business_name: 'Dormant Co', created_at: '2026-01-01T00:00:00Z' }),
    ]
    const intakes: IntakeRow[] = [
      { id: 'a1', tenant_id: 'act', created_at: '2026-07-02T00:00:00Z', call_id: null, customer_id: 'c', job_type: 'x' },
      { id: 'd1', tenant_id: 'dorm', created_at: '2026-05-01T00:00:00Z', call_id: null, customer_id: 'c', job_type: 'x' },
    ]
    const rows = computeTenantUsage(tenants, [], intakes, NOW)
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.status]))
    expect(byId.new).toBe('new')
    expect(byId.act).toBe('active')
    expect(byId.dorm).toBe('dormant')
  })
})

describe('computeChannelSplit', () => {
  it('prefers voice, then sms-linked, then portal', () => {
    const intakes: IntakeRow[] = [
      { id: 'v', tenant_id: 't', created_at: null, call_id: 'c', customer_id: null, job_type: null },
      { id: 's', tenant_id: 't', created_at: null, call_id: null, customer_id: null, job_type: null },
      { id: 'p', tenant_id: 't', created_at: null, call_id: null, customer_id: null, job_type: null },
    ]
    const sms: SmsConversationRow[] = [
      { id: 'sc', tenant_id: 't', intake_id: 's', created_at: null, conversation_type: 'customer_quote' },
    ]
    expect(computeChannelSplit(intakes, sms)).toEqual([
      { key: 'voice', label: 'Voice', count: 1 },
      { key: 'sms', label: 'SMS', count: 1 },
      { key: 'portal', label: 'Portal', count: 1 },
    ])
  })
})
