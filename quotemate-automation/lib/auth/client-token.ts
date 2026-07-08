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
//
// ⚠ THE LOAD RACE (fixed here): `@clerk/nextjs` loads clerk-js asynchronously,
// so on a cold page load `window.Clerk` (and `.session`) is not populated for
// the first few hundred ms. The old version read the global ONCE, synchronously
// — so a Clerk-authed tradie landing straight on a tool page (e.g.
// /dashboard/roofing/measure) hit `Clerk === undefined`, fell through to a
// (nonexistent) Supabase session, and got a null token → a false "signed-out"
// state with no retry. We now WAIT for clerk-js to finish loading before
// deciding there's no Clerk session, so the fallback only fires for genuine
// legacy-Supabase users.

import { getBrowserSupabase } from '@/lib/supabase/client'

type ClerkSession = { getToken: () => Promise<string | null> }
type ClerkGlobal = {
  // clerk-js v4-: boolean once .load() resolves.
  loaded?: boolean
  // clerk-js v5+: 'loading' | 'ready' | 'degraded' | 'error'.
  status?: string
  session?: ClerkSession | null
}

function readClerk(): ClerkGlobal | undefined {
  return (globalThis as unknown as { Clerk?: ClerkGlobal }).Clerk
}

/** True once clerk-js has finished its initial load and session state has
 *  resolved (signed-in OR signed-out). Tolerant of both the v5 `status`
 *  string and the older `loaded` boolean so a version bump can't regress. */
function clerkResolved(c: ClerkGlobal | undefined): boolean {
  if (!c) return false
  if (typeof c.status === 'string') return c.status !== 'loading'
  return c.loaded === true
}

/** Wait (up to timeoutMs) for clerk-js to finish loading so `Clerk.session`
 *  reflects the real signed-in/out state. Resolves with the Clerk global once
 *  ready, or its last-seen value (possibly undefined) on timeout — the caller
 *  then falls back to Supabase, which is the correct behaviour for a genuine
 *  legacy user or if clerk-js never loads (e.g. its CDN is blocked). */
function waitForClerk(timeoutMs = 5000): Promise<ClerkGlobal | undefined> {
  const now = readClerk()
  if (clerkResolved(now)) return Promise.resolve(now)
  return new Promise((resolve) => {
    const started = typeof performance !== 'undefined' ? performance.now() : 0
    const elapsed = () => (typeof performance !== 'undefined' ? performance.now() : 0) - started
    const tick = () => {
      const c = readClerk()
      if (clerkResolved(c) || elapsed() >= timeoutMs) {
        resolve(c)
        return
      }
      setTimeout(tick, 60)
    }
    setTimeout(tick, 60)
  })
}

export async function getAuthToken(): Promise<string | null> {
  try {
    const clerk = await waitForClerk()
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
