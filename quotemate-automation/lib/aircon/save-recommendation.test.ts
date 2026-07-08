// saveAirconRecommendation + supabaseUserIdFor (spec quotes-tab-sync T3,
// hardened per code review): the persist step shared by /api/aircon/recommend
// and /api/aircon/plan. created_by is a uuid → auth.users FK, so a Clerk
// caller ('user_…' string id, not a uuid) must resolve to
// tenant.owner_user_id — the exact trap app/api/roofing/save documents.

import { describe, it, expect } from 'vitest'
import { saveAirconRecommendation, supabaseUserIdFor } from './save-recommendation'
import type { AcRecommendation } from './types'

const recommendation = {
  routing: { decision: 'book_assessment', reason: 'indicative only' },
} as unknown as AcRecommendation

const address = { address: '12 Example St, Sydney', postcode: '2000', state: 'NSW' }

function stubClient(result: { data: unknown; error: unknown }) {
  const calls: { table?: string; payload?: Record<string, unknown> } = {}
  const client = {
    from(table: string) {
      calls.table = table
      return {
        insert(payload: Record<string, unknown>) {
          calls.payload = payload
          return { select: () => ({ single: async () => result }) }
        },
      }
    },
  }
  return { client: client as never, calls }
}

describe('supabaseUserIdFor', () => {
  it('Clerk caller resolves to the tenant owner uuid, never the user_… string', () => {
    expect(
      supabaseUserIdFor(
        { provider: 'clerk', userId: 'user_2abc' },
        { owner_user_id: 'b0000000-0000-4000-8000-000000000001' },
      ),
    ).toBe('b0000000-0000-4000-8000-000000000001')
  })

  it('Clerk caller with no owner link resolves to null', () => {
    expect(supabaseUserIdFor({ provider: 'clerk', userId: 'user_2abc' }, { owner_user_id: null })).toBeNull()
    expect(supabaseUserIdFor({ provider: 'clerk', userId: 'user_2abc' }, null)).toBeNull()
  })

  it('legacy Supabase caller uses their own auth id when the tenant has no owner link', () => {
    expect(
      supabaseUserIdFor(
        { provider: 'supabase', userId: 'c0000000-0000-4000-8000-000000000002' },
        { owner_user_id: null },
      ),
    ).toBe('c0000000-0000-4000-8000-000000000002')
  })
})

describe('saveAirconRecommendation', () => {
  it('no tenant → no insert, returns null', async () => {
    const { client, calls } = stubClient({ data: { id: 'x' }, error: null })
    const saved = await saveAirconRecommendation(client, {
      tenantId: null,
      createdBy: null,
      address,
      recommendation,
    })
    expect(saved).toBeNull()
    expect(calls.table).toBeUndefined()
  })

  it('persists the full row and returns id + public_token', async () => {
    const { client, calls } = stubClient({ data: { id: 'rec-1' }, error: null })
    const saved = await saveAirconRecommendation(client, {
      tenantId: 'tenant-1',
      createdBy: 'b0000000-0000-4000-8000-000000000001',
      address,
      recommendation,
    })
    expect(saved?.id).toBe('rec-1')
    expect(typeof saved?.public_token).toBe('string')
    expect(saved!.public_token.length).toBeGreaterThan(10)
    expect(calls.table).toBe('aircon_recommendations')
    expect(calls.payload).toMatchObject({
      tenant_id: 'tenant-1',
      created_by: 'b0000000-0000-4000-8000-000000000001',
      address: '12 Example St, Sydney',
      postcode: '2000',
      state: 'NSW',
      routing: 'book_assessment',
      public_token: saved!.public_token,
    })
    expect(calls.payload!.recommendation).toBe(recommendation)
  })

  it('insert failure is swallowed (best-effort) and returns null', async () => {
    const { client } = stubClient({ data: null, error: { message: 'boom' } })
    const saved = await saveAirconRecommendation(client, {
      tenantId: 'tenant-1',
      createdBy: null,
      address,
      recommendation,
    })
    expect(saved).toBeNull()
  })
})
