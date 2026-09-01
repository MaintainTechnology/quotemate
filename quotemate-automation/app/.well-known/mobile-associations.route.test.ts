import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET as getAndroid } from './assetlinks.json/route'
import { GET as getApple } from './apple-app-site-association/route'

const FINGERPRINT = Array.from({ length: 32 }, (_, index) =>
  index.toString(16).padStart(2, '0'),
)
  .join(':')
  .toUpperCase()

afterEach(() => vi.unstubAllEnvs())

describe('/.well-known mobile associations', () => {
  it('returns 503 rather than a false association when signing config is absent', () => {
    vi.stubEnv('APPLE_TEAM_ID', '')
    vi.stubEnv('ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS', '')
    expect(getApple().status).toBe(503)
    expect(getAndroid().status).toBe(503)
  })

  it('serves configured documents directly as JSON', async () => {
    vi.stubEnv('APPLE_TEAM_ID', 'A1B2C3D4E5')
    vi.stubEnv('ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS', FINGERPRINT)
    const apple = getApple()
    const android = getAndroid()
    expect(apple.status).toBe(200)
    expect(android.status).toBe(200)
    expect(apple.headers.get('content-type')).toContain('application/json')
    expect(android.headers.get('content-type')).toContain('application/json')
    expect(await apple.json()).toMatchObject({ applinks: { details: [{ paths: ['/app', '/app/*'] }] } })
    expect(await android.json()).toMatchObject([
      { target: { package_name: 'au.com.quotemax.mobile' } },
    ])
  })
})
