import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appBaseUrl, tenantIntakeUrl, unsubscribeUrl } from '@/lib/email/links'

describe('lib/email/links', () => {
  beforeEach(() => {
    process.env.APP_URL = 'https://quote-mate-rho.vercel.app'
    delete process.env.NEXT_PUBLIC_APP_URL
  })
  afterEach(() => {
    delete process.env.APP_URL
    delete process.env.NEXT_PUBLIC_APP_URL
  })

  it('strips a trailing slash from the base URL', () => {
    process.env.APP_URL = 'https://quote-mate-rho.vercel.app/'
    expect(appBaseUrl()).toBe('https://quote-mate-rho.vercel.app')
  })

  it('builds the per-tenant intake URL', () => {
    expect(tenantIntakeUrl('tenant-123')).toBe(
      'https://quote-mate-rho.vercel.app/start/tenant-123',
    )
  })

  it('builds the unsubscribe URL', () => {
    expect(unsubscribeUrl('tok.sig')).toBe(
      'https://quote-mate-rho.vercel.app/api/email/unsubscribe/tok.sig',
    )
  })

  it('accepts an explicit base override without touching env', () => {
    expect(tenantIntakeUrl('t1', 'https://example.com/')).toBe('https://example.com/start/t1')
  })

  it('throws when no base URL is configured', () => {
    delete process.env.APP_URL
    expect(() => appBaseUrl()).toThrow(/APP_URL is not set/)
  })
})
