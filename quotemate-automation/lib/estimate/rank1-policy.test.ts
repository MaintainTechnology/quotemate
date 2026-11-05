import { afterEach, describe, expect, it, vi } from 'vitest'
import { rank1QuoteCoreEnabled } from './rank1-policy'

afterEach(() => vi.unstubAllEnvs())

describe('Rank 1 system-wide safety policy', () => {
  it.each(['', 'tenant-a', 'tenant-b', 'false', 'all', '*'])(
    'cannot be bypassed by the retired pilot allowlist: %s', configured => {
      vi.stubEnv('RANK1_QUOTE_CORE_TENANTS', configured)
      expect(rank1QuoteCoreEnabled()).toBe(true)
    },
  )
  it('applies without any tenant selection environment setting', () => {
    vi.stubEnv('RANK1_QUOTE_CORE_TENANTS', undefined)
    expect(rank1QuoteCoreEnabled()).toBe(true)
  })
})
