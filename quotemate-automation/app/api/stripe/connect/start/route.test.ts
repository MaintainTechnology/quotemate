// POST /api/stripe/connect/start — the stale-account self-heal.
//
// The reported failure: a tenant row carrying an acct_… created under a
// DIFFERENT Stripe platform (key/sandbox rotation) made accountLinks.create
// fail with "The requested account link is for an account that is not
// connected to your platform or does not exist". The route now validates a
// stored id before reuse, discards a stale one (+ resets the readiness
// flags), provisions a fresh account, and surfaces "Connect not enabled on
// the platform" as an actionable error instead of a cryptic 502.

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
    for (const op of ['select', 'update', 'eq', 'is', 'maybeSingle']) {
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
  return {
    ...actual, // keep the real error classifiers
    provisionStripeConnectAccount: vi.fn(),
    createConnectOnboardingLink: vi.fn(),
    getConnectAccountStatus: vi.fn(),
  }
})

import { POST } from './route'
import {
  provisionStripeConnectAccount,
  createConnectOnboardingLink,
  getConnectAccountStatus,
} from '@/lib/stripe/provision'

const provisionMock = vi.mocked(provisionStripeConnectAccount)
const linkMock = vi.mocked(createConnectOnboardingLink)
const statusMock = vi.mocked(getConnectAccountStatus)

beforeEach(() => {
  h.results.length = 0
  h.queries.length = 0
  h.getUser.mockReset()
  provisionMock.mockReset()
  linkMock.mockReset()
  statusMock.mockReset()
  vi.stubEnv('STRIPE_PROVISIONING_ENABLED', 'true')
  vi.stubEnv('APP_URL', 'https://app.test')
})

function req(withAuth = true) {
  return new Request('http://localhost/api/stripe/connect/start', {
    method: 'POST',
    headers: withAuth ? { authorization: 'Bearer token-1' } : {},
  })
}

function authedUser(id = 'user-1') {
  h.getUser.mockResolvedValue({ data: { user: { id } }, error: null })
}

const tenantRow = (accountId: string | null) => ({
  id: 'tenant-1',
  owner_email: 'sparky@example.com',
  business_name: 'Atomic Electrical',
  stripe_connect_account_id: accountId,
})

function updateBodies(table: string) {
  return h.queries
    .filter((q) => q.table === table)
    .flatMap((q) => q.ops.filter((o) => o.op === 'update').map((o) => o.args[0]))
}

describe('POST /api/stripe/connect/start', () => {
  it('401 without a bearer token', async () => {
    const res = await POST(req(false))
    expect(res.status).toBe(401)
  })

  it('reuses a stored account that is still valid on this platform', async () => {
    authedUser()
    h.results.push({ data: tenantRow('acct_ok'), error: null })
    statusMock.mockResolvedValue({
      ok: true,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    })
    linkMock.mockResolvedValue({ ok: true, url: 'https://connect.stripe.com/setup/x' })

    const res = await POST(req())
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, url: 'https://connect.stripe.com/setup/x', accountId: 'acct_ok' })
    expect(provisionMock).not.toHaveBeenCalled()
  })

  it('self-heals a stale account id: clears it + flags, provisions fresh, mints the link', async () => {
    authedUser()
    h.results.push(
      { data: tenantRow('acct_stale'), error: null }, // tenant lookup
      { data: null, error: null }, // heal update
      { data: null, error: null }, // persist new acct id
    )
    statusMock.mockResolvedValue({
      ok: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      code: 'resource_missing',
      reason: 'No such account: acct_stale',
    })
    provisionMock.mockResolvedValue({ ok: true, stubbed: false, accountId: 'acct_new' })
    linkMock.mockResolvedValue({ ok: true, url: 'https://connect.stripe.com/setup/y' })

    const res = await POST(req())
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, accountId: 'acct_new' })

    const updates = updateBodies('tenants')
    expect(updates[0]).toMatchObject({
      stripe_connect_account_id: null,
      stripe_connect_charges_enabled: false,
      stripe_connect_payouts_enabled: false,
      stripe_connect_details_submitted: false,
    })
    expect(updates[1]).toMatchObject({ stripe_connect_account_id: 'acct_new' })
    expect(linkMock).toHaveBeenCalledWith({ accountId: 'acct_new', appUrl: 'https://app.test' })
  })

  it('also treats the literal account-link error message as stale', async () => {
    authedUser()
    h.results.push(
      { data: tenantRow('acct_foreign'), error: null },
      { data: null, error: null },
      { data: null, error: null },
    )
    statusMock.mockResolvedValue({
      ok: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      code: null,
      reason:
        'The requested account link is for an account that is not connected to your platform or does not exist.',
    })
    provisionMock.mockResolvedValue({ ok: true, stubbed: false, accountId: 'acct_new' })
    linkMock.mockResolvedValue({ ok: true, url: 'https://connect.stripe.com/setup/z' })

    const res = await POST(req())
    expect((await res.json()).ok).toBe(true)
    expect(provisionMock).toHaveBeenCalled()
  })

  it('503 connect_not_enabled when the platform has not signed up for Connect (validate path)', async () => {
    authedUser()
    h.results.push({ data: tenantRow('acct_any'), error: null })
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
    expect(await res.json()).toMatchObject({ ok: false, error: 'connect_not_enabled' })
    expect(provisionMock).not.toHaveBeenCalled()
  })

  it('503 connect_not_enabled when account CREATION is rejected for the same reason', async () => {
    authedUser()
    h.results.push({ data: tenantRow(null), error: null })
    provisionMock.mockResolvedValue({
      ok: false,
      reason: "You can only create new accounts if you've signed up for Connect, which you can do at https://dashboard.stripe.com/connect.",
      code: null,
    })

    const res = await POST(req())
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ ok: false, error: 'connect_not_enabled' })
  })

  it('does not heal on an unclassified validate failure (no duplicate accounts)', async () => {
    authedUser()
    h.results.push({ data: tenantRow('acct_ok'), error: null })
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
    expect(await res.json()).toMatchObject({ ok: false, error: 'account_validate_failed' })
    expect(provisionMock).not.toHaveBeenCalled()
    expect(updateBodies('tenants')).toHaveLength(0)
  })
})
