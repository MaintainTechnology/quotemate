// scope_short persistence (spec customer-quote-five-sections R2 /
// acceptance 1) — the shared stamp behind the draft route and the roofing
// save-as-quote route: persists when the sentence exists, skips blanks,
// and swallows a pre-migration-175 column error without throwing.

import { describe, expect, it } from 'vitest'
import { roofingScopeShort, stampScopeShort } from './scope-short'

type Op = { op: string; args: unknown[] }

/** Chainable fake supabase client (house DI style — no vi.mock). */
function fakeDb(result: { error: { message: string } | null } | 'throw') {
  const ops: Op[] = []
  const client = {
    from(table: string) {
      ops.push({ op: 'from', args: [table] })
      const builder = {
        update(patch: unknown) {
          ops.push({ op: 'update', args: [patch] })
          return builder
        },
        eq(col: string, v: unknown) {
          ops.push({ op: 'eq', args: [col, v] })
          if (result === 'throw') return Promise.reject(new Error('network down'))
          return Promise.resolve(result)
        },
      }
      return builder
    },
  }
  return { client: client as never, ops }
}

describe('stampScopeShort', () => {
  it('persists the sentence onto the quotes row (the draft route no longer discards it)', async () => {
    const { client, ops } = fakeDb({ error: null })
    const ok = await stampScopeShort(client, {
      quoteId: 'q-1',
      scopeShort: 'Replace 6 downlights with new LEDs.',
      source: 'estimate/draft',
    })
    expect(ok).toBe(true)
    expect(ops).toContainEqual({ op: 'from', args: ['quotes'] })
    expect(ops).toContainEqual({
      op: 'update',
      args: [{ scope_short: 'Replace 6 downlights with new LEDs.' }],
    })
    expect(ops).toContainEqual({ op: 'eq', args: ['id', 'q-1'] })
  })

  it('skips blank/absent sentences without touching the DB', async () => {
    const { client, ops } = fakeDb({ error: null })
    expect(await stampScopeShort(client, { quoteId: 'q-1', scopeShort: null, source: 's' })).toBe(false)
    expect(await stampScopeShort(client, { quoteId: 'q-1', scopeShort: '   ', source: 's' })).toBe(false)
    expect(ops).toHaveLength(0)
  })

  it('pre-175 schema (missing column error) is non-fatal — returns false, never throws', async () => {
    const { client } = fakeDb({ error: { message: 'column "scope_short" does not exist' } })
    await expect(
      stampScopeShort(client, { quoteId: 'q-1', scopeShort: 'A sentence.', source: 's' }),
    ).resolves.toBe(false)
  })

  it('a thrown DB error is swallowed too', async () => {
    const { client } = fakeDb('throw')
    await expect(
      stampScopeShort(client, { quoteId: 'q-1', scopeShort: 'A sentence.', source: 's' }),
    ).resolves.toBe(false)
  })
})

describe('roofingScopeShort — the recommended tier scope line (tierScopeLine output)', () => {
  const tiers = [
    { tier: 'good' as const, scope: 'Patch and repair the worst sections.' },
    { tier: 'better' as const, scope: 'Replace roof with new battens, Colorbond sheeting and flashings.' },
    { tier: 'best' as const, scope: 'Upgraded full replacement in Klip-Lok.' },
  ]

  it('picks the selected tier', () => {
    expect(roofingScopeShort(tiers, 'best')).toBe('Upgraded full replacement in Klip-Lok.')
    expect(roofingScopeShort(tiers, 'better')).toBe(
      'Replace roof with new battens, Colorbond sheeting and flashings.',
    )
  })

  it("falls back to 'better' when selected_tier is missing or unpriced", () => {
    expect(roofingScopeShort(tiers, null)).toBe(
      'Replace roof with new battens, Colorbond sheeting and flashings.',
    )
    expect(roofingScopeShort(tiers, 'inspection')).toBe(
      'Replace roof with new battens, Colorbond sheeting and flashings.',
    )
  })

  it('returns null when nothing usable exists', () => {
    expect(roofingScopeShort([], 'better')).toBeNull()
    expect(roofingScopeShort([{ tier: 'better', scope: '  ' }], 'better')).toBeNull()
  })
})
