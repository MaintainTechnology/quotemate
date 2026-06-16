import { describe, expect, it } from 'vitest'
import { parseChatRequest } from './chat-request'

describe('parseChatRequest', () => {
  it('accepts a valid paint request and trims the query', () => {
    const r = parseChatRequest({ estimator: 'paint', sessionId: 'run-1', query: '  Why this price?  ' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.estimator).toBe('paint')
      expect(r.value.sessionId).toBe('run-1')
      expect(r.value.query).toBe('Why this price?')
    }
  })

  it('accepts electrical', () => {
    const r = parseChatRequest({ estimator: 'electrical', sessionId: 'ext-1', query: 'q' })
    expect(r.ok).toBe(true)
  })

  it('rejects an unknown estimator', () => {
    const r = parseChatRequest({ estimator: 'plumbing', sessionId: 'x', query: 'q' })
    expect(r.ok).toBe(false)
  })

  it('rejects an empty query', () => {
    expect(parseChatRequest({ estimator: 'paint', sessionId: 'x', query: '' }).ok).toBe(false)
    expect(parseChatRequest({ estimator: 'paint', sessionId: 'x', query: '   ' }).ok).toBe(false)
  })

  it('rejects a missing session id', () => {
    expect(parseChatRequest({ estimator: 'paint', query: 'q' }).ok).toBe(false)
  })

  it('rejects an over-long query', () => {
    expect(parseChatRequest({ estimator: 'paint', sessionId: 'x', query: 'q'.repeat(2001) }).ok).toBe(false)
  })

  it('rejects a non-object body', () => {
    expect(parseChatRequest(null).ok).toBe(false)
    expect(parseChatRequest('nope').ok).toBe(false)
  })
})
