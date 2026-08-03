// Phase 5b — Good ≤ Better ≤ Best.
//
// Nothing asserted this before, and Phase 4 made it reachable. Until R3/R4 all
// three tiers were scored from one catalogue by one rule, so ordering fell out
// for free. Now three independent things each place a product in ONE tier
// without consulting the others: the customer's pick (R3), a tradie's ladder
// pin (R2), and the price-indexed shared fallback (R4). A customer picking the
// dearest product on offer, or a tradie pinning a $300 part to Good, inverts
// the ladder — and "Good $250 / Better $200" is obvious to a customer and
// invisible to every other check.
//
// SHADOW: this reports, it does not null a tier or route to inspection. An
// inverted ladder is a presentation fault, not a fabricated price, and this
// phase has already produced one bug where a correct quote was billed as a $99
// inspection. Collect the signal first.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { checkTierMonotonicity } from './sanity-bounds'

const ok = (t: Parameters<typeof checkTierMonotonicity>[0]) => checkTierMonotonicity(t).ok

describe('Phase 5b — checkTierMonotonicity', () => {
  it('passes an ascending ladder', () => {
    expect(ok({ good: 100, better: 200, best: 300 })).toBe(true)
  })

  it('fails when better undercuts good', () => {
    const r = checkTierMonotonicity({ good: 250, better: 200, best: 300 })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.failures[0]).toMatch(/better \$200\.00 < good \$250\.00/)
  })

  it('fails when best undercuts better', () => {
    const r = checkTierMonotonicity({ good: 100, better: 300, best: 200 })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.failures[0]).toMatch(/best \$200\.00 < better \$300\.00/)
  })

  it('reports BOTH inversions when the ladder is fully scrambled', () => {
    const r = checkTierMonotonicity({ good: 300, better: 200, best: 100 })
    expect(r.ok === false && r.failures).toHaveLength(2)
  })

  it('equal subtotals PASS — duplicates are collapseDuplicateTiers’ job', () => {
    // Flagging here too would give an operator two findings for one fault.
    expect(ok({ good: 200, better: 200, best: 200 })).toBe(true)
  })

  it('compares only the tiers PRESENT, so Good + Best is still checked', () => {
    // fault_finding has no best; a picked Opus-fallback quote may hold one.
    // Skipping the check for want of a middle tier would miss a real inversion.
    expect(ok({ good: 100, best: 300 })).toBe(true)
    expect(ok({ good: 300, best: 100 })).toBe(false)
  })

  it('a single tier cannot be out of order', () => {
    expect(ok({ good: 100 })).toBe(true)
    expect(ok({ better: 100 })).toBe(true)
    expect(ok({ best: 100 })).toBe(true)
    expect(ok({})).toBe(true)
  })

  it('SKIPS a missing subtotal rather than reading it as zero', () => {
    // Reading null as 0 would invent an inversion — better:0 < good:100 — and
    // put a false flag on a quote that is fine.
    expect(ok({ good: 100, better: null, best: 300 })).toBe(true)
    expect(ok({ good: 100, better: undefined, best: 300 })).toBe(true)
  })

  it('skips non-finite values for the same reason', () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, 'abc' as unknown as number]) {
      expect(ok({ good: 100, better: v, best: 300 }), String(v)).toBe(true)
    }
  })

  it('a NEGATIVE subtotal is compared, not skipped', () => {
    // -50 is finite and wrong. It must not slip through as "unknown".
    expect(ok({ good: 100, better: -50 })).toBe(false)
  })

  it('the message names the money, so an operator can act on it', () => {
    const r = checkTierMonotonicity({ good: 250.5, better: 200.25 })
    expect(r.ok === false && r.failures[0]).toContain('$200.25')
    expect(r.ok === false && r.failures[0]).toContain('$250.50')
    expect(r.ok === false && r.failures[0]).toMatch(/inverted/)
  })

  it('is pure — same input twice, same verdict', () => {
    const t = { good: 300, better: 100 }
    expect(checkTierMonotonicity(t)).toEqual(checkTierMonotonicity(t))
  })
})

// ── the wiring, which the pure tests above cannot see ───────────────────
//
// Added because a mutation proved it was missing: disabling the call in run.ts
// left the ENTIRE lib/estimate suite green. A guard nobody calls is not a
// guard, and that is the same defect R2 shipped — the tier ladder was a
// declared field the loader never set. runEstimation cannot be imported here
// (module-scope Supabase client, no env in vitest), so the wiring is asserted
// at the source level, the same idiom as tests/internal-route-auth.test.ts.
describe('Phase 5b — run.ts actually calls it', () => {
  const runTs = readFileSync(resolve(process.cwd(), 'lib', 'estimate', 'run.ts'), 'utf8')

  it('imports checkTierMonotonicity from sanity-bounds', () => {
    expect(runTs).toMatch(/checkTierMonotonicity,/)
  })

  it('calls it with all three tier subtotals', () => {
    expect(runTs).toMatch(/checkTierMonotonicity\(\{/)
    for (const t of ['good', 'better', 'best']) {
      expect(runTs, `missing ${t}`).toMatch(
        new RegExp(`${t}: draft\\?\\.${t}\\?\\.subtotal_ex_gst`),
      )
    }
  })

  it('runs AFTER collapseDuplicateTiers, so it sees the shipping subtotals', () => {
    // Before it, the check would judge pre-correction numbers and could flag a
    // quote the reconcile pass was about to fix.
    const collapse = runTs.indexOf('collapseDuplicateTiers(draft)')
    const check = runTs.indexOf('checkTierMonotonicity({')
    expect(collapse).toBeGreaterThan(-1)
    expect(check).toBeGreaterThan(collapse)
  })

  it('surfaces failures as [tier-order] risk flags', () => {
    expect(runTs).toMatch(/\[tier-order\]/)
  })

  it('is SHADOW — it must not null a tier or force inspection', () => {
    // The guarantee that makes shadow mode real. If a future edit adds tier
    // nulling or an inspection downgrade inside this block, this fails and the
    // decision gets made deliberately instead of by drift.
    const from = runTs.indexOf('const tierOrder = checkTierMonotonicity({')
    const block = runTs.slice(from, from + 1200)
    expect(block).not.toMatch(/draft\[(?:t|tier)\] = null/)
    expect(block).not.toMatch(/needs_inspection/)
    expect(block).not.toMatch(/forcedInspection/)
  })
})

describe('Phase 5b — the Phase 4 scenarios that make this reachable', () => {
  it('R3: a customer picking the dearest product into Better inverts the ladder', () => {
    // Good resolves the $30 Elite; Better is anchored to the customer's $300
    // pick; Best resolves the $30 Elite too. Better now exceeds Best.
    expect(ok({ good: 160, better: 430, best: 190 })).toBe(false)
  })

  it('R2: a tradie pinning an expensive product to Good inverts it', () => {
    expect(ok({ good: 400, better: 200, best: 300 })).toBe(false)
  })
})
