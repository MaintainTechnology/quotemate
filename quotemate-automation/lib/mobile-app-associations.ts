export const IOS_BUNDLE_ID = 'au.com.quotemax.mobile'
export const ANDROID_PACKAGE_NAME = 'au.com.quotemax.mobile'

const APPLE_TEAM_ID = /^[A-Z0-9]{10}$/
const SHA256_FINGERPRINT = /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/

export function appleAppSiteAssociation(teamId: string | undefined) {
  const normalized = teamId?.trim().toUpperCase() ?? ''
  if (!APPLE_TEAM_ID.test(normalized)) return null
  return {
    applinks: {
      apps: [],
      details: [
        {
          appID: `${normalized}.${IOS_BUNDLE_ID}`,
          paths: ['/app', '/app/*'],
        },
      ],
    },
  }
}

export function androidAssetLinks(rawFingerprints: string | undefined) {
  const fingerprints = [
    ...new Set(
      (rawFingerprints ?? '')
        .split(',')
        .map(value => value.trim().toUpperCase())
        .filter(Boolean),
    ),
  ]
  if (fingerprints.length === 0 || fingerprints.some(value => !SHA256_FINGERPRINT.test(value))) {
    return null
  }
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE_NAME,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]
}
