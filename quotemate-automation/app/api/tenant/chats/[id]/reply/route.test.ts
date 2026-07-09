// POST /api/tenant/chats/[id]/reply — transport-layer auth tests.
// The business logic (validation, tenant scoping, send-then-record) is
// unit-tested in lib/sms/tradie-reply.test.ts; these cover the two auth
// branches the route owns: 401 (no identity) and 404 (identity, no tenant).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }))
vi.mock('@/lib/tenant/from-request', () => ({ resolveTenantRequest: vi.fn() }))
vi.mock('@/lib/sms/tradie-reply', () => ({ sendTradieReply: vi.fn() }))

import { POST } from './route'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import { sendTradieReply } from '@/lib/sms/tradie-reply'

const resolveMock = vi.mocked(resolveTenantRequest)
const sendMock = vi.mocked(sendTradieReply)

const post = () =>
  POST(
    new Request('http://localhost/api/tenant/chats/conv-1/reply', {
      method: 'POST',
      body: JSON.stringify({ body: 'On my way.' }),
    }),
    { params: Promise.resolve({ id: 'conv-1' }) },
  )

describe('POST /api/tenant/chats/[id]/reply auth', () => {
  beforeEach(() => vi.clearAllMocks())

  it('401s when the caller has no resolvable identity', async () => {
    resolveMock.mockResolvedValueOnce(null as never)
    const res = await post()
    expect(res.status).toBe(401)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('404s when the identity has no tenant', async () => {
    resolveMock.mockResolvedValueOnce({ tenant: null } as never)
    const res = await post()
    expect(res.status).toBe(404)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('delegates to sendTradieReply with the tenant + conversation id', async () => {
    resolveMock.mockResolvedValueOnce({ tenant: { id: 'tenant-1' } } as never)
    sendMock.mockResolvedValueOnce({
      ok: true,
      message: { direction: 'outbound', body: 'On my way.', created_at: 'now' },
    })
    const res = await post()
    expect(res.status).toBe(200)
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        conversationId: 'conv-1',
        body: 'On my way.',
      }),
    )
  })
})
