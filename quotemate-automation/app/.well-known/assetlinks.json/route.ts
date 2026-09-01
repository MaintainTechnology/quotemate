import { androidAssetLinks } from '@/lib/mobile-app-associations'

export const dynamic = 'force-dynamic'

export function GET() {
  const document = androidAssetLinks(process.env.ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS)
  if (!document) {
    return Response.json(
      { error: 'mobile_association_not_configured' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  return Response.json(document, {
    headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
  })
}
