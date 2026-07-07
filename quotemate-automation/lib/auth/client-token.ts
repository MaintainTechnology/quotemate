'use client'
// Shared client-side bearer-token accessor for the dual-auth (Clerk↔Supabase)
// window. Prefers a Clerk session token (verified server-side by the tenant
// resolver → clerk_user_id); falls back to the legacy Supabase access token
// (→ owner_user_id). It is a plain async function (not a hook) so any event
// handler or non-component helper can call it.
//
// The dashboard's main page uses Clerk's useAuth() hook directly (it needs the
// isLoaded gate for its mount bounce); this helper is for the many secondary
// dashboard components that currently read getBrowserSupabase().auth.getSession()
// inline — swap those to `await getAuthToken()` to make them Clerk-aware.

import { getBrowserSupabase } from '@/lib/supabase/client'

type ClerkGlobal = {
  loaded?: boolean
  session?: { getToken: () => Promise<string | null> } | null
}

export async function getAuthToken(): Promise<string | null> {
  try {
    const clerk = (globalThis as unknown as { Clerk?: ClerkGlobal }).Clerk
    if (clerk?.session) {
      const clerkToken = await clerk.session.getToken()
      if (clerkToken) return clerkToken
    }
  } catch {
    /* fall through to the legacy Supabase session */
  }
  const { data } = await getBrowserSupabase().auth.getSession()
  return data.session?.access_token ?? null
}
