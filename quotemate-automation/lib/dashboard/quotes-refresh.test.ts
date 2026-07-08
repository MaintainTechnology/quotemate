// Refresh-on-return surface predicate (spec quotes-tab-sync A5): which tabs
// qualify for the background /api/tenant/me refetch. The companion 15 s
// throttle is covered in lib/dashboard/recent-activity.test.ts
// (shouldRefresh) — page.tsx composes the two.

import { describe, it, expect } from 'vitest'
import { isQuotesSurface } from './quotes-refresh'

describe('isQuotesSurface', () => {
  it('the workspace Quotes tab qualifies', () => {
    expect(isQuotesSurface('quotes')).toBe(true)
  })

  it('trade-hub tabs qualify', () => {
    expect(isQuotesSurface('hub-roofing')).toBe(true)
    expect(isQuotesSurface('hub-aircon')).toBe(true)
  })

  it('other tabs do not', () => {
    expect(isQuotesSurface('overview')).toBe(false)
    expect(isQuotesSurface('chats')).toBe(false)
    expect(isQuotesSurface('account')).toBe(false)
  })
})
