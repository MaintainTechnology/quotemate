import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ════════════════════════════════════════════════════════════════════
// WIRING INVARIANT for quotes.grounding_result.
//
// When the grounding validator rejects a line item, runEstimation downgrades
// the whole quote to the $99 inspection route and returns `groundingFailures`
// — a structured list naming the tier, the line index, the description, the
// unit, the price and what was expected instead. That downgrade has been
// firing on real customers (ten downlights, a routine quotable job, billed as
// an inspection), and the recurring cost of diagnosing it was that the route
// reached for the array to format risk_flags strings and then dropped it
// before the insert.
//
// The strings alone are not enough to tune a validator against: risk_flags is
// a text[] shared with billing and spec flags, so recovering "which line, at
// what price" means regex-ing prose out of a mixed list. grounding_result is
// jsonb and already exists for exactly this purpose (migration 127: "the
// grounding validator's verdict for this quote"). The failures belong there.
//
// Source-level assertions, same reason as tests/internal-route-auth.test.ts:
// the route calls createClient() at module scope and vitest.config.ts injects
// no env, so importing it throws. What breaks in production is the wiring —
// so the wiring is what this asserts.
// ════════════════════════════════════════════════════════════════════

const ROUTE = 'app/api/estimate/draft/route.ts'
const src = readFileSync(resolve(__dirname, '..', ROUTE), 'utf8')

/** The grounding_result object literal in the quotes insert. Sliced rather
 *  than regex-ed whole so a failure points at the right place. */
function groundingResultLiteral(): string {
  const from = src.indexOf('grounding_result:')
  expect(from, 'grounding_result is no longer written to the quotes row').toBeGreaterThan(-1)
  // Wide enough to span the comment block plus the multi-line literal. Too
  // narrow a slice truncates silently and fails for the wrong reason.
  return src.slice(from, from + 400)
}

describe('quotes.grounding_result records WHICH line failed', () => {
  const lit = groundingResultLiteral()

  it('persists the failures array, not just the two booleans', () => {
    // The whole point. Without this the column says a downgrade happened and
    // refuses to say why, which is the state that made the live fault take
    // days instead of one query.
    expect(lit).toMatch(/failures:\s*estimation\.groundingFailures/)
  })

  it('keeps `ok` and `downgraded` — the existing readers must not break', () => {
    expect(lit).toMatch(/ok:\s*!isInspection/)
    expect(lit).toMatch(/downgraded:\s*!!estimation\.downgradedToInspection/)
  })

  it('omits `failures` when there are none, so a clean quote keeps its shape', () => {
    // Conditional spread, not `failures: x ?? []`. A successful quote's
    // column must stay byte-identical to what it was before this change —
    // an empty array on every clean row is noise that reads as "evaluated
    // and found nothing" rather than "never failed".
    expect(lit).toMatch(/\.\.\.\(\s*estimation\.groundingFailures\?\.length/)
    expect(lit).not.toMatch(/failures:\s*estimation\.groundingFailures\s*\?\?\s*\[\]/)
  })
})

describe('the risk_flags formatting still runs — this change adds, it does not move', () => {
  it('still pushes a [grounding] string per failure', () => {
    // The strings are what a human skims in the dashboard; the jsonb is what
    // a query filters on. Replacing one with the other would be a regression
    // for whichever reader was using it.
    expect(src).toMatch(/riskFlags\.push\(/)
    expect(src).toMatch(/\[grounding\] tier=\$\{f\.tier\} line#\$\{f\.lineIndex\}/)
  })

  it('reads groundingFailures from the same estimation result', () => {
    expect(src).toMatch(/for \(const f of estimation\.groundingFailures \?\? \[\]\)/)
  })
})
