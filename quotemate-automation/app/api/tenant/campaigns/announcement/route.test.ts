// Route tests for /api/tenant/campaigns/announcement.
//
// Mirrors app/api/tenant/trades/route.test.ts: mock @supabase/supabase-js
// BEFORE importing the route. A small generic chain-stub resolves .maybeSingle()
// / .single() from `state.single[table]` and an awaited select from
// `state.list[table]`, and records insert/update/upsert payloads.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const state: {
  user: { id: string } | null
  single: Record<string, Row | null>
  list: Record<string, Row[] | null>
  inserts: { table: string; payload: unknown }[]
  updates: { table: string; payload: Row }[]
  upserts: { table: string; payload: unknown; opts: unknown }[]
} = { user: null, single: {}, list: {}, inserts: [], updates: [], upserts: [] }

function q(table: string) {
  const single = () =>
    Promise.resolve({
      data: chain._insert
        ? state.single[`${table}:insert`] ?? state.single[table] ?? null
        : state.single[table] ?? null,
      error: null,
    })
  const chain: Record<string, unknown> & { _insert?: boolean } = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    insert: (payload: unknown) => {
      state.inserts.push({ table, payload })
      chain._insert = true
      return chain
    },
    update: (payload: Row) => {
      state.updates.push({ table, payload })
      return chain
    },
    upsert: (payload: unknown, opts: unknown) => {
      state.upserts.push({ table, payload, opts })
      return chain
    },
    delete: () => chain,
    maybeSingle: single,
    single,
    then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve({ data: state.list[table] ?? null, error: null, count: null }).then(onF, onR),
  }
  return chain
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: state.user }, error: state.user ? null : new Error('no') }),
    },
    from: (t: string) => q(t),
  }),
}))

const { POST, GET } = await import('./route')

function postReq(body: unknown) {
  return new Request('http://localhost/api/tenant/campaigns/announcement', {
    method: 'POST',
    headers: { authorization: 'Bearer faketoken', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const READY_TENANT: Row = {
  id: 'tenant-1',
  business_name: 'Pilot Sparky',
  business_address: '12 Wattle St, Sydney NSW 2000',
  twilio_sms_number: '+61481613464',
  contact_name: 'Jordan',
}

beforeEach(() => {
  state.user = { id: 'user-1' }
  state.single = { tenants: READY_TENANT, email_campaigns: { id: 'camp-1' } }
  state.list = { crm_contacts: [], email_unsubscribes: [], email_sends: [] }
  state.inserts = []
  state.updates = []
  state.upserts = []
  process.env.UNSUBSCRIBE_SECRET = 'test-secret'
})

afterEach(() => {
  delete process.env.UNSUBSCRIBE_SECRET
  delete process.env.RESEND_API_KEY
  delete process.env.RESEND_FROM_EMAIL
  vi.unstubAllGlobals()
})

describe('POST (preview)', () => {
  it('computes the recipient breakdown without sending', async () => {
    state.list.crm_contacts = [
      { email: 'a@x.com', first_name: 'A' },
      { email: 'b@x.com', first_name: null },
      { email: 'a@x.com', first_name: 'dup' }, // duplicate
      { email: 'bad-email', first_name: null }, // invalid
    ]
    state.list.email_unsubscribes = [{ email: 'b@x.com' }]

    const res = await POST(postReq({}))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.preview).toBe(true)
    expect(json.total_contacts).toBe(4)
    expect(json.recipient_count).toBe(1) // a@x.com only
    expect(json.duplicates_removed).toBe(1)
    expect(json.suppressed_unsubscribed).toBe(1)
    expect(json.invalid_removed).toBe(1)
    // R7: an email preview (subject + html) is returned, not just counts
    expect(json.subject).toContain('Pilot Sparky')
    expect(typeof json.html).toBe('string')
    expect(json.html).toContain('Pilot Sparky')
    // no per-recipient send rows are written on a preview
    expect(state.upserts.filter((u) => u.table === 'email_sends')).toHaveLength(0)
  })

  it('returns 400 when the tenant is missing a physical address (compliance gate)', async () => {
    state.single.tenants = { ...READY_TENANT, business_address: null }
    const res = await POST(postReq({ confirm: true }))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toBe('missing_business_details')
    expect(json.missing).toContain('business_address')
  })

  it('401 when no tenant resolves', async () => {
    state.user = null
    const res = await POST(postReq({}))
    expect(res.status).toBe(401)
  })
})

describe('POST (send)', () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = 'rk'
    process.env.RESEND_FROM_EMAIL = 'QuoteMax <noreply@quotemate.com.au>'
  })

  it('sends to each recipient and records per-recipient status', async () => {
    state.list.crm_contacts = [
      { email: 'a@x.com', first_name: 'A' },
      { email: 'b@x.com', first_name: 'B' },
    ]
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'm1' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(postReq({ confirm: true }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.sent).toBe(2)
    expect(json.failed).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // per-recipient send rows upserted with onConflict on (campaign, email)
    const sendUpsert = state.upserts.find((u) => u.table === 'email_sends')
    expect(sendUpsert).toBeTruthy()
    const rows = sendUpsert!.payload as Row[]
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.status === 'sent' && r.campaign_id === 'camp-1')).toBe(true)
    expect(sendUpsert!.opts).toMatchObject({ onConflict: 'campaign_id,email' })

    // campaign transitioned sending -> sent
    const statuses = state.updates.filter((u) => u.table === 'email_campaigns').map((u) => u.payload.status)
    expect(statuses).toContain('sending')
    expect(statuses).toContain('sent')
  })

  it('records a failed recipient when the provider rejects it', async () => {
    state.list.crm_contacts = [{ email: 'a@x.com', first_name: 'A' }]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'bad' }), { status: 422 })))

    const res = await POST(postReq({ confirm: true }))
    const json = await res.json()
    expect(json.sent).toBe(0)
    expect(json.failed).toBe(1)
    const rows = state.upserts.find((u) => u.table === 'email_sends')!.payload as Row[]
    expect(rows[0].status).toBe('failed')
  })

  it('503 when email is not configured', async () => {
    delete process.env.RESEND_API_KEY
    state.list.crm_contacts = [{ email: 'a@x.com', first_name: 'A' }]
    const res = await POST(postReq({ confirm: true }))
    expect(res.status).toBe(503)
  })

  it('no-ops cleanly when there are zero eligible recipients', async () => {
    state.list.crm_contacts = []
    const res = await POST(postReq({ confirm: true }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.sent).toBe(0)
    expect(json.note).toBe('no_recipients')
  })

  it('records unsubscribed contacts as a suppressed send row (R12)', async () => {
    state.list.crm_contacts = [{ email: 'u@x.com', first_name: 'U' }]
    state.list.email_unsubscribes = [{ email: 'u@x.com' }]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'm' }), { status: 200 })))

    const res = await POST(postReq({ confirm: true }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.sent).toBe(0) // nobody emailed — the only contact is unsubscribed
    expect(json.note).toBe('no_recipients')

    const suppressedUpsert = state.upserts.find(
      (u) => u.table === 'email_sends' && (u.payload as Row[])[0]?.status === 'suppressed',
    )
    expect(suppressedUpsert).toBeTruthy()
    const rows = suppressedUpsert!.payload as Row[]
    expect(rows[0]).toMatchObject({ email: 'u@x.com', status: 'suppressed', campaign_id: 'camp-1' })
    // insert-only so a later unsubscribe never downgrades a prior 'sent' row
    expect(suppressedUpsert!.opts).toMatchObject({ ignoreDuplicates: true })
  })
})

describe('GET', () => {
  it('returns the announcement campaign summary', async () => {
    state.single.email_campaigns = { id: 'camp-1', status: 'sent', recipient_count: 5, sent_count: 5, failed_count: 0 }
    const res = await GET(
      new Request('http://localhost/api/tenant/campaigns/announcement', {
        headers: { authorization: 'Bearer x' },
      }),
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.campaign).toMatchObject({ id: 'camp-1', sent_count: 5 })
  })
})
