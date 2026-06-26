import { afterEach, describe, expect, it } from 'vitest'
import {
  SUPPORTED_PROVIDERS,
  hasOAuthConfig,
  isSupportedProvider,
  readOAuthConfig,
} from '@/lib/crm/provider'
import { configuredProviders, getProvider } from '@/lib/crm/registry'

afterEach(() => {
  for (const k of [
    'HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET', 'HUBSPOT_REDIRECT_URI',
    'ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REDIRECT_URI',
  ]) delete process.env[k]
})

describe('provider registry', () => {
  it('lists hubspot + zoho as supported', () => {
    expect(SUPPORTED_PROVIDERS).toEqual(['hubspot', 'zoho'])
    expect(isSupportedProvider('hubspot')).toBe(true)
    expect(isSupportedProvider('salesforce')).toBe(false)
  })

  it('getProvider returns the right implementation', () => {
    expect(getProvider('hubspot').id).toBe('hubspot')
    expect(getProvider('zoho').id).toBe('zoho')
  })

  it('getProvider throws for an unknown provider', () => {
    expect(() => getProvider('pipedrive')).toThrow(/unsupported/)
  })
})

describe('readOAuthConfig / hasOAuthConfig', () => {
  it('reads a fully configured provider', () => {
    process.env.HUBSPOT_CLIENT_ID = 'cid'
    process.env.HUBSPOT_CLIENT_SECRET = 'secret'
    process.env.HUBSPOT_REDIRECT_URI = 'https://app/cb'
    expect(hasOAuthConfig('HUBSPOT')).toBe(true)
    expect(readOAuthConfig('HUBSPOT')).toEqual({
      clientId: 'cid',
      clientSecret: 'secret',
      redirectUri: 'https://app/cb',
    })
  })

  it('reports not-configured + throws when env is incomplete', () => {
    process.env.HUBSPOT_CLIENT_ID = 'cid' // missing secret + redirect
    expect(hasOAuthConfig('HUBSPOT')).toBe(false)
    expect(() => readOAuthConfig('HUBSPOT')).toThrow(/not configured/)
  })

  it('configuredProviders reflects which providers have env set', () => {
    expect(configuredProviders()).toEqual([])
    process.env.ZOHO_CLIENT_ID = 'z'
    process.env.ZOHO_CLIENT_SECRET = 'z'
    process.env.ZOHO_REDIRECT_URI = 'https://app/cb'
    expect(configuredProviders()).toEqual(['zoho'])
  })
})
