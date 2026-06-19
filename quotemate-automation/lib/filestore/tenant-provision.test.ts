import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { KbConfig, KbFetch } from '../admin-loader/mt-filestore-kb'
import { provisionTenantStore } from './tenant-provision'

const CONFIG: KbConfig = { url: 'https://kb.test', apiKey: 'k' }
const TID = '550e8400-e29b-41d4-a716-446655440000'
const ENABLED = { TENANT_FILESTORE_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
function mkFetch(routes: Record<string, () => Response>): KbFetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : (input as URL).toString())
    const method = (init?.method ?? 'GET').toUpperCase()
    const h = routes[`${method} ${url.pathname}`]
    return h ? h() : new Response('not found', { status: 404 })
  }) as unknown as KbFetch
}

function fakeTenants(opts: { existing?: { file_store_id: string | null }; updateError?: { message: string } }) {
  const updates: Array<Record<string, unknown>> = []
  const api = {
    updates,
    from() {
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        async maybeSingle() {
          return { data: opts.existing ?? null, error: null }
        },
        update(vals: Record<string, unknown>) {
          updates.push(vals)
          return { eq: async () => ({ error: opts.updateError ?? null }) }
        },
      }
    },
  }
  return api
}

const createStoreFetch = mkFetch({
  'GET /v1/stores': () => json({ stores: [] }),
  'POST /v1/stores': () => json({ name: 'store1' }),
})

describe('provisionTenantStore', () => {
  it('STUBs when the flag is off (twilio/vapi parity)', async () => {
    const out = await provisionTenantStore({ tenantId: TID, businessName: 'Biz' }, { env: {} as NodeJS.ProcessEnv })
    expect(out).toEqual({ ok: true, stubbed: true, fileStoreId: null })
  })

  it('creates the store and stamps tenants.file_store_id', async () => {
    const tenants = fakeTenants({ existing: { file_store_id: null } })
    const out = await provisionTenantStore(
      { tenantId: TID, businessName: 'Biz' },
      { env: ENABLED, supabase: tenants as unknown as Pick<SupabaseClient, 'from'>, config: CONFIG, fetchImpl: createStoreFetch },
    )
    expect(out).toEqual({ ok: true, fileStoreId: 'store1' })
    expect(tenants.updates).toContainEqual({ file_store_id: 'store1' })
  })

  it('is idempotent when the id is already set (no create, no update)', async () => {
    const tenants = fakeTenants({ existing: { file_store_id: 'store-existing' } })
    const out = await provisionTenantStore(
      { tenantId: TID, businessName: 'Biz' },
      { env: ENABLED, supabase: tenants as unknown as Pick<SupabaseClient, 'from'>, config: CONFIG, fetchImpl: createStoreFetch },
    )
    expect(out).toEqual({ ok: true, fileStoreId: 'store-existing' })
    expect(tenants.updates).toHaveLength(0)
  })

  it('fails cleanly when the KB is unavailable', async () => {
    const tenants = fakeTenants({ existing: { file_store_id: null } })
    const down = mkFetch({ 'GET /v1/stores': () => new Response('down', { status: 503 }) })
    const out = await provisionTenantStore(
      { tenantId: TID, businessName: 'Biz' },
      { env: ENABLED, supabase: tenants as unknown as Pick<SupabaseClient, 'from'>, config: CONFIG, fetchImpl: down },
    )
    expect(out.ok).toBe(false)
  })
})
