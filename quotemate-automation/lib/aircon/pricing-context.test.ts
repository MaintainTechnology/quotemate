import { describe, expect, it } from 'vitest'
import {
  acPricingAuthorityMatches,
  acPricingRevision,
  loadTenantAcPricingContext,
} from './pricing-context'
import type { AcRateCard } from './types'

const CARD: AcRateCard = {
  split: {
    per_head: { '2.5': 1200, '3.5': 1500, '5': 2000, '7': 2700, '8': 3200 },
    multi_head_discount_pct: 0.05,
  },
  ducted: { rate_per_kw: 1250, base_ex_gst: 4500, per_zone: 400, min_ex_gst: 8500 },
  gst_registered: true,
}

function fakeDb(data: unknown, error: unknown = null) {
  const calls: Array<[string, unknown]> = []
  const query = {
    select(columns: string) {
      calls.push(['select', columns])
      return query
    },
    eq(column: string, value: unknown) {
      calls.push([column, value])
      return Promise.resolve({ data, error })
    },
  }
  return {
    db: { from: () => query } as never,
    calls,
  }
}

describe('tenant aircon pricing context', () => {
  it('selects the tenant primary-trade card and preserves book provenance', async () => {
    const { db, calls } = fakeDb([
      { id: 'book-aircon', trade: 'aircon', overlays: { aircon_rate_card: CARD } },
      {
        id: 'book-electrical',
        trade: 'electrical',
        overlays: { aircon_rate_card: { ...CARD, gst_registered: false } },
      },
    ])
    const context = await loadTenantAcPricingContext(db, 'tenant-1', 'electrical')
    expect(context).toMatchObject({
      rateCard: { gst_registered: false },
      authority: {
        source: 'tenant_pricing_book',
        tenant_id: 'tenant-1',
        pricing_book_id: 'book-electrical',
      },
    })
    expect(context?.authority.revision).toMatch(/^[a-f0-9]{64}$/)
    expect(calls).toContainEqual(['tenant_id', 'tenant-1'])
  })

  it('revisions are stable for key order and change with the persisted card or book', () => {
    const reordered = {
      gst_registered: true,
      ducted: { ...CARD.ducted },
      split: {
        multi_head_discount_pct: CARD.split.multi_head_discount_pct,
        per_head: { ...CARD.split.per_head },
      },
    } as AcRateCard
    expect(acPricingRevision('book-1', CARD)).toBe(acPricingRevision('book-1', reordered))
    expect(acPricingRevision('book-1', CARD)).not.toBe(
      acPricingRevision('book-1', {
        ...CARD,
        ducted: { ...CARD.ducted, per_zone: CARD.ducted.per_zone + 1 },
      }),
    )
    expect(acPricingRevision('book-1', CARD)).not.toBe(acPricingRevision('book-2', CARD))
  })

  it('rejects wrong-tenant, wrong-book, stale and missing authority on reopen', () => {
    const current = {
      rateCard: CARD,
      authority: {
        source: 'tenant_pricing_book' as const,
        tenant_id: 'tenant-1',
        pricing_book_id: 'book-1',
        revision: 'a'.repeat(64),
      },
    }
    expect(acPricingAuthorityMatches(current.authority, current, 'tenant-1')).toBe(true)
    expect(
      acPricingAuthorityMatches({ ...current.authority, tenant_id: 'tenant-2' }, current, 'tenant-1'),
    ).toBe(false)
    expect(
      acPricingAuthorityMatches(
        { ...current.authority, pricing_book_id: 'book-2' },
        current,
        'tenant-1',
      ),
    ).toBe(false)
    expect(
      acPricingAuthorityMatches({ ...current.authority, revision: 'b'.repeat(64) }, current, 'tenant-1'),
    ).toBe(false)
    expect(acPricingAuthorityMatches(current.authority, null, 'tenant-1')).toBe(false)
  })

  it.each([
    ['missing rows', []],
    ['null card', [{ id: 'book-1', trade: 'aircon', overlays: { aircon_rate_card: null } }]],
    [
      'zero rate',
      [{
        id: 'book-1', trade: 'aircon',
        overlays: { aircon_rate_card: { ...CARD, ducted: { ...CARD.ducted, per_zone: 0 } } },
      }],
    ],
    [
      'non-finite rate',
      [{
        id: 'book-1', trade: 'aircon',
        overlays: { aircon_rate_card: { ...CARD, ducted: { ...CARD.ducted, rate_per_kw: Number.NaN } } },
      }],
    ],
    [
      'partial card',
      [{ id: 'book-1', trade: 'aircon', overlays: { aircon_rate_card: { ducted: CARD.ducted } } }],
    ],
  ])('fails closed for %s', async (_label, rows) => {
    const { db } = fakeDb(rows)
    await expect(loadTenantAcPricingContext(db, 'tenant-1', 'aircon')).resolves.toBeNull()
  })

  it('fails closed on a pricing-book read error', async () => {
    const { db } = fakeDb(null, { message: 'denied' })
    await expect(loadTenantAcPricingContext(db, 'tenant-1', 'aircon')).resolves.toBeNull()
  })
})
