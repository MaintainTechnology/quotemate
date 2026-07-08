// Pure render-decision helpers for the Quotes tab "Saved jobs" section
// (spec quotes-tab-sync A2): which SavedJobsSection variant a QuotesTab
// mount renders — all-trades on the cross-trade workspace, `only` inside
// a mapped trade hub, nothing for trades with no saved-jobs table.

import { describe, it, expect } from 'vitest'
import { savedJobTradeKey, savedJobsMode } from './saved-jobs-mode'

describe('savedJobTradeKey', () => {
  it('maps hub slugs to their saved-jobs TradeKey', () => {
    expect(savedJobTradeKey('roofing')).toBe('roofing')
    expect(savedJobTradeKey('solar')).toBe('solar')
    expect(savedJobTradeKey('painting')).toBe('painting')
    expect(savedJobTradeKey('commercial_painting')).toBe('commercial-painting')
    expect(savedJobTradeKey('commercial-painting')).toBe('commercial-painting')
  })

  it('maps the aircon hub to its saved-jobs key', () => {
    expect(savedJobTradeKey('aircon')).toBe('aircon')
  })

  it('returns null for trades with no saved-jobs table', () => {
    expect(savedJobTradeKey('electrical')).toBeNull()
    expect(savedJobTradeKey('plumbing')).toBeNull()
    expect(savedJobTradeKey('signage')).toBeNull()
  })
})

describe('savedJobsMode', () => {
  it("no tradeFilter (cross-trade workspace) → 'all'", () => {
    expect(savedJobsMode(undefined)).toBe('all')
    expect(savedJobsMode('')).toBe('all')
  })

  it('mapped hub slug → its TradeKey', () => {
    expect(savedJobsMode('roofing')).toBe('roofing')
    expect(savedJobsMode('commercial_painting')).toBe('commercial-painting')
    expect(savedJobsMode('aircon')).toBe('aircon')
  })

  it('unmapped trade → null (no saved-jobs section)', () => {
    expect(savedJobsMode('electrical')).toBeNull()
  })
})
