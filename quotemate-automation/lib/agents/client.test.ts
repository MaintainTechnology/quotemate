// Tests for the agents-client lib — pure resolver + fetch shape.

import { describe, expect, it, vi } from 'vitest'
import {
  agentRunPath,
  readAgentClientConfig,
  runAgent,
} from './client'

describe('readAgentClientConfig', () => {
  it('returns null when QM_AGENTS_URL is missing', () => {
    expect(
      readAgentClientConfig({
        QM_AGENTS_API_KEY: 'k',
        NODE_ENV: 'test',
      } as unknown as NodeJS.ProcessEnv),
    ).toBeNull()
  })

  it('returns null when QM_AGENTS_API_KEY is missing', () => {
    expect(
      readAgentClientConfig({
        QM_AGENTS_URL: 'https://x',
        NODE_ENV: 'test',
      } as unknown as NodeJS.ProcessEnv),
    ).toBeNull()
  })

  it('returns null when either var is blank', () => {
    expect(
      readAgentClientConfig({
        QM_AGENTS_URL: '   ',
        QM_AGENTS_API_KEY: 'k',
        NODE_ENV: 'test',
      } as unknown as NodeJS.ProcessEnv),
    ).toBeNull()
  })

  it('strips trailing slashes from the base URL', () => {
    const c = readAgentClientConfig({
      QM_AGENTS_URL: 'https://x.example.com///',
      QM_AGENTS_API_KEY: 'secret',
      NODE_ENV: 'test',
    } as unknown as NodeJS.ProcessEnv)
    expect(c?.baseUrl).toBe('https://x.example.com')
    expect(c?.apiKey).toBe('secret')
  })
})

describe('agentRunPath', () => {
  it('maps each agent name to its /v1/agents/<name>/run path', () => {
    expect(agentRunPath('eval')).toBe('/v1/agents/eval/run')
    expect(agentRunPath('catalogue')).toBe('/v1/agents/catalogue/run')
    expect(agentRunPath('tradie-learn')).toBe('/v1/agents/tradie-learn/run')
  })
})

describe('runAgent', () => {
  const cfg = { baseUrl: 'https://x', apiKey: 'secret-key' }

  it('returns a not-configured error when config is null', async () => {
    const r = await runAgent('eval', null)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/not configured/i)
  })

  it('POSTs to the right path with the API key header', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true, total_score: 87 }), { status: 200 }),
    )
    const r = await runAgent('eval', cfg, { foo: 'bar' }, fetchMock as unknown as typeof fetch)
    expect(r.ok).toBe(true)
    expect(r.total_score).toBe(87)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://x/v1/agents/eval/run')
    expect((init as RequestInit).method).toBe('POST')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['x-api-key']).toBe('secret-key')
    expect(headers['Content-Type']).toBe('application/json')
    expect((init as RequestInit).body).toBe(JSON.stringify({ foo: 'bar' }))
  })

  it('returns ok=false on non-2xx HTTP response, surfaces error text', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'invalid_or_missing_api_key' }), { status: 401 }),
    )
    const r = await runAgent('catalogue', cfg, {}, fetchMock as unknown as typeof fetch)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('invalid_or_missing_api_key')
  })

  it('returns ok=false on network failure', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const r = await runAgent('tradie-learn', cfg, {}, fetchMock as unknown as typeof fetch)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/ECONNREFUSED/)
  })

  it('still resolves to a clean shape when the response body is not JSON', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 502 }))
    const r = await runAgent('eval', cfg, {}, fetchMock as unknown as typeof fetch)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/HTTP 502/)
  })
})
