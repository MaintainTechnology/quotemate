import { describe, expect, it } from 'vitest'

import {
  androidAssetLinks,
  appleAppSiteAssociation,
  IOS_BUNDLE_ID,
} from './mobile-app-associations'

const FINGERPRINT = Array.from({ length: 32 }, (_, index) =>
  index.toString(16).padStart(2, '0'),
)
  .join(':')
  .toUpperCase()

describe('mobile app association documents', () => {
  it('claims only the published /app namespace for the signed iOS app', () => {
    expect(appleAppSiteAssociation('a1b2c3d4e5')).toEqual({
      applinks: {
        apps: [],
        details: [
          {
            appID: `A1B2C3D4E5.${IOS_BUNDLE_ID}`,
            paths: ['/app', '/app/*'],
          },
        ],
      },
    })
  })

  it('fails closed without a valid Apple team ID', () => {
    expect(appleAppSiteAssociation(undefined)).toBeNull()
    expect(appleAppSiteAssociation('not-a-team')).toBeNull()
  })

  it('publishes one Android target with validated signing fingerprints', () => {
    const document = androidAssetLinks(`${FINGERPRINT}, ${FINGERPRINT}`)
    expect(document).toHaveLength(1)
    expect(document?.[0].target.sha256_cert_fingerprints).toEqual([FINGERPRINT])
  })

  it('fails closed for missing or malformed Android signing proof', () => {
    expect(androidAssetLinks(undefined)).toBeNull()
    expect(androidAssetLinks('AA:BB')).toBeNull()
  })
})
