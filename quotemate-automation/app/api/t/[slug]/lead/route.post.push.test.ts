import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const deferred: Array<() => Promise<unknown>> = []
  const enqueue = vi.fn(async () => true)
  const dialog = vi.fn(async () => ({ conversationId: 'conversation-1' }))
  const state = { intakeInsert: { data: { id: 'intake-1' }, error: null as { message: string } | null } }
  const tenant = {
    id: 'tenant-1', trade: 'electrical', trades: ['electrical'], status: 'active',
    business_name: 'Test Electrical', owner_mobile: '+61400000000', owner_first_name: 'Jo',
    twilio_sms_number: '+61411111111',
  }
  const supabase = {
    rpc: vi.fn(async () => ({ data: 1, error: null })),
    from(table: string) {
      if (table === 'tenants') return {
        select() { return this }, ilike() { return this },
        maybeSingle: async () => ({ data: tenant, error: null }),
      }
      if (table === 'intakes') return {
        insert() { return this }, select() { return this },
        single: async () => state.intakeInsert,
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { deferred, enqueue, dialog, state, supabase }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.supabase }))
vi.mock('next/server', () => ({ after: (callback: () => Promise<unknown>) => h.deferred.push(callback) }))
vi.mock('@/lib/push/events', () => ({ enqueuePushEvent: h.enqueue }))
vi.mock('@/lib/sms/start-web-lead-conversation', () => ({ startWebLeadConversation: h.dialog }))
vi.mock('@/lib/storage/upload', () => ({ uploadIntakePhoto: vi.fn(async () => ({ path: 'photo.jpg', signedUrl: 'https://example.test/photo.jpg' })) }))
vi.mock('@/lib/customers/lookup', () => ({ findOrCreateCustomer: vi.fn(async () => ({ id: 'customer-1' })) }))
vi.mock('@/lib/onboard/schema', () => ({ normaliseAuMobile: (value: string) => value }))
vi.mock('@/lib/intake/embed', () => ({ embedIntake: vi.fn(async () => [0.1]) }))
vi.mock('@/lib/intake/structure', () => ({ structureIntake: vi.fn(async () => ({
  trade: 'electrical', job_type: 'powerpoint', address: null, suburb: 'Bondi', scope: {},
  access: {}, property: {}, risks: [], inspection_required: false,
  caller: { name: 'Jeph', phone: '+61400111222' }, timing: {}, confidence: 0.9,
  confidence_reason: 'clear',
})) }))

import { POST } from './route'

function request(): Request {
  const form = new FormData()
  form.set('name', 'Jeph')
  form.set('mobile', '0400111222')
  form.set('suburb', 'Bondi')
  form.set('description', 'Install another outdoor powerpoint')
  form.append('photos', new File(['photo'], 'job.jpg', { type: 'image/jpeg' }))
  return new Request('https://example.test/api/t/test-electrical/lead', { method: 'POST', body: form })
}

async function runDeferred(): Promise<void> {
  expect(h.deferred).toHaveLength(1)
  await h.deferred[0]!()
}

describe('POST /api/t/[slug]/lead push branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.deferred.length = 0
    h.state.intakeInsert = { data: { id: 'intake-1' }, error: null }
    process.env.WEB_LEAD_DIALOG_ENABLED = 'true'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
  })

  it('executes the dialog-first handler call site with exact persisted chat identity', async () => {
    const response = await POST(request(), { params: Promise.resolve({ slug: 'test-electrical' }) })
    expect(response.status).toBe(200)
    await runDeferred()
    expect(h.enqueue).toHaveBeenCalledWith(h.supabase, {
      eventKey: 'new-lead:sms:conversation-1', tenantId: 'tenant-1', title: 'New lead',
      body: 'Jeph in Bondi just asked for a quote.', url: '/chats?chatId=conversation-1',
    })
  })

  it('executes the legacy handler call site only after a successful intake insert', async () => {
    process.env.WEB_LEAD_DIALOG_ENABLED = 'false'
    const response = await POST(request(), { params: Promise.resolve({ slug: 'test-electrical' }) })
    expect(response.status).toBe(200)
    await runDeferred()
    expect(h.enqueue).toHaveBeenCalledWith(h.supabase, {
      eventKey: 'new-lead:intake:intake-1', tenantId: 'tenant-1', title: 'New lead',
      body: 'Jeph in Bondi just asked for a quote.', url: '/chats',
    })
  })

  it('does not enqueue when the legacy intake insert fails', async () => {
    process.env.WEB_LEAD_DIALOG_ENABLED = 'false'
    h.state.intakeInsert = { data: null as never, error: { message: 'write failed' } }
    const response = await POST(request(), { params: Promise.resolve({ slug: 'test-electrical' }) })
    expect(response.status).toBe(200)
    await runDeferred()
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('keeps the public lead success available when push enqueue fails', async () => {
    h.enqueue.mockRejectedValueOnce(new Error('outbox unavailable'))
    const response = await POST(request(), { params: Promise.resolve({ slug: 'test-electrical' }) })
    await runDeferred()
    expect(response.status).toBe(200)
  })
})
