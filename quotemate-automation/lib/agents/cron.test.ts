// Tests for the shared cron auth + agent-name validation helpers.

import { describe, expect, it } from 'vitest'
import {
  isCronAuthorised,
  parseAgentName,
  VALID_AGENT_NAMES,
} from './cron'

function reqWith(headers: Record<string, string> = {}): Request {
  return new Request('https://x/api/cron/agents/eval', { headers })
}

describe('parseAgentName', () => {
  it('accepts the three valid agent slugs', () => {
    expect(parseAgentName('eval')).toBe('eval')
    expect(parseAgentName('catalogue')).toBe('catalogue')
    expect(parseAgentName('tradie-learn')).toBe('tradie-learn')
  })

  it('returns null for any other input', () => {
    expect(parseAgentName('Eval')).toBeNull() // case-sensitive
    expect(parseAgentName('eval-agent')).toBeNull()
    expect(parseAgentName('')).toBeNull()
    expect(parseAgentName('catalogue-qa')).toBeNull()
  })
})

describe('VALID_AGENT_NAMES', () => {
  it('lists exactly the three agent slugs', () => {
    expect([...VALID_AGENT_NAMES]).toEqual(['eval', 'catalogue', 'tradie-learn'])
  })
})

describe('isCronAuthorised — production', () => {
  const PROD = { NODE_ENV: 'production', CRON_SECRET: 'topsecret' } as unknown as NodeJS.ProcessEnv

  it('accepts the right Bearer in prod', () => {
    expect(
      isCronAuthorised(
        reqWith({ authorization: 'Bearer topsecret' }),
        PROD,
      ),
    ).toBe(true)
  })

  it('rejects a wrong Bearer in prod', () => {
    expect(
      isCronAuthorised(
        reqWith({ authorization: 'Bearer wrong' }),
        PROD,
      ),
    ).toBe(false)
  })

  it('rejects no Bearer in prod', () => {
    expect(isCronAuthorised(reqWith(), PROD)).toBe(false)
  })

  it('rejects when CRON_SECRET is unset in prod (fail-closed)', () => {
    expect(
      isCronAuthorised(
        reqWith({ authorization: 'Bearer anything' }),
        { NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv,
      ),
    ).toBe(false)
  })
})

describe('isCronAuthorised — dev/test', () => {
  const DEV = { NODE_ENV: 'development', CRON_SECRET: 'topsecret' } as unknown as NodeJS.ProcessEnv

  it('accepts the right Bearer in dev too', () => {
    expect(
      isCronAuthorised(reqWith({ authorization: 'Bearer topsecret' }), DEV),
    ).toBe(true)
  })

  it('rejects a wrong Bearer in dev (no silent pass)', () => {
    expect(
      isCronAuthorised(reqWith({ authorization: 'Bearer wrong' }), DEV),
    ).toBe(false)
  })

  it('allows no-header calls in dev (easy manual trigger)', () => {
    expect(isCronAuthorised(reqWith(), DEV)).toBe(true)
  })

  it('allows no-header calls when CRON_SECRET is unset in dev', () => {
    expect(
      isCronAuthorised(
        reqWith(),
        { NODE_ENV: 'development' } as unknown as NodeJS.ProcessEnv,
      ),
    ).toBe(true)
  })
})
