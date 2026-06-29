import { describe, it, expect } from 'vitest'
import { readCanvaConfig, resolveRedirectUri, CANVA_CALLBACK_PATH } from './config'

describe('readCanvaConfig', () => {
  it('returns creds when both id + secret are set', () => {
    const cfg = readCanvaConfig({ CANVA_CLIENT_ID: 'OC-1', CANVA_CLIENT_SECRET: 'sec' })
    expect(cfg).toEqual({ clientId: 'OC-1', clientSecret: 'sec', redirectUri: null })
  })

  it('captures an explicit redirect URI override', () => {
    const cfg = readCanvaConfig({
      CANVA_CLIENT_ID: 'OC-1',
      CANVA_CLIENT_SECRET: 'sec',
      CANVA_REDIRECT_URI: 'https://prod.app/api/dashboard/flyer/canva/callback',
    })
    expect(cfg?.redirectUri).toBe('https://prod.app/api/dashboard/flyer/canva/callback')
  })

  it('returns null when creds are missing', () => {
    expect(readCanvaConfig({ CANVA_CLIENT_ID: 'OC-1' })).toBeNull()
    expect(readCanvaConfig({ CANVA_CLIENT_SECRET: 'sec' })).toBeNull()
    expect(readCanvaConfig({})).toBeNull()
  })
})

describe('resolveRedirectUri', () => {
  const base = { clientId: 'OC-1', clientSecret: 'sec' }

  it('derives the callback from the request origin when no override', () => {
    const uri = resolveRedirectUri({ ...base, redirectUri: null }, 'https://app.example')
    expect(uri).toBe(`https://app.example${CANVA_CALLBACK_PATH}`)
  })

  it('does not double up slashes on a trailing-slash origin', () => {
    const uri = resolveRedirectUri({ ...base, redirectUri: null }, 'https://app.example/')
    expect(uri).toBe(`https://app.example${CANVA_CALLBACK_PATH}`)
  })

  it('rewrites localhost → 127.0.0.1 (Canva forbids localhost) keeping the port', () => {
    const uri = resolveRedirectUri({ ...base, redirectUri: null }, 'http://localhost:3000')
    expect(uri).toBe(`http://127.0.0.1:3000${CANVA_CALLBACK_PATH}`)
  })

  it('leaves 127.0.0.1 and real hosts untouched', () => {
    expect(resolveRedirectUri({ ...base, redirectUri: null }, 'http://127.0.0.1:3000')).toBe(
      `http://127.0.0.1:3000${CANVA_CALLBACK_PATH}`,
    )
    expect(resolveRedirectUri({ ...base, redirectUri: null }, 'https://quote-mate-rho.vercel.app')).toBe(
      `https://quote-mate-rho.vercel.app${CANVA_CALLBACK_PATH}`,
    )
  })

  it('prefers an explicit override', () => {
    const uri = resolveRedirectUri({ ...base, redirectUri: 'https://fixed/cb' }, 'https://ignored')
    expect(uri).toBe('https://fixed/cb')
  })
})
