import { describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))

import { enqueuePublicLeadPush, selectPublicLeadBranch } from './route'

describe('/api/t/[slug]/lead push branches', () => {
  it('selects the dialog-first branch and enqueues its exact chat event', async () => {
    const enqueue = vi.fn(async () => true)
    expect(selectPublicLeadBranch(true)).toBe('dialog')

    await enqueuePublicLeadPush({
      tenantId: 'tenant-1',
      name: 'Jeph',
      suburb: 'Bondi',
      conversationId: 'conversation-1',
      intakeId: null,
    }, { enqueue })

    expect(enqueue).toHaveBeenCalledWith(expect.anything(), {
      eventKey: 'new-lead:sms:conversation-1',
      tenantId: 'tenant-1',
      title: 'New lead',
      body: 'Jeph in Bondi just asked for a quote.',
      url: '/chats?chatId=conversation-1',
    })
  })

  it('selects the legacy branch and enqueues its exact intake destination', async () => {
    const enqueue = vi.fn(async () => true)
    expect(selectPublicLeadBranch(false)).toBe('legacy')

    await enqueuePublicLeadPush({
      tenantId: 'tenant-1',
      name: 'Jeph',
      suburb: 'Bondi',
      conversationId: null,
      intakeId: 'intake-1',
    }, { enqueue })

    expect(enqueue).toHaveBeenCalledWith(expect.anything(), {
      eventKey: 'new-lead:intake:intake-1',
      tenantId: 'tenant-1',
      title: 'New lead',
      body: 'Jeph in Bondi just asked for a quote.',
      url: '/chats',
    })
  })

  it('keeps the public lead pipeline available when outbox enqueue throws', async () => {
    const enqueue = vi.fn(async () => { throw new Error('database unavailable') })
    await expect(enqueuePublicLeadPush({
      tenantId: 'tenant-1',
      name: 'Jeph',
      suburb: 'Bondi',
      conversationId: null,
      intakeId: 'intake-1',
    }, { enqueue })).resolves.toBe(false)
  })
})
