import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  eqCalls: [] as Array<[string, unknown]>,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        or: () => chain,
        eq: (column: string, value: unknown) => {
          mocks.eqCalls.push([column, value])
          return chain
        },
        limit: async () => ({
          data: [
            {
              id: 'install-ev-charger',
              trade: 'electrical',
              name: 'Install EV charger',
              description: 'Install customer-selected wall charger',
            },
          ],
        }),
      }
      return chain
    },
  }),
}))

vi.mock('./rerank', () => ({ getReranker: () => null }))

const { makeTools } = await import('./tools')

async function lookup(jobType: string, suppliedBy: 'tradie' | 'customer') {
  const lookupAssembly = makeTools(null, { jobType }).lookupAssembly as unknown as {
    execute: (input: Record<string, unknown>, options: Record<string, unknown>) => Promise<unknown>
  }
  return lookupAssembly.execute(
    {
      query: 'Install EV charger',
      trade: 'electrical',
      supplied_by: suppliedBy,
    },
    {},
  )
}

describe('EV charger assembly supply-mode lookup', () => {
  beforeEach(() => {
    mocks.eqCalls.length = 0
  })

  it.each(['tradie', 'customer'] as const)(
    'resolves the supply-agnostic install assembly for %s supply',
    async (suppliedBy) => {
      await expect(lookup('ev_charger', suppliedBy)).resolves.toEqual([
        expect.objectContaining({ name: 'Install EV charger' }),
      ])
      expect(mocks.eqCalls).not.toContainEqual(['properties->>supplied_by', suppliedBy])
      expect(mocks.eqCalls).toContainEqual(['trade', 'electrical'])
    },
  )

  it('retains the strict supply filter for non-EV assemblies', async () => {
    await lookup('ceiling_fans', 'customer')
    expect(mocks.eqCalls).toContainEqual(['properties->>supplied_by', 'customer'])
  })
})
