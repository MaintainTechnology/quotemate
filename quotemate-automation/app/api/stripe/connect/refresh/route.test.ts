// POST /api/stripe/connect/refresh — pull-based onboarding sync.
//
// This is the fix for the onboarding loop: the tab reads the tenant's
// stripe_connect_* flags, which the account.updated webhook may never sync
// (localhost / lag), so a tradie who finished Stripe's form stays stuck on
// "incomplete". The route reads the LIVE account status and writes the flags
// itself. Supabase is mocked with the repo's chainable-builder queue;
// getConnectAccountStatus is stubbed while the real error classifiers run.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  type Op = { op: string; args: unknown[] }
  const results: Result[] = []
  const queries: { table: string; ops: Op[] }[] = []
  const getUser = vi.fn()

  function from(table: string) {
    const record = { table, ops: [] as Op[] }
    const builder: Record<string, unknown> = {}
    for (const op of ['select', 'update', 'eq', 'maybeSingle']) {
      builder[op] = (...args: unknown[]) => {
        record.ops.push({ op, args })
        return builder
      }
    }
    builder.then = (
      resolve: (r: Result) => unknown,
      reject?: (e: unknown) => unknown,
    ) => {
      queries.push(record)
      const r = results.shift() ?? { data: null, error: null }
      return Promise.resolve(r).then(resolve, reject)
    }
    return builder
  }

  return { results, queries, getUser, client: { auth: { getUser }, from } }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('@/lib/stripe/provision', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe/provision')>()
  return { ...actual, getConnectAccountStatus: vi.fn() } // keep the real classifiers
})

import { POST } from './route'
import { getConnectAccountStatus } from '@/lib/stripe/provision'

const statusMock = vi.mocked(getConnectAccountStatus)

beforeEach(() => {
  h.results.length = 0
  h.queries.length = 0
  h.getUser.mockReset()
  statusMock.mockReset()
})

function req(withAuth = true) {
  return new Request('http://localhost/api/stripe/connect/refresh', {
    method: 'POST',
    headers: withAuth ? { authorization: 'Bearer token-1' } : {},
  })
}

function authedUser(id = 'user-1') {
  h.getUser.mockResolvedValue({ data: { user: { id } }, error: null })
}

const tenant = (over: Record<string, unknown> = {}) => ({
  id: 'tenant-1',
  stripe_connect_account_id: 'acct_1',
  stripe_connect_charges_enabled: false,
  stripe_connect_payouts_enabled: false,
  stripe_connect_details_submitted: false,
  stripe_connect_onboarded_at: null,
  ...over,
})

function tenantUpdates() {
  return h.queries
    .filter((q) => q.table === 'tenants')
    .flatMap((q) => q.ops.filter((o) => o.op === 'update').map((o) => o.args[0] as Record<string, unknown>))
}

describe('POST /api/stripe/connect/refresh', () => {
  it('401 without a bearer token', async () => {
    const res = await POST(req(false))
    expect(res.status).toBe(401)
  })

  it('404 when the user has no tenant', async () => {
    authedUser()
    h.results.push({ data: null, error: null })
    const res = await POST(req())
    expect(res.status).toBe(404)
  })

  it('no-ops when the tenant has no connected account', async () => {
    authedUser()
    h.results.push({ data: tenant({ stripe_connect_account_id: null }), error: null })
    const res = await POST(req())
    expect(await res.json()).toMatchObject({ ok: true, synced: false, account: { has_account: false } })
    expect(statusMock).not.toHaveBeenCalled()
    expect(tenantUpdates()).toHaveLength(0)
  })

  it('syncs a fully-live account and stamps onboarded_at (closes the loop)', async () => {
    authedUser()
    h.results.push(
      { data: tenant(), error: null }, // tenant lookup
      { data: null, error: null }, // flag write
    )
    statusMock.mockResolvedValue({
      ok: true,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    })
    const res = await POST(req())
    const json = await res.json()
    expect(json).toMatchObject({
      ok: true,
      synced: true,
      account: { has_account: true, charges_enabled: true, payouts_enabled: true, details_submitted: true },
    })
    expect(json.account.onboarded_at).toBeTruthy()
    const patch = tenantUpdates()[0]
    expect(patch).toMatchObject({
      stripe_connect_charges_enabled: true,
      stripe_connect_payouts_enabled: true,
      stripe_connect_details_submitted: true,
    })
    expect(patch).toHaveProperty('stripe_connect_onboarded_at')
  })

  it('reflects a still-verifying account without stamping onboarded_at', async () => {
    authedUser()
    h.results.push({ data: tenant(), error: null }, { data: null, error: null })
    statusMock.mockResolvedValue({
      ok: true,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: true,
    })
    const res = await POST(req())
    expect(await res.json()).toMatchObject({
      ok: true,
      synced: true,
      account: { details_submitted: true, payouts_enabled: false, onboarded_at: null },
    })
    expect(tenantUpdates()[0]).not.toHaveProperty('stripe_connect_onboarded_at')
  })

  it('does not re-stamp onboarded_at when it was already set', async () => {
    authedUser()
    h.results.push(
      { data: tenant({ stripe_connect_onboarded_at: '2026-06-01T00:00:00Z' }), error: null },
      { data: null, error: null },
    )
    statusMock.mockResolvedValue({
      ok: true,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    })
    const res = await POST(req())
    expect((await res.json()).account.onboarded_at).toBe('2026-06-01T00:00:00Z')
    expect(tenantUpdates()[0]).not.toHaveProperty('stripe_connect_onboarded_at')
  })

  it('self-heals a stale/inaccessible account id', async () => {
    authedUser()
    h.results.push(
      { data: tenant(), error: null }, // tenant lookup
      { data: [{ id: 'tenant-1' }], error: null }, // heal write (CAS matched the stale id)
    )
    statusMock.mockResolvedValue({
      ok: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      code: 'account_invalid',
      reason: "The provided key does not have access to account 'acct_1'.",
    })
    const res = await POST(req())
    expect(await res.json()).toMatchObject({ ok: true, synced: true, healed: true, account: { has_account: false } })
    expect(tenantUpdates()[0]).toMatchObject({ stripe_connect_account_id: null, stripe_connect_payouts_enabled: false })
  })

  it('does NOT clobber a concurrently-provisioned account when the heal CAS misses', async () => {
    authedUser()
    h.results.push(
      { data: tenant(), error: null }, // tenant lookup (still sees the stale id)
      { data: [], error: null }, // heal CAS matched 0 rows — a concurrent start replaced the id
      {
        // re-read returns the FRESH account another request just persisted
        data: {
          stripe_connect_account_id: 'acct_new',
          stripe_connect_charges_enabled: false,
          stripe_connect_payouts_enabled: false,
          stripe_connect_details_submitted: false,
          stripe_connect_onboarded_at: null,
        },
        error: null,
      },
    )
    statusMock.mockResolvedValue({
      ok: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      code: 'account_invalid',
      reason: "does not have access to account 'acct_1'",
    })
    const res = await POST(req())
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, synced: true, account: { has_account: true } })
    expect(json.healed).toBeUndefined()
  })

  it('503 when Connect is not enabled on the platform', async () => {
    authedUser()
    h.results.push({ data: tenant(), error: null })
    statusMock.mockResolvedValue({
      ok: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      code: 'platform_account_required',
      reason: 'Only Stripe Connect platforms can work with other accounts.',
    })
    const res = await POST(req())
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: 'connect_not_enabled' })
    expect(tenantUpdates()).toHaveLength(0)
  })

  it('502 on a transient Stripe failure (no flag write)', async () => {
    authedUser()
    h.results.push({ data: tenant(), error: null })
    statusMock.mockResolvedValue({
      ok: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      code: 'api_connection_error',
      reason: 'Stripe is unreachable',
    })
    const res = await POST(req())
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'sync_failed' })
    expect(tenantUpdates()).toHaveLength(0)
  })
})
