// fetchTenantVoiceServices — the supabase-js twin of the pg query in
// scripts/deploy-vapi-voice-prompt.mts, so the account-settings routes can
// pass the SAME enabled-services (+ MUST-ASK questions) set the SMS dialog
// uses when they refresh the voice assistant. Best-effort: any query error
// returns [] (the prompt still ships with code-only questions).

import { describe, expect, it } from 'vitest'
import { fetchTenantVoiceServices } from './tenant-services'

// Minimal chainable fake of the three queries the fetch makes.
function fakeSupabase(data: {
  assemblies?: unknown[] | null
  offerings?: unknown[] | null
  custom?: unknown[] | null
  failOn?: string
}) {
  return {
    from(table: string) {
      const rows =
        table === 'shared_assemblies' ? data.assemblies
        : table === 'tenant_service_offerings' ? data.offerings
        : table === 'tenant_custom_assemblies' ? data.custom
        : null
      const result = data.failOn === table
        ? { data: null, error: { message: 'boom' } }
        : { data: rows ?? [], error: null }
      const chain: any = {
        select: () => chain,
        in: () => chain,
        eq: () => chain,
        then: (resolve: (v: unknown) => unknown) => resolve(result),
      }
      return chain
    },
  } as any
}

const ASSEMBLY = {
  id: 'a1',
  name: 'Downlight install',
  description: 'LED downlights',
  default_enabled: true,
  category: 'lighting',
  clarifying_questions: ['How many?'],
  always_inspection: false,
}

describe('fetchTenantVoiceServices', () => {
  it('returns enabled shared assemblies with their MUST-ASK questions', async () => {
    const out = await fetchTenantVoiceServices(
      fakeSupabase({ assemblies: [ASSEMBLY], offerings: [{ assembly_id: 'a1', enabled: true }] }),
      't1',
      ['electrical'],
    )
    expect(out).toEqual([
      {
        name: 'Downlight install',
        description: 'LED downlights',
        clarifying_questions: ['How many?'],
        always_inspection: false,
      },
    ])
  })

  it('drops assemblies the tenant switched off', async () => {
    const out = await fetchTenantVoiceServices(
      fakeSupabase({ assemblies: [ASSEMBLY], offerings: [{ assembly_id: 'a1', enabled: false }] }),
      't1',
      ['electrical'],
    )
    expect(out).toEqual([])
  })

  it('appends enabled tenant custom assemblies', async () => {
    const out = await fetchTenantVoiceServices(
      fakeSupabase({
        assemblies: [],
        offerings: [],
        custom: [
          { name: 'Sauna wiring', description: null, clarifying_questions: null, always_inspection: true, enabled: true },
          { name: 'Off', description: null, clarifying_questions: null, always_inspection: false, enabled: false },
        ],
      }),
      't1',
      ['electrical'],
    )
    expect(out.map((s) => s.name)).toEqual(['Sauna wiring'])
  })

  it('scopes custom assemblies to the enabled trades (dropped trade ≠ advertised)', async () => {
    // Review finding 2026-07-23: a tenant who drops plumbing must not have a
    // plumbing custom service spoken by the voice receptionist. The fake's
    // .in() is a pass-through, so assert via the query builder instead: the
    // production code must call .in('trade', trades) on tenant_custom_assemblies.
    const calls: Array<{ table: string; method: string; args: unknown[] }> = []
    const tracking = {
      from(table: string) {
        const chain: any = {
          select: (...a: unknown[]) => { calls.push({ table, method: 'select', args: a }); return chain },
          in: (...a: unknown[]) => { calls.push({ table, method: 'in', args: a }); return chain },
          eq: (...a: unknown[]) => { calls.push({ table, method: 'eq', args: a }); return chain },
          then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
        }
        return chain
      },
    } as any
    await fetchTenantVoiceServices(tracking, 't1', ['electrical'])
    const customTradeFilter = calls.find(
      (c) => c.table === 'tenant_custom_assemblies' && c.method === 'in' && (c.args[0] as string) === 'trade',
    )
    expect(customTradeFilter).toBeDefined()
    expect(customTradeFilter!.args[1]).toEqual(['electrical'])
  })

  it('returns [] best-effort when a query fails', async () => {
    const out = await fetchTenantVoiceServices(
      fakeSupabase({ assemblies: [ASSEMBLY], failOn: 'shared_assemblies' }),
      't1',
      ['electrical'],
    )
    expect(out).toEqual([])
  })
})
