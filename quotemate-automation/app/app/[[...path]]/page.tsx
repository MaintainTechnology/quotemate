import { notFound, redirect } from 'next/navigation'

const FALLBACKS: Readonly<Record<string, string>> = {
  '': '/dashboard',
  'sections/billing': '/dashboard?tab=billing',
  'sections/payouts': '/dashboard?tab=payouts',
}

export function mobileFallbackPath(path: readonly string[] | undefined): string | null {
  return FALLBACKS[(path ?? []).join('/')] ?? null
}

/**
 * Browser fallback for verified /app universal links. Installed devices open
 * the native route; other browsers land on the equivalent first-party page.
 */
export default async function MobileAppFallback({
  params,
}: {
  params: Promise<{ path?: string[] }>
}) {
  const target = mobileFallbackPath((await params).path)
  if (!target) notFound()
  redirect(target)
}
