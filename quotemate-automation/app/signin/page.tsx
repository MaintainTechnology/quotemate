// /signin — RETIRED. QuoteMax now authenticates via Clerk at /sign-in.
//
// The Supabase-era email+password sign-in page is disabled. Any hit on /signin
// (old bookmarks, external links, or lingering internal redirects) forwards to
// the Clerk sign-in at /sign-in. A same-origin ?redirectTo= is preserved as
// Clerk's ?redirect_url= so deep-link round-trips (e.g. "sign in to edit a held
// quote") still land the tradie back where they came from.
//
// Supabase login itself still works at the API layer (dual-auth), so nothing is
// lost server-side — this only removes the old login *page*.

import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function RetiredSignInRedirect({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string | string[] }>
}) {
  const { redirectTo } = await searchParams
  const raw = Array.isArray(redirectTo) ? redirectTo[0] : redirectTo
  // Same-origin paths only — never honour an absolute or protocol-relative URL
  // (open-redirect vectors), mirroring the old page's whitelist.
  const safe = typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : null
  redirect(safe ? `/sign-in?redirect_url=${encodeURIComponent(safe)}` : '/sign-in')
}
