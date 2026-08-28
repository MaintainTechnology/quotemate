import { describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))

import { scheduleIntakeLeadPush } from './route'

describe('/api/intake/structure new-lead hook', () => {
  const setup = () => {
    const deferred: Array<() => Promise<unknown>> = []
    const enqueue = vi.fn(async () => true)
    const deps = {
      enqueue,
      defer: (callback: () => Promise<unknown>) => deferred.push(callback),
    }
    return { deferred, enqueue, deps }
  }

  it('enqueues exact copy and chat deep link after a standard intake insert', async () => {
    const { deferred, enqueue, deps } = setup()
    expect(scheduleIntakeLeadPush({
      intakeId: 'intake-1',
      tenantId: 'tenant-1',
      leadPushAlreadySent: false,
      conversationId: 'conversation-1',
      callId: null,
      callerName: 'Jeph',
      suburb: 'Bondi',
    }, deps)).toBe(true)

    expect(deferred).toHaveLength(1)
    await deferred[0]()
    expect(enqueue).toHaveBeenCalledWith(expect.anything(), {
      eventKey: 'new-lead:sms:conversation-1',
      tenantId: 'tenant-1',
      title: 'New lead',
      body: 'Jeph in Bondi just asked for a quote.',
      url: '/chats?chatId=conversation-1',
    })
  })

  it.each([
    ['tenantless intake', { intakeId: 'intake-1', tenantId: null, leadPushAlreadySent: false }],
    ['pre-marked dialog lead', { intakeId: 'intake-1', tenantId: 'tenant-1', leadPushAlreadySent: true }],
    ['failed intake insert', { intakeId: null, tenantId: 'tenant-1', leadPushAlreadySent: false }],
  ])('does not enqueue for a %s', (_label, gate) => {
    const { deferred, enqueue, deps } = setup()
    expect(scheduleIntakeLeadPush({
      ...gate,
      conversationId: 'conversation-1',
      callId: null,
      callerName: 'Jeph',
      suburb: 'Bondi',
    }, deps)).toBe(false)
    expect(deferred).toHaveLength(0)
    expect(enqueue).not.toHaveBeenCalled()
  })
})
