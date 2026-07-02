// Follow-ups tab filter/search — locks in category derivation, category
// matching, and free-text search (incl. the follow-up code = share token).

import { describe, expect, it } from 'vitest'
import {
  ALL_CATEGORY,
  UNCATEGORISED,
  filterFollowups,
  followupCategoryLabel,
  followupCategoryOptions,
  followupCategoryValue,
  followupMatchesCategory,
  followupMatchesQuery,
  type FollowupFilterItem,
} from './followup-filter'

function item(over: Omit<Partial<FollowupFilterItem>, 'customer'> & {
  customer?: Partial<FollowupFilterItem['customer']>
} = {}): FollowupFilterItem {
  const { customer, ...rest } = over
  return {
    job_type: 'downlights',
    share_token: 'tok_abc',
    quote_id: 'q-1',
    customer: {
      first_name: 'Jane',
      full_name: 'Jane Smith',
      phone: '+61 412 345 678',
      suburb: 'Bondi',
      email: 'jane@example.com',
      ...customer,
    },
    ...rest,
  }
}

describe('followupCategoryValue / Label', () => {
  it('lower-cases the job type and buckets the empty ones', () => {
    expect(followupCategoryValue('Hot_Water')).toBe('hot_water')
    expect(followupCategoryValue(null)).toBe(UNCATEGORISED)
    expect(followupCategoryValue('   ')).toBe(UNCATEGORISED)
  })
  it('labels values for the dropdown', () => {
    expect(followupCategoryLabel(ALL_CATEGORY)).toBe('All categories')
    expect(followupCategoryLabel(UNCATEGORISED)).toBe('Uncategorised')
    expect(followupCategoryLabel('hot_water')).toBe('Hot Water')
  })
})

describe('followupCategoryOptions', () => {
  it('leads with All (total count) then distinct job types, most-common first', () => {
    const opts = followupCategoryOptions([
      item({ job_type: 'downlights' }),
      item({ job_type: 'downlights' }),
      item({ job_type: 'hot_water' }),
      item({ job_type: null }),
    ])
    expect(opts[0]).toEqual({ value: ALL_CATEGORY, label: 'All categories', count: 4 })
    expect(opts.slice(1)).toEqual([
      { value: 'downlights', label: 'Downlights', count: 2 },
      { value: 'hot_water', label: 'Hot Water', count: 1 },
      { value: UNCATEGORISED, label: 'Uncategorised', count: 1 },
    ])
  })
  it('is just the All option for an empty queue', () => {
    expect(followupCategoryOptions([])).toEqual([
      { value: ALL_CATEGORY, label: 'All categories', count: 0 },
    ])
  })
})

describe('followupMatchesCategory', () => {
  it('All matches everything', () => {
    expect(followupMatchesCategory(item({ job_type: 'anything' }), ALL_CATEGORY)).toBe(true)
    expect(followupMatchesCategory(item(), '')).toBe(true)
  })
  it('matches a specific job type and the uncategorised bucket', () => {
    expect(followupMatchesCategory(item({ job_type: 'Hot_Water' }), 'hot_water')).toBe(true)
    expect(followupMatchesCategory(item({ job_type: 'downlights' }), 'hot_water')).toBe(false)
    expect(followupMatchesCategory(item({ job_type: null }), UNCATEGORISED)).toBe(true)
  })
})

describe('followupMatchesQuery', () => {
  it('empty / whitespace query matches everything', () => {
    expect(followupMatchesQuery(item(), '')).toBe(true)
    expect(followupMatchesQuery(item(), '   ')).toBe(true)
  })
  it('finds by the follow-up code (share token) and quote id', () => {
    expect(followupMatchesQuery(item({ share_token: 'ZX9-42' }), 'zx9-42')).toBe(true)
    expect(followupMatchesQuery(item({ quote_id: 'q-777' }), 'q-777')).toBe(true)
  })
  it('finds by name, suburb and job label, case-insensitively', () => {
    expect(followupMatchesQuery(item(), 'jane')).toBe(true)
    expect(followupMatchesQuery(item(), 'BONDI')).toBe(true)
    expect(followupMatchesQuery(item({ job_type: 'hot_water' }), 'hot water')).toBe(true)
  })
  it('finds by phone in AU local or E.164 digit form regardless of stored formatting', () => {
    // Stored E.164; a VA types the mobile the way Australians write it (04…).
    expect(followupMatchesQuery(item({ customer: { phone: '+61 412 345 678' } }), '0412345')).toBe(true)
    expect(followupMatchesQuery(item({ customer: { phone: '+61 412 345 678' } }), '412345')).toBe(true)
  })
  it('returns false when nothing matches', () => {
    expect(followupMatchesQuery(item(), 'nonexistent-xyz')).toBe(false)
  })
  it('tolerates all-null customer fields', () => {
    const bare = item({
      share_token: null,
      quote_id: null,
      job_type: null,
      customer: { first_name: null, full_name: null, phone: null, suburb: null, email: null },
    })
    expect(followupMatchesQuery(bare, 'anything')).toBe(false)
    expect(followupMatchesQuery(bare, '')).toBe(true)
  })
})

describe('filterFollowups', () => {
  const rows = [
    item({ job_type: 'downlights', share_token: 'a1', customer: { full_name: 'Alice Ng' } }),
    item({ job_type: 'hot_water', share_token: 'b2', customer: { full_name: 'Bob Lee' } }),
    item({ job_type: 'downlights', share_token: 'c3', customer: { full_name: 'Cara Poe' } }),
  ]
  it('defaults to no filtering', () => {
    expect(filterFollowups(rows, {})).toHaveLength(3)
  })
  it('filters by category, preserving order', () => {
    const out = filterFollowups(rows, { category: 'downlights' })
    expect(out.map((r) => r.share_token)).toEqual(['a1', 'c3'])
  })
  it('applies category AND search together', () => {
    expect(filterFollowups(rows, { category: 'downlights', query: 'cara' }).map((r) => r.share_token)).toEqual(['c3'])
    expect(filterFollowups(rows, { category: 'hot_water', query: 'cara' })).toHaveLength(0)
  })
  it('searches the code across all categories', () => {
    expect(filterFollowups(rows, { query: 'b2' }).map((r) => r.share_token)).toEqual(['b2'])
  })
})
