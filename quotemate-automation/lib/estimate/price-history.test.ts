// WP2 historical-pricing (safe slice) — the summariser is the only
// logic that decides what the advisory hint says. It must compute a
// correct band, stay silent on thin data (cold-start), and never throw.

import { describe, expect, it } from 'vitest'
import {
  summarisePriceHistory,
  formatPriceHistoryHint,
  type PastQuoteTiers,
} from './price-history'

const q = (g: number | null, b: number | null, bx: number | null): PastQuoteTiers => ({
  good: g,
  better: b,
  best: bx,
})

describe('summarisePriceHistory', () => {
  it('computes min / median / max per tier from past quotes', () => {
    const past = [q(100, 200, 300), q(120, 220, 360), q(140, 240, 330)]
    const s = summarisePriceHistory(past, 'tap_replace')!
    const good = s.bands.find((x) => x.tier === 'good')!
    expect(good.count).toBe(3)
    expect(good.min).toBe(100)
    expect(good.median).toBe(120)
    expect(good.max).toBe(140)
    const best = s.bands.find((x) => x.tier === 'best')!
    expect(best.median).toBe(330)
  })

  it('ignores null / zero / non-numeric tier values', () => {
    const past = [q(100, null, 0), q(120, null, null), q(140, '' as unknown as null, null)]
    const s = summarisePriceHistory(past, 'downlights')!
    expect(s.bands.map((b) => b.tier)).toEqual(['good']) // only good had >=3 usable
    expect(s.bands[0].count).toBe(3)
  })

  it('stays silent below the cold-start sample floor (returns null)', () => {
    expect(summarisePriceHistory([q(100, 200, 300), q(110, 210, 310)], 'tap')).toBeNull()
    expect(summarisePriceHistory([], 'tap')).toBeNull()
    expect(summarisePriceHistory([q(1, 2, 3)], '')).toBeNull()
  })

  it('even-count median is the mean of the two middles', () => {
    const past = [q(100, 0, 0), q(200, 0, 0), q(300, 0, 0), q(400, 0, 0)]
    const s = summarisePriceHistory(past, 'gpo')!
    expect(s.bands[0].median).toBe(250) // (200+300)/2
  })
})

describe('formatPriceHistoryHint', () => {
  it('produces a soft, explicitly-non-authoritative advisory', () => {
    const s = summarisePriceHistory([q(100, 200, 300), q(120, 220, 360), q(140, 240, 330)], 'tap_replace')
    const hint = formatPriceHistoryHint(s)!
    expect(hint).toMatch(/sanity check only/i)
    expect(hint).toMatch(/grounding validation still applies/i)
    expect(hint).toContain('tap replace')
    expect(hint).toMatch(/good:/)
  })
  it('is null when there is no usable summary', () => {
    expect(formatPriceHistoryHint(null)).toBeNull()
    expect(formatPriceHistoryHint(summarisePriceHistory([q(1, 1, 1)], 'x'))).toBeNull()
  })
})
