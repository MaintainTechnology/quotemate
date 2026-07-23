// updateVapiAssistant — behaviour tests (mocked fetch, hermetic).
//
// Key 2026-07-23 changes pinned here:
//   1. Prompt sync is DECOUPLED from VAPI_PROVISIONING_ENABLED. That flag
//      guards resource CREATION; refreshing an existing assistant's prompt
//      must work whenever VAPI_API_KEY is set — otherwise account-settings
//      trade toggles silently never reach the live receptionist (the exact
//      bug this rewrite fixes). Opt-out: VAPI_PROMPT_SYNC_ENABLED=false.
//   2. The update is GET-then-PATCH and non-destructive (tools survive).
//   3. customServices flow into the composed prompt (SMS parity).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { updateVapiAssistant } from './update-assistant'

const ORIGINAL_ENV = { ...process.env }

function makeFetchResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  } as Response
}

const LIVE_ASSISTANT = {
  id: 'asst-1',
  model: {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    temperature: 0.2,
    systemPrompt: 'OLD PROMPT',
    tools: [{ type: 'endCall' }],
  },
  metadata: { tenant_id: 't1', trades: ['electrical'] },
}

beforeEach(() => {
  delete process.env.VAPI_PROVISIONING_ENABLED
  delete process.env.VAPI_PROMPT_SYNC_ENABLED
  process.env.VAPI_API_KEY = 'test-key'
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL_ENV }
})

function stubVapi() {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (!init?.method || init.method === 'GET') return makeFetchResponse(200, LIVE_ASSISTANT)
    return makeFetchResponse(200, { ok: true })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('updateVapiAssistant — gate', () => {
  it('syncs even when VAPI_PROVISIONING_ENABLED is unset (the decoupling)', async () => {
    const fetchMock = stubVapi()
    const res = await updateVapiAssistant({
      assistantId: 'asst-1',
      businessName: 'Acme',
      trades: ['electrical', 'roofing'],
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.stubbed).toBe(false)
    expect(fetchMock).toHaveBeenCalled()
  })

  it('VAPI_PROMPT_SYNC_ENABLED=false stubs the sync (explicit opt-out)', async () => {
    process.env.VAPI_PROMPT_SYNC_ENABLED = 'false'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = await updateVapiAssistant({
      assistantId: 'asst-1',
      businessName: 'Acme',
      trades: ['electrical'],
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.stubbed).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails cleanly without VAPI_API_KEY', async () => {
    delete process.env.VAPI_API_KEY
    const res = await updateVapiAssistant({
      assistantId: 'asst-1',
      businessName: 'Acme',
      trades: ['electrical'],
    })
    expect(res.ok).toBe(false)
  })

  it('never updates a stub assistant id', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = await updateVapiAssistant({
      assistantId: 'vapi-stub-12345678',
      businessName: 'Acme',
      trades: ['electrical'],
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.stubbed).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('updateVapiAssistant — non-destructive PATCH', () => {
  it('GETs the live assistant then PATCHes with tools preserved and sonnet-5 set', async () => {
    const fetchMock = stubVapi()
    await updateVapiAssistant({
      assistantId: 'asst-1',
      businessName: 'Acme',
      trades: ['electrical', 'roofing'],
    })
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
    expect(patchCall).toBeDefined()
    const body = JSON.parse(String(patchCall![1]!.body))
    expect(body.model.model).toBe('claude-sonnet-5')
    expect(body.model.tools).toEqual([{ type: 'endCall' }])
    expect(body.model.systemPrompt).toContain('roofing')
    expect(body.metadata.trades).toEqual(['electrical', 'roofing'])
  })

  it('customServices appear in the PATCHed prompt (SMS parity)', async () => {
    const fetchMock = stubVapi()
    await updateVapiAssistant({
      assistantId: 'asst-1',
      businessName: 'Acme',
      trades: ['electrical'],
      customServices: [
        { name: 'EV charger install', clarifying_questions: ['Single or three phase at the board?'] },
      ],
    })
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
    const body = JSON.parse(String(patchCall![1]!.body))
    expect(body.model.systemPrompt).toContain('EV charger install')
    expect(body.model.systemPrompt).toContain('Single or three phase at the board?')
  })

  it('surfaces a failed GET as ok=false without attempting the PATCH', async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse(404, { message: 'not found' }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await updateVapiAssistant({
      assistantId: 'asst-gone',
      businessName: 'Acme',
      trades: ['electrical'],
    })
    expect(res.ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
